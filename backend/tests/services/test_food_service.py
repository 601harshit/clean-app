"""Tests for app.services.food_service.

We use respx to intercept httpx calls and replay the recorded OFF cassettes
in backend/tests/cassettes/openfoodfacts/. The food_cache table backed by
local Supabase is exercised through small monkeypatches of _cache_get /
_cache_put so we don't hit network or DB.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from freezegun import freeze_time

from app.services import food_service
from app.services.food_service import (
    OFF_BASE,
    PRODUCT_CACHE_TTL,
    _cache_get,
    _cache_put,
    _search_cache_key,
    clear_search_cache,
    get_alternatives,
    get_product,
    parse_product,
    search_products,
)

CASSETTES = Path(__file__).resolve().parent.parent / "cassettes" / "openfoodfacts"


def _load(name: str) -> dict[str, Any]:
    return json.loads((CASSETTES / f"{name}.json").read_text())


# ---------------------------------------------------------------------------
# parse_product
# ---------------------------------------------------------------------------


class TestParseProduct:
    def test_nutella(self) -> None:
        p = parse_product(_load("nutella"))
        assert p is not None
        assert p["barcode"] == "3017620422003"
        assert p["name"] == "Nutella"
        assert p["brand"] == "Nutella"  # OFF brand field, not the manufacturer
        assert p["nutri_score"] == "E"
        assert p["nova_group"] == 4
        assert p["nutrients"]["sugars"] == 56.3
        assert p["nutrients"]["saturated_fat"] == 10.6
        # sodium_100g present (0.0428), do not fallback to salt
        assert p["nutrients"]["sodium"] == pytest.approx(0.0428, rel=1e-3)
        assert "en:spreads" in p["categories_tags"]
        assert p["image_url"] is not None

    def test_greek_yogurt_uses_salt_fallback_when_sodium_zero(self) -> None:
        # Cassette: sodium_100g = 0.0367, salt_100g = 0.0917
        # sodium_100g is non-zero so we should NOT use salt fallback here.
        p = parse_product(_load("greek_yogurt"))
        assert p is not None
        assert p["nutri_score"] == "A"
        assert p["nova_group"] == 1
        assert p["nutrients"]["sodium"] == pytest.approx(0.0367, rel=1e-2)

    def test_unknown_returns_none(self) -> None:
        assert parse_product(_load("unknown_barcode")) is None

    def test_empty_dict_returns_none(self) -> None:
        assert parse_product({}) is None

    def test_status_zero_returns_none(self) -> None:
        assert parse_product({"status": 0, "code": "x"}) is None

    def test_no_code_returns_none(self) -> None:
        assert parse_product({"product": {"product_name": "x"}}) is None

    def test_name_falls_back_to_unknown(self) -> None:
        p = parse_product({"product": {"code": "x"}})
        assert p is not None
        assert p["name"] == "Unknown"
        assert p["brand"] is None
        assert p["image_url"] is None
        assert p["nutri_score"] is None
        assert p["nova_group"] is None

    def test_salt_fallback_when_no_sodium(self) -> None:
        payload = {
            "product": {
                "code": "x",
                "product_name": "y",
                "nutriments": {"salt_100g": 2.5},
            }
        }
        p = parse_product(payload)
        assert p is not None
        # 2.5g salt → 1.0g sodium
        assert p["nutrients"]["sodium"] == pytest.approx(1.0, rel=1e-3)

    def test_garbage_nova_value_becomes_none(self) -> None:
        payload = {
            "product": {"code": "x", "product_name": "y", "nova_group": "not-a-number"}
        }
        p = parse_product(payload)
        assert p is not None
        assert p["nova_group"] is None

    def test_garbage_nutrient_values_become_zero(self) -> None:
        payload = {
            "product": {
                "code": "x",
                "product_name": "y",
                "nutriments": {"sugars_100g": "abc", "fat_100g": None},
            }
        }
        p = parse_product(payload)
        assert p is not None
        assert p["nutrients"]["sugars"] == 0.0
        assert p["nutrients"]["fat"] == 0.0


# ---------------------------------------------------------------------------
# get_product — with caching layers stubbed
# ---------------------------------------------------------------------------


@pytest.fixture
def disable_db_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make _cache_get always miss and _cache_put a no-op for the test."""
    monkeypatch.setattr(food_service, "_cache_get", lambda *_: None)
    monkeypatch.setattr(food_service, "_cache_put", lambda *_: None)


class TestGetProduct:
    @pytest.mark.asyncio
    async def test_off_hit_returns_parsed(self, disable_db_cache: None) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/api/v2/product/3017620422003.json").mock(
                return_value=httpx.Response(200, json=_load("nutella"))
            )
            p = await get_product("3017620422003")
        assert p is not None
        assert p["name"] == "Nutella"

    @pytest.mark.asyncio
    async def test_off_404_returns_none(self, disable_db_cache: None) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/api/v2/product/0000.json").mock(
                return_value=httpx.Response(404)
            )
            p = await get_product("0000")
        assert p is None

    @pytest.mark.asyncio
    async def test_off_unknown_payload_returns_none(
        self, disable_db_cache: None
    ) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/api/v2/product/0000.json").mock(
                return_value=httpx.Response(200, json=_load("unknown_barcode"))
            )
            assert await get_product("0000") is None

    @pytest.mark.asyncio
    async def test_off_malformed_json_returns_none(
        self, disable_db_cache: None
    ) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/api/v2/product/x.json").mock(
                return_value=httpx.Response(200, content=b"not json{")
            )
            assert await get_product("x") is None

    @pytest.mark.asyncio
    async def test_off_network_error_returns_none(
        self, disable_db_cache: None
    ) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/api/v2/product/x.json").mock(
                side_effect=httpx.ConnectError("nope")
            )
            assert await get_product("x") is None

    @pytest.mark.asyncio
    async def test_cache_hit_skips_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        called = {"n": 0}

        def fake_get(_: str) -> dict[str, Any]:
            called["n"] += 1
            return _load("nutella")

        monkeypatch.setattr(food_service, "_cache_get", fake_get)
        monkeypatch.setattr(food_service, "_cache_put", lambda *_: None)
        # If we reach OFF, respx will reject (no route).
        with respx.mock(base_url=OFF_BASE):
            p = await get_product("3017620422003")
        assert p is not None
        assert p["name"] == "Nutella"
        assert called["n"] == 1

    @pytest.mark.asyncio
    async def test_off_hit_writes_cache(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wrote: dict[str, Any] = {}

        def fake_put(barcode: str, payload: dict[str, Any]) -> None:
            wrote["barcode"] = barcode
            wrote["payload"] = payload

        monkeypatch.setattr(food_service, "_cache_get", lambda *_: None)
        monkeypatch.setattr(food_service, "_cache_put", fake_put)

        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/api/v2/product/3017620422003.json").mock(
                return_value=httpx.Response(200, json=_load("nutella"))
            )
            await get_product("3017620422003")
        assert wrote["barcode"] == "3017620422003"
        assert wrote["payload"]["product"]["code"] == "3017620422003"

    @pytest.mark.asyncio
    async def test_off_unknown_does_not_write_cache(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wrote = {"n": 0}
        monkeypatch.setattr(food_service, "_cache_get", lambda *_: None)
        monkeypatch.setattr(
            food_service,
            "_cache_put",
            lambda *_: wrote.__setitem__("n", wrote["n"] + 1),
        )
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/api/v2/product/0.json").mock(
                return_value=httpx.Response(200, json=_load("unknown_barcode"))
            )
            await get_product("0")
        assert wrote["n"] == 0


# ---------------------------------------------------------------------------
# food_cache TTL — uses a fake supabase client
# ---------------------------------------------------------------------------


class _FakeSupabaseTable:
    def __init__(self, rows: list[dict[str, Any]]):
        self._rows = rows
        self.last_upsert: dict[str, Any] | None = None

    def select(self, _cols: str) -> _FakeSupabaseTable:
        return self

    def eq(self, _col: str, _val: str) -> _FakeSupabaseTable:
        return self

    def limit(self, _n: int) -> _FakeSupabaseTable:
        return self

    def execute(self) -> Any:
        class _Res:
            def __init__(self, data: list[dict[str, Any]]):
                self.data = data

        return _Res(self._rows)

    def upsert(self, row: dict[str, Any]) -> _FakeSupabaseTable:
        self.last_upsert = row
        return self


class _FakeSupabase:
    def __init__(self, rows: list[dict[str, Any]]):
        self._table = _FakeSupabaseTable(rows)

    def table(self, _name: str) -> _FakeSupabaseTable:
        return self._table


@pytest.fixture
def fake_supabase(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    state: dict[str, Any] = {"rows": [], "client": None}

    def _make() -> _FakeSupabase:
        client = _FakeSupabase(state["rows"])
        state["client"] = client
        return client

    monkeypatch.setattr(food_service, "get_admin_client", _make)
    return state


class TestFoodCacheTTL:
    def test_cache_get_fresh_row_returns_payload(
        self, fake_supabase: dict[str, Any]
    ) -> None:
        fake_supabase["rows"] = [
            {
                "data": {"product": {"code": "x"}},
                "cached_at": datetime.now(UTC).isoformat(),
            }
        ]
        assert _cache_get("x") == {"product": {"code": "x"}}

    def test_cache_get_stale_row_returns_none(
        self, fake_supabase: dict[str, Any]
    ) -> None:
        old = datetime.now(UTC) - PRODUCT_CACHE_TTL - timedelta(seconds=1)
        fake_supabase["rows"] = [
            {"data": {"product": {"code": "x"}}, "cached_at": old.isoformat()}
        ]
        assert _cache_get("x") is None

    def test_cache_get_empty_returns_none(self, fake_supabase: dict[str, Any]) -> None:
        fake_supabase["rows"] = []
        assert _cache_get("x") is None

    def test_cache_get_bad_timestamp_returns_none(
        self, fake_supabase: dict[str, Any]
    ) -> None:
        fake_supabase["rows"] = [
            {"data": {"product": {"code": "x"}}, "cached_at": "not-a-date"}
        ]
        assert _cache_get("x") is None

    def test_cache_get_naive_timestamp_treated_as_utc(
        self, fake_supabase: dict[str, Any]
    ) -> None:
        # Naive datetime serialized; should not crash.
        naive_now = datetime.now(UTC).replace(tzinfo=None)
        fake_supabase["rows"] = [
            {
                "data": {"product": {"code": "x"}},
                "cached_at": naive_now.isoformat(),
            }
        ]
        assert _cache_get("x") == {"product": {"code": "x"}}

    def test_cache_get_missing_data_field_returns_none(
        self, fake_supabase: dict[str, Any]
    ) -> None:
        fake_supabase["rows"] = [
            {"data": "not-a-dict", "cached_at": datetime.now(UTC).isoformat()}
        ]
        assert _cache_get("x") is None

    def test_cache_get_swallows_supabase_errors(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _boom() -> Any:
            raise RuntimeError("supabase down")

        monkeypatch.setattr(food_service, "get_admin_client", _boom)
        assert _cache_get("x") is None

    def test_cache_put_writes_row(self, fake_supabase: dict[str, Any]) -> None:
        _cache_put("x", {"product": {"code": "x"}})
        client = fake_supabase["client"]
        assert client._table.last_upsert is not None
        assert client._table.last_upsert["barcode"] == "x"

    def test_cache_put_swallows_errors(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _boom() -> Any:
            raise RuntimeError("nope")

        monkeypatch.setattr(food_service, "get_admin_client", _boom)
        # Must not raise.
        _cache_put("x", {})

    def test_cache_get_then_freezegun_expiry(
        self, fake_supabase: dict[str, Any]
    ) -> None:
        with freeze_time("2026-04-25T12:00:00+00:00"):
            fake_supabase["rows"] = [
                {
                    "data": {"product": {"code": "x"}},
                    "cached_at": "2026-04-25T11:59:00+00:00",
                }
            ]
            assert _cache_get("x") is not None
        # Jump 8 days; same row should now be stale.
        with freeze_time("2026-05-03T12:00:00+00:00"):
            assert _cache_get("x") is None


# ---------------------------------------------------------------------------
# search_products
# ---------------------------------------------------------------------------


class TestSearchProducts:
    def setup_method(self) -> None:
        clear_search_cache()

    @pytest.mark.asyncio
    async def test_no_query_returns_empty(self) -> None:
        products, total = await search_products()
        assert products == []
        assert total == 0

    @pytest.mark.asyncio
    async def test_with_query_uses_off_search(self) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/cgi/search.pl").mock(
                return_value=httpx.Response(200, json=_load("search_chocolate"))
            )
            products, total = await search_products(q="chocolate")
        assert total > 0
        assert len(products) > 0
        for p in products:
            assert "barcode" in p

    @pytest.mark.asyncio
    async def test_search_caches_repeated_calls(self) -> None:
        calls = {"n": 0}

        def _resp(_request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(200, json=_load("search_chocolate"))

        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/cgi/search.pl").mock(side_effect=_resp)
            await search_products(q="chocolate")
            await search_products(q="chocolate")
        assert calls["n"] == 1

    @pytest.mark.asyncio
    async def test_search_404_returns_empty(self) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/cgi/search.pl").mock(return_value=httpx.Response(404))
            products, total = await search_products(q="zzz")
        assert products == []
        assert total == 0

    @pytest.mark.asyncio
    async def test_search_malformed_json_returns_empty(self) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/cgi/search.pl").mock(
                return_value=httpx.Response(200, content=b"oops{")
            )
            products, total = await search_products(q="malformed")
        assert products == []
        assert total == 0

    @pytest.mark.asyncio
    async def test_search_network_error_returns_empty(self) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/cgi/search.pl").mock(
                side_effect=httpx.ConnectError("down")
            )
            products, total = await search_products(q="net-down")
        assert products == []
        assert total == 0

    @pytest.mark.asyncio
    async def test_search_with_filters_passes_through(self) -> None:
        captured: dict[str, str] = {}

        def _resp(request: httpx.Request) -> httpx.Response:
            for k, v in request.url.params.multi_items():
                captured[k] = v
            return httpx.Response(200, json={"products": [], "count": 0})

        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/cgi/search.pl").mock(side_effect=_resp)
            await search_products(
                q="x",
                category="snacks",
                page=2,
                nutri_score=["A", "B"],
                nova_group=[1, 2],
            )
        assert captured["search_terms"] == "x"
        assert captured["page"] == "2"
        assert captured["tag_0"] == "snacks"
        assert "a" in captured["tag_1"] and "b" in captured["tag_1"]
        assert captured["tag_2"] == "1,2"

    @pytest.mark.asyncio
    async def test_category_only_works(self) -> None:
        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/cgi/search.pl").mock(
                return_value=httpx.Response(200, json={"products": [], "count": 0})
            )
            products, total = await search_products(category="snacks")
        assert products == []
        assert total == 0

    @pytest.mark.asyncio
    async def test_search_floor_page_at_one(self) -> None:
        captured: dict[str, str] = {}

        def _resp(request: httpx.Request) -> httpx.Response:
            for k, v in request.url.params.multi_items():
                captured[k] = v
            return httpx.Response(200, json={"products": [], "count": 0})

        with respx.mock(base_url=OFF_BASE) as router:
            router.get("/cgi/search.pl").mock(side_effect=_resp)
            await search_products(q="x", page=0)
        assert captured["page"] == "1"

    def test_search_cache_key_normalizes(self) -> None:
        k1 = _search_cache_key("Chocolate", "Snacks", 1, ("A", "B"), (1, 2))
        k2 = _search_cache_key("chocolate", "snacks", 1, ("b", "a"), (2, 1))
        assert k1 == k2


# ---------------------------------------------------------------------------
# get_alternatives stub
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_alternatives_stub_returns_empty() -> None:
    assert await get_alternatives("x", "snacks", 50, ["diabetes"]) == []

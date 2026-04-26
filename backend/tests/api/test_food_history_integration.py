"""Integration: viewing a food detail page records scan_history.

Covers the side-effect added to the barcode handler in T1.7. The detail
endpoint must NOT record history for guests, MUST record it for authed
users, and a scan_history failure MUST NOT break the response.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
import respx

from app.services import food_service
from tests.conftest import requires_supabase

CASSETTES = (
    Path(__file__).resolve().parent.parent / "cassettes" / "openfoodfacts"
)


def _load(name: str) -> dict:
    return json.loads((CASSETTES / f"{name}.json").read_text())


@pytest.fixture
def disable_food_cache() -> Iterator[None]:
    """Bypass food_cache so every test really hits the (mocked) OFF API."""
    original_get = food_service._cache_get
    original_put = food_service._cache_put
    food_service._cache_get = lambda *_a, **_k: None  # type: ignore[assignment]
    food_service._cache_put = lambda *_a, **_k: None  # type: ignore[assignment]
    try:
        yield
    finally:
        food_service._cache_get = original_get  # type: ignore[assignment]
        food_service._cache_put = original_put  # type: ignore[assignment]


@pytest.fixture
def stub_alternatives(monkeypatch: pytest.MonkeyPatch) -> None:
    """Short-circuit alternatives so respx mocks for the OFF product call are
    sufficient (no second OFF round-trip during these history-side-effect tests).
    """

    async def _empty(**_kwargs: object) -> list[object]:
        return []

    monkeypatch.setattr(food_service, "get_alternatives", _empty)


@requires_supabase
@pytest.mark.asyncio
async def test_authed_view_records_history(
    authed_client: tuple[httpx.AsyncClient, str, str],
    disable_food_cache: None,
    stub_alternatives: None,
    reset_db: None,
) -> None:
    client, _user_id, _token = authed_client
    payload = _load("nutella")
    with respx.mock(assert_all_called=False) as router:
        router.get(
            f"{food_service.OFF_BASE}/api/v2/product/3017620422003.json"
        ).mock(return_value=httpx.Response(200, json=payload))
        router.route(host="127.0.0.1").pass_through()
        res = await client.get("/api/food/barcode/3017620422003")
    assert res.status_code == 200

    history = (await client.get("/api/history")).json()["items"]
    assert len(history) == 1
    item = history[0]
    assert item["barcode"] == "3017620422003"
    # parse_product gives "Nutella" or similar from the cassette
    assert item["product_name"]
    assert isinstance(item["score"], int)


@requires_supabase
@pytest.mark.asyncio
async def test_anon_view_does_not_record_history(
    authed_client: tuple[httpx.AsyncClient, str, str],
    disable_food_cache: None,
    stub_alternatives: None,
    reset_db: None,
) -> None:
    """Anonymous food views must not insert scan_history rows.

    We use authed_client only to query history afterwards; the food
    request goes out without an Authorization header.
    """
    client, _user_id, _token = authed_client
    payload = _load("nutella")

    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as anon:
        with respx.mock(assert_all_called=False) as router:
            router.get(
                f"{food_service.OFF_BASE}/api/v2/product/3017620422003.json"
            ).mock(return_value=httpx.Response(200, json=payload))
            router.route(host="127.0.0.1").pass_through()
            res = await anon.get("/api/food/barcode/3017620422003")
        assert res.status_code == 200

    items = (await client.get("/api/history")).json()["items"]
    assert items == []


@pytest.mark.asyncio
async def test_404_does_not_attempt_history_insert(
    disable_food_cache: None,
    stub_alternatives: None,
) -> None:
    """If OFF returns no product, the handler 404s before history insert.

    Using an unauthed call here so we don't depend on Supabase.
    """
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as anon:
        with respx.mock(base_url=food_service.OFF_BASE) as router:
            router.get("/api/v2/product/0000.json").mock(
                return_value=httpx.Response(200, json=_load("unknown_barcode"))
            )
            res = await anon.get("/api/food/barcode/0000")
    assert res.status_code == 404


@requires_supabase
@pytest.mark.asyncio
async def test_history_insert_failure_does_not_break_response(
    authed_client: tuple[httpx.AsyncClient, str, str],
    disable_food_cache: None,
    stub_alternatives: None,
    reset_db: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Targeted test: the helper itself catches DB exceptions internally.

    Patches the supabase admin client to raise; the helper must log + return
    cleanly so the handler never sees the exception.
    """
    from app.api import food as food_api

    class _BoomTable:
        def insert(self, *_a: object, **_k: object) -> _BoomTable:
            raise RuntimeError("synthetic DB failure")

    class _BoomClient:
        def table(self, _name: str) -> _BoomTable:
            return _BoomTable()

    monkeypatch.setattr(food_api, "get_admin_client", lambda: _BoomClient())

    client, _user_id, _token = authed_client
    payload = _load("nutella")
    with respx.mock(assert_all_called=False) as router:
        router.get(
            f"{food_service.OFF_BASE}/api/v2/product/3017620422003.json"
        ).mock(return_value=httpx.Response(200, json=payload))
        router.route(host="127.0.0.1").pass_through()
        res = await client.get("/api/food/barcode/3017620422003")
    assert res.status_code == 200
    # And no history was actually written (because the insert raised).
    # We can't read it via /api/history because that also uses get_admin_client
    # which we just stubbed; we asserted the handler kept working, which is
    # what FR-7 best-effort behaviour requires.

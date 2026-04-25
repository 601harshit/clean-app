"""Tests for GET /api/food/barcode/{barcode}.

Uses recorded OFF cassettes plus a stubbed _cache_get/_cache_put so we
can run without hitting the network or the food_cache table.

Auth path is exercised end-to-end via local Supabase: the authed_client
fixture creates a real user, mints a JWT, and the endpoint resolves
profile.health_conditions via supabase-admin.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from supabase import Client

from app.services import food_service, llm_service
from tests.conftest import requires_supabase

CASSETTES = Path(__file__).resolve().parent.parent / "cassettes" / "openfoodfacts"
CLAUDE_CASSETTES = Path(__file__).resolve().parent.parent / "cassettes" / "claude"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def _load(name: str) -> dict[str, Any]:
    return json.loads((CASSETTES / f"{name}.json").read_text())


def _load_claude(name: str) -> dict[str, Any]:
    return json.loads((CLAUDE_CASSETTES / f"{name}.json").read_text())


@pytest.fixture
def disable_db_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(food_service, "_cache_get", lambda *_: None)
    monkeypatch.setattr(food_service, "_cache_put", lambda *_: None)


@pytest.fixture
def stub_body_impact(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the body-impact step a no-op so tests not about LLM stay fast.

    Returns None — the LLM-failure shape — so existing tests that asserted
    ``body_impact is None`` continue to pass without touching the network.
    """

    async def _none(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(llm_service, "get_body_impact", _none)


@pytest.mark.asyncio
async def test_404_when_off_unknown(
    unauthed_client: httpx.AsyncClient,
    disable_db_cache: None,
    stub_body_impact: None,
) -> None:
    with respx.mock(base_url=food_service.OFF_BASE) as router:
        router.get("/api/v2/product/0000.json").mock(
            return_value=httpx.Response(200, json=_load("unknown_barcode"))
        )
        res = await unauthed_client.get("/api/food/barcode/0000")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_unauth_returns_generic_score(
    unauthed_client: httpx.AsyncClient,
    disable_db_cache: None,
    stub_body_impact: None,
) -> None:
    with respx.mock(base_url=food_service.OFF_BASE) as router:
        router.get("/api/v2/product/3017620422003.json").mock(
            return_value=httpx.Response(200, json=_load("nutella"))
        )
        res = await unauthed_client.get("/api/food/barcode/3017620422003")
    assert res.status_code == 200
    body = res.json()
    assert body["barcode"] == "3017620422003"
    assert body["personalized"] is False
    # Generic Nutella: base 20 (E) + NOVA-4 -20 = 0
    assert body["score"] == 0
    assert body["score_label"] == "Avoid"
    assert body["alternatives"] == []  # T1.6 stub


@pytest.mark.asyncio
async def test_breakdown_sorted_by_abs_impact(
    unauthed_client: httpx.AsyncClient,
    disable_db_cache: None,
    stub_body_impact: None,
) -> None:
    with respx.mock(base_url=food_service.OFF_BASE) as router:
        router.get("/api/v2/product/3017620422003.json").mock(
            return_value=httpx.Response(200, json=_load("nutella"))
        )
        body = (
            await unauthed_client.get("/api/food/barcode/3017620422003")
        ).json()
    impacts = [abs(f["impact"]) for f in body["score_breakdown"]]
    assert impacts == sorted(impacts, reverse=True)


@pytest.mark.asyncio
async def test_nutrients_returned(
    unauthed_client: httpx.AsyncClient,
    disable_db_cache: None,
    stub_body_impact: None,
) -> None:
    with respx.mock(base_url=food_service.OFF_BASE) as router:
        router.get("/api/v2/product/3017620422003.json").mock(
            return_value=httpx.Response(200, json=_load("nutella"))
        )
        body = (
            await unauthed_client.get("/api/food/barcode/3017620422003")
        ).json()
    n = body["nutrients"]
    assert n["sugars"] == 56.3
    assert n["saturated_fat"] == 10.6


@pytest.mark.asyncio
async def test_greek_yogurt_high_score(
    unauthed_client: httpx.AsyncClient,
    disable_db_cache: None,
    stub_body_impact: None,
) -> None:
    with respx.mock(base_url=food_service.OFF_BASE) as router:
        router.get("/api/v2/product/0894700010014.json").mock(
            return_value=httpx.Response(200, json=_load("greek_yogurt"))
        )
        body = (
            await unauthed_client.get("/api/food/barcode/0894700010014")
        ).json()
    # Greek yogurt: base A=80, NOVA-1=0 → 80
    assert body["score"] == 80
    assert body["score_label"] == "Excellent"


@pytest.mark.asyncio
async def test_invalid_token_treated_as_anonymous(
    disable_db_cache: None,
    stub_body_impact: None,
) -> None:
    """If JWT decoding fails, the user is treated as anonymous (not 401)."""
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": "Bearer not-a-valid-jwt"},
    ) as client:
        with respx.mock(base_url=food_service.OFF_BASE) as router:
            router.get("/api/v2/product/3017620422003.json").mock(
                return_value=httpx.Response(200, json=_load("nutella"))
            )
            res = await client.get("/api/food/barcode/3017620422003")
    assert res.status_code == 200
    assert res.json()["personalized"] is False


# ---------------------------------------------------------------------------
# body_impact end-to-end — Claude is mocked at the HTTP layer.
#
# These tests skip the llm_service stub fixture and instead let the real
# llm_service code path run against a respx-mocked Anthropic API. The
# food_insights cache is exercised via the live Supabase client, so we
# bracket each test with a small helper that purges the row(s) we touch.
# ---------------------------------------------------------------------------


def _wipe_insights(supabase: Client, barcode: str) -> None:
    try:
        supabase.table("food_insights").delete().eq("barcode", barcode).execute()
    except Exception:
        # Local Supabase isn't running — caller will skip via marker.
        pass


@requires_supabase
@pytest.mark.asyncio
async def test_body_impact_populated_on_success(
    unauthed_client: httpx.AsyncClient,
    disable_db_cache: None,
    supabase_admin: Client,
) -> None:
    """Cache miss → Claude HTTP mock → response body carries the summary."""
    _wipe_insights(supabase_admin, "0894700010014")
    cassette = _load_claude("body_impact_yogurt_guest")
    expected = cassette["content"][0]["text"]

    with respx.mock(assert_all_called=False) as router:
        router.get(
            f"{food_service.OFF_BASE}/api/v2/product/0894700010014.json"
        ).mock(return_value=httpx.Response(200, json=_load("greek_yogurt")))
        router.post(ANTHROPIC_URL).mock(
            return_value=httpx.Response(200, json=cassette)
        )
        router.route(host="127.0.0.1").pass_through()
        res = await unauthed_client.get("/api/food/barcode/0894700010014")

    assert res.status_code == 200
    assert res.json()["body_impact"] == expected
    _wipe_insights(supabase_admin, "0894700010014")


@requires_supabase
@pytest.mark.asyncio
async def test_body_impact_none_on_anthropic_failure(
    unauthed_client: httpx.AsyncClient,
    disable_db_cache: None,
    supabase_admin: Client,
) -> None:
    """Claude returns 5xx → endpoint still 200s with body_impact: null."""
    _wipe_insights(supabase_admin, "3017620422003")

    with respx.mock(assert_all_called=False) as router:
        router.get(
            f"{food_service.OFF_BASE}/api/v2/product/3017620422003.json"
        ).mock(return_value=httpx.Response(200, json=_load("nutella")))
        router.post(ANTHROPIC_URL).mock(
            return_value=httpx.Response(500, json={"error": "down"})
        )
        router.route(host="127.0.0.1").pass_through()
        res = await unauthed_client.get("/api/food/barcode/3017620422003")

    assert res.status_code == 200
    assert res.json()["body_impact"] is None
    _wipe_insights(supabase_admin, "3017620422003")


@requires_supabase
@pytest.mark.asyncio
async def test_body_impact_cache_hit_skips_anthropic(
    unauthed_client: httpx.AsyncClient,
    disable_db_cache: None,
    supabase_admin: Client,
) -> None:
    """Pre-populated food_insights row is served without an Anthropic call."""
    barcode = "0894700010014"
    _wipe_insights(supabase_admin, barcode)
    supabase_admin.table("food_insights").upsert(
        {
            "barcode": barcode,
            "conditions_key": "",
            "message": "preloaded summary from cache",
        }
    ).execute()

    with respx.mock(assert_all_called=False) as router:
        router.get(
            f"{food_service.OFF_BASE}/api/v2/product/{barcode}.json"
        ).mock(return_value=httpx.Response(200, json=_load("greek_yogurt")))
        # Any anthropic call is a route miss → respx raises.
        anthropic_route = router.post(ANTHROPIC_URL)
        router.route(host="127.0.0.1").pass_through()
        res = await unauthed_client.get(f"/api/food/barcode/{barcode}")

    assert res.status_code == 200
    assert res.json()["body_impact"] == "preloaded summary from cache"
    assert anthropic_route.call_count == 0
    _wipe_insights(supabase_admin, barcode)


# ---------------------------------------------------------------------------
# Auth path — runs only when local Supabase is up (skipped in CI without it).
# ---------------------------------------------------------------------------


@requires_supabase
@pytest.mark.asyncio
async def test_authed_user_with_diabetes_personalized(
    authed_client: tuple[httpx.AsyncClient, str, str],
    supabase_admin: Client,
    disable_db_cache: None,
    stub_body_impact: None,
) -> None:
    client, user_id, _token = authed_client
    # Set the user's health_conditions to include diabetes.
    supabase_admin.table("profiles").update(
        {"health_conditions": ["diabetes"]}
    ).eq("id", user_id).execute()

    # Mock OFF, pass-through 127.0.0.1 so the endpoint's profile lookup
    # against local Supabase actually hits the real local stack.
    with respx.mock(assert_all_called=False) as router:
        router.get(
            f"{food_service.OFF_BASE}/api/v2/product/3017620422003.json"
        ).mock(return_value=httpx.Response(200, json=_load("nutella")))
        router.route(host="127.0.0.1").pass_through()
        res = await client.get("/api/food/barcode/3017620422003")

    assert res.status_code == 200
    body = res.json()
    assert body["personalized"] is True
    # E base 20, NOVA-4 -20, diabetes (sugar -15, carbs -5) = -20 → clamp 0
    assert body["score"] == 0
    factors = {f["factor"] for f in body["score_breakdown"]}
    assert "High sugar" in factors


@requires_supabase
@pytest.mark.asyncio
async def test_authed_user_no_conditions_not_personalized(
    authed_client: tuple[httpx.AsyncClient, str, str],
    disable_db_cache: None,
    stub_body_impact: None,
) -> None:
    client, _user_id, _token = authed_client
    # Default profile is created with empty health_conditions.
    with respx.mock(assert_all_called=False) as router:
        router.get(
            f"{food_service.OFF_BASE}/api/v2/product/0894700010014.json"
        ).mock(return_value=httpx.Response(200, json=_load("greek_yogurt")))
        router.route(host="127.0.0.1").pass_through()
        res = await client.get("/api/food/barcode/0894700010014")
    body = res.json()
    assert body["personalized"] is False

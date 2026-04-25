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

from app.services import food_service
from tests.conftest import requires_supabase

CASSETTES = Path(__file__).resolve().parent.parent / "cassettes" / "openfoodfacts"


def _load(name: str) -> dict[str, Any]:
    return json.loads((CASSETTES / f"{name}.json").read_text())


@pytest.fixture
def disable_db_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(food_service, "_cache_get", lambda *_: None)
    monkeypatch.setattr(food_service, "_cache_put", lambda *_: None)


@pytest.mark.asyncio
async def test_404_when_off_unknown(
    unauthed_client: httpx.AsyncClient, disable_db_cache: None
) -> None:
    with respx.mock(base_url=food_service.OFF_BASE) as router:
        router.get("/api/v2/product/0000.json").mock(
            return_value=httpx.Response(200, json=_load("unknown_barcode"))
        )
        res = await unauthed_client.get("/api/food/barcode/0000")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_unauth_returns_generic_score(
    unauthed_client: httpx.AsyncClient, disable_db_cache: None
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
    assert body["body_impact"] is None  # T1.4 stub
    assert body["alternatives"] == []  # T1.6 stub


@pytest.mark.asyncio
async def test_breakdown_sorted_by_abs_impact(
    unauthed_client: httpx.AsyncClient, disable_db_cache: None
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
    unauthed_client: httpx.AsyncClient, disable_db_cache: None
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
    unauthed_client: httpx.AsyncClient, disable_db_cache: None
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
# Auth path — runs only when local Supabase is up (skipped in CI without it).
# ---------------------------------------------------------------------------


@requires_supabase
@pytest.mark.asyncio
async def test_authed_user_with_diabetes_personalized(
    authed_client: tuple[httpx.AsyncClient, str, str],
    supabase_admin: Client,
    disable_db_cache: None,
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

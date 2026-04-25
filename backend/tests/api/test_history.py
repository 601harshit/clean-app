"""Tests for /api/history (GET + DELETE).

Most paths require the local Supabase stack — auth-protected and we
seed real rows. The 401 sad-paths run against the FastAPI app directly.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from supabase import Client

from tests.conftest import requires_supabase


@pytest_asyncio.fixture
async def unauthed_client() -> AsyncIterator[httpx.AsyncClient]:
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        yield client


def _seed_history(
    supabase_admin: Client,
    user_id: str,
    *,
    barcode: str,
    name: str,
    score: int,
    scanned_at: datetime,
    brand: str | None = None,
    image_url: str | None = None,
) -> None:
    supabase_admin.table("scan_history").insert(
        {
            "user_id": user_id,
            "barcode": barcode,
            "product_name": name,
            "brand": brand,
            "image_url": image_url,
            "score": score,
            "scanned_at": scanned_at.isoformat(),
        }
    ).execute()


# ---------------------------------------------------------------------------
# Auth/sad-path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_history_requires_auth(
    unauthed_client: httpx.AsyncClient,
) -> None:
    res = await unauthed_client.get("/api/history")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_delete_history_requires_auth(
    unauthed_client: httpx.AsyncClient,
) -> None:
    res = await unauthed_client.delete("/api/history")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_history_invalid_token_401(
    unauthed_client: httpx.AsyncClient,
) -> None:
    res = await unauthed_client.get(
        "/api/history", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# Auth/happy-path
# ---------------------------------------------------------------------------


@requires_supabase
@pytest.mark.asyncio
async def test_get_history_empty_for_new_user(
    authed_client: tuple[httpx.AsyncClient, str, str],
    reset_db: None,
) -> None:
    client, _user_id, _token = authed_client
    res = await client.get("/api/history")
    assert res.status_code == 200
    assert res.json() == {"items": []}


@requires_supabase
@pytest.mark.asyncio
async def test_get_history_returns_seeded_rows(
    authed_client: tuple[httpx.AsyncClient, str, str],
    supabase_admin: Client,
    reset_db: None,
) -> None:
    client, user_id, _token = authed_client
    now = datetime.now(UTC)
    _seed_history(
        supabase_admin,
        user_id,
        barcode="3017620422003",
        name="Nutella",
        brand="Ferrero",
        image_url="https://img/nutella.jpg",
        score=12,
        scanned_at=now,
    )
    res = await client.get("/api/history")
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["barcode"] == "3017620422003"
    assert item["product_name"] == "Nutella"
    assert item["brand"] == "Ferrero"
    assert item["image_url"] == "https://img/nutella.jpg"
    assert item["score"] == 12
    assert "scanned_at" in item
    assert "id" in item


@requires_supabase
@pytest.mark.asyncio
async def test_get_history_ordered_desc_by_scanned_at(
    authed_client: tuple[httpx.AsyncClient, str, str],
    supabase_admin: Client,
    reset_db: None,
) -> None:
    client, user_id, _token = authed_client
    base = datetime.now(UTC) - timedelta(days=3)
    _seed_history(
        supabase_admin,
        user_id,
        barcode="A",
        name="Oldest",
        score=10,
        scanned_at=base,
    )
    _seed_history(
        supabase_admin,
        user_id,
        barcode="B",
        name="Middle",
        score=20,
        scanned_at=base + timedelta(days=1),
    )
    _seed_history(
        supabase_admin,
        user_id,
        barcode="C",
        name="Newest",
        score=30,
        scanned_at=base + timedelta(days=2),
    )
    items = (await client.get("/api/history")).json()["items"]
    names = [it["product_name"] for it in items]
    assert names == ["Newest", "Middle", "Oldest"]


@requires_supabase
@pytest.mark.asyncio
async def test_get_history_limited_to_20(
    authed_client: tuple[httpx.AsyncClient, str, str],
    supabase_admin: Client,
    reset_db: None,
) -> None:
    client, user_id, _token = authed_client
    base = datetime.now(UTC) - timedelta(days=30)
    for i in range(25):
        _seed_history(
            supabase_admin,
            user_id,
            barcode=f"BC-{i}",
            name=f"Item {i}",
            score=i,
            scanned_at=base + timedelta(minutes=i),
        )
    items = (await client.get("/api/history")).json()["items"]
    assert len(items) == 20
    # The 20 newest (indices 24..5) should be returned, newest first.
    assert items[0]["product_name"] == "Item 24"
    assert items[-1]["product_name"] == "Item 5"


@requires_supabase
@pytest.mark.asyncio
async def test_delete_history_clears_only_caller_rows(
    authed_client: tuple[httpx.AsyncClient, str, str],
    supabase_admin: Client,
    reset_db: None,
) -> None:
    client, user_a_id, _token = authed_client
    # Create a second user with their own history rows.
    user_b_email = f"hist-iso-{uuid4()}@example.com"
    create_res = supabase_admin.auth.admin.create_user(
        {
            "email": user_b_email,
            "password": "testpass-12345",
            "email_confirm": True,
        }
    )
    user_b_id: str = create_res.user.id  # type: ignore[union-attr]
    try:
        now = datetime.now(UTC)
        _seed_history(
            supabase_admin,
            user_a_id,
            barcode="A1",
            name="A's row",
            score=50,
            scanned_at=now,
        )
        _seed_history(
            supabase_admin,
            user_b_id,
            barcode="B1",
            name="B's row",
            score=60,
            scanned_at=now,
        )

        res = await client.delete("/api/history")
        assert res.status_code == 204
        assert res.content == b""

        # User A history is empty.
        a_items = (await client.get("/api/history")).json()["items"]
        assert a_items == []

        # User B's row is untouched.
        b_rows = (
            supabase_admin.table("scan_history")
            .select("product_name")
            .eq("user_id", user_b_id)
            .execute()
        )
        assert len(b_rows.data) == 1
        assert b_rows.data[0]["product_name"] == "B's row"
    finally:
        supabase_admin.auth.admin.delete_user(user_b_id)


@requires_supabase
@pytest.mark.asyncio
async def test_user_a_does_not_see_user_b_history(
    authed_client: tuple[httpx.AsyncClient, str, str],
    supabase_admin: Client,
    reset_db: None,
) -> None:
    client_a, _user_a_id, _token_a = authed_client
    user_b_email = f"hist-rls-{uuid4()}@example.com"
    create_res = supabase_admin.auth.admin.create_user(
        {
            "email": user_b_email,
            "password": "testpass-12345",
            "email_confirm": True,
        }
    )
    user_b_id: str = create_res.user.id  # type: ignore[union-attr]
    try:
        _seed_history(
            supabase_admin,
            user_b_id,
            barcode="ZZZ",
            name="B-only",
            score=99,
            scanned_at=datetime.now(UTC),
        )
        items = (await client_a.get("/api/history")).json()["items"]
        # User A must see none of B's rows.
        assert all(it["product_name"] != "B-only" for it in items)
        assert items == []
    finally:
        supabase_admin.auth.admin.delete_user(user_b_id)


@requires_supabase
@pytest.mark.asyncio
async def test_delete_history_idempotent(
    authed_client: tuple[httpx.AsyncClient, str, str],
    reset_db: None,
) -> None:
    """Deleting an already-empty history must still return 204."""
    client, _user_id, _token = authed_client
    res1 = await client.delete("/api/history")
    assert res1.status_code == 204
    res2 = await client.delete("/api/history")
    assert res2.status_code == 204



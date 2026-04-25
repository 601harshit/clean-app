"""Tests for /api/profile (GET + PUT).

The endpoints require a valid Supabase JWT, so the auth-path tests use
the `authed_client` fixture which talks to the real local Supabase
stack. The unauth case is verified against the FastAPI app directly.

Critical scenario: RLS isolation — user A must never see user B's row.
We exercise this end-to-end by writing to user B's row via the admin
client and then asserting user A's GET response excludes those values.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from supabase import Client

from tests.conftest import mint_jwt, requires_supabase


@pytest_asyncio.fixture
async def unauthed_client() -> AsyncIterator[httpx.AsyncClient]:
    # Local copy so this test file is self-contained for clarity.
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        yield client


# ---------------------------------------------------------------------------
# Auth/sad-path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_profile_requires_auth(
    unauthed_client: httpx.AsyncClient,
) -> None:
    res = await unauthed_client.get("/api/profile")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_put_profile_requires_auth(
    unauthed_client: httpx.AsyncClient,
) -> None:
    res = await unauthed_client.put(
        "/api/profile", json={"health_conditions": ["diabetes"]}
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_profile_invalid_token_401(
    unauthed_client: httpx.AsyncClient,
) -> None:
    res = await unauthed_client.get(
        "/api/profile", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_put_profile_invalid_condition_422(
    unauthed_client: httpx.AsyncClient,
) -> None:
    """Validation runs before auth dependency since FastAPI parses the
    body alongside dependencies; we still want a 4xx for bad input.

    Either 422 (validation) or 401 (auth) is acceptable for an unauthed
    bad-input request, but we expect 422 if FastAPI processes the body
    schema first. To pin the validator behaviour we send a token so auth
    succeeds — even if the user_id is fake, the body must still 422 first.
    """
    fake_token = mint_jwt(str(uuid4()))
    res = await unauthed_client.put(
        "/api/profile",
        json={"health_conditions": ["diabetes", "evil-condition"]},
        headers={"Authorization": f"Bearer {fake_token}"},
    )
    assert res.status_code == 422
    body = res.json()
    # Pydantic v2 validation message includes the offending value
    assert "evil-condition" in str(body)


@pytest.mark.asyncio
async def test_put_profile_missing_field_422(
    unauthed_client: httpx.AsyncClient,
) -> None:
    fake_token = mint_jwt(str(uuid4()))
    res = await unauthed_client.put(
        "/api/profile",
        json={},
        headers={"Authorization": f"Bearer {fake_token}"},
    )
    assert res.status_code == 422


# ---------------------------------------------------------------------------
# Auth/happy-path — local Supabase required
# ---------------------------------------------------------------------------


@requires_supabase
@pytest.mark.asyncio
async def test_get_profile_default_empty(
    authed_client: tuple[httpx.AsyncClient, str, str],
    reset_db: None,
) -> None:
    client, _user_id, _token = authed_client
    res = await client.get("/api/profile")
    assert res.status_code == 200
    assert res.json() == {"health_conditions": []}


@requires_supabase
@pytest.mark.asyncio
async def test_put_profile_persists_and_get_reads_back(
    authed_client: tuple[httpx.AsyncClient, str, str],
    reset_db: None,
) -> None:
    client, _user_id, _token = authed_client
    res = await client.put(
        "/api/profile",
        json={"health_conditions": ["diabetes", "hypertension"]},
    )
    assert res.status_code == 200
    assert res.json() == {"health_conditions": ["diabetes", "hypertension"]}

    res2 = await client.get("/api/profile")
    assert res2.status_code == 200
    assert sorted(res2.json()["health_conditions"]) == ["diabetes", "hypertension"]


@requires_supabase
@pytest.mark.asyncio
async def test_put_profile_can_clear_conditions(
    authed_client: tuple[httpx.AsyncClient, str, str],
    reset_db: None,
) -> None:
    client, _user_id, _token = authed_client
    await client.put(
        "/api/profile", json={"health_conditions": ["obesity"]}
    )
    res = await client.put("/api/profile", json={"health_conditions": []})
    assert res.status_code == 200
    assert res.json() == {"health_conditions": []}


@requires_supabase
@pytest.mark.asyncio
async def test_put_profile_dedupes(
    authed_client: tuple[httpx.AsyncClient, str, str],
    reset_db: None,
) -> None:
    client, _user_id, _token = authed_client
    res = await client.put(
        "/api/profile",
        json={"health_conditions": ["diabetes", "diabetes", "obesity"]},
    )
    assert res.status_code == 200
    assert res.json() == {"health_conditions": ["diabetes", "obesity"]}


@requires_supabase
@pytest.mark.asyncio
async def test_put_profile_all_four_conditions(
    authed_client: tuple[httpx.AsyncClient, str, str],
    reset_db: None,
) -> None:
    client, _user_id, _token = authed_client
    all_four = ["diabetes", "cholesterol", "hypertension", "obesity"]
    res = await client.put("/api/profile", json={"health_conditions": all_four})
    assert res.status_code == 200
    assert sorted(res.json()["health_conditions"]) == sorted(all_four)


# ---------------------------------------------------------------------------
# RLS / data isolation — critical
# ---------------------------------------------------------------------------


@requires_supabase
@pytest.mark.asyncio
async def test_user_a_cannot_see_user_b_conditions(
    authed_client: tuple[httpx.AsyncClient, str, str],
    supabase_admin: Client,
    reset_db: None,
) -> None:
    """Set conditions on user B via admin client, then verify user A's
    GET /api/profile only returns A's conditions (default empty).
    """
    client_a, user_a_id, _token_a = authed_client

    # Create a separate user B and set distinct conditions on their row.
    user_b_email = f"isolation-{uuid4()}@example.com"
    create_res = supabase_admin.auth.admin.create_user(
        {
            "email": user_b_email,
            "password": "testpass-12345",
            "email_confirm": True,
        }
    )
    user_b_id: str = create_res.user.id  # type: ignore[union-attr]
    try:
        supabase_admin.table("profiles").update(
            {"health_conditions": ["cholesterol", "obesity"]}
        ).eq("id", user_b_id).execute()

        # User A reads their own profile — must NOT contain B's values.
        res_a = await client_a.get("/api/profile")
        assert res_a.status_code == 200
        assert res_a.json() == {"health_conditions": []}

        # User A sets their own conditions; verify B's row is untouched.
        await client_a.put(
            "/api/profile", json={"health_conditions": ["diabetes"]}
        )
        b_row: Any = (
            supabase_admin.table("profiles")
            .select("health_conditions")
            .eq("id", user_b_id)
            .single()
            .execute()
        )
        assert sorted(b_row.data["health_conditions"]) == ["cholesterol", "obesity"]

        # And A's row has only diabetes.
        a_row: Any = (
            supabase_admin.table("profiles")
            .select("health_conditions")
            .eq("id", user_a_id)
            .single()
            .execute()
        )
        assert a_row.data["health_conditions"] == ["diabetes"]
    finally:
        supabase_admin.auth.admin.delete_user(user_b_id)


# ---------------------------------------------------------------------------
# DB failure → 500 (covers the except branches)
# ---------------------------------------------------------------------------


@requires_supabase
@pytest.mark.asyncio
async def test_get_profile_db_failure_returns_500(
    authed_client: tuple[httpx.AsyncClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import profile as profile_api

    def boom(*_a: object, **_k: object) -> list[str]:
        raise RuntimeError("synthetic DB failure")

    monkeypatch.setattr(profile_api, "_read_conditions", boom)

    client, _user_id, _token = authed_client
    res = await client.get("/api/profile")
    assert res.status_code == 500


@requires_supabase
@pytest.mark.asyncio
async def test_put_profile_db_failure_returns_500(
    authed_client: tuple[httpx.AsyncClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import profile as profile_api

    class _BoomTable:
        def upsert(self, *_a: object, **_k: object) -> _BoomTable:
            raise RuntimeError("synthetic DB failure")

    class _BoomClient:
        def table(self, _name: str) -> _BoomTable:
            return _BoomTable()

    monkeypatch.setattr(profile_api, "get_admin_client", lambda: _BoomClient())

    client, _user_id, _token = authed_client
    res = await client.put(
        "/api/profile", json={"health_conditions": ["diabetes"]}
    )
    assert res.status_code == 500


@requires_supabase
@pytest.mark.asyncio
async def test_read_conditions_handles_corrupt_field(
    authed_client: tuple[httpx.AsyncClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Defensive branch: if the row's health_conditions field is not a
    list (corrupt data), the helper returns [] instead of raising.
    """
    from app.api import profile as profile_api

    class _Result:
        data = [{"health_conditions": "not-a-list"}]

    class _Builder:
        def select(self, *_a: object, **_k: object) -> _Builder:
            return self

        def eq(self, *_a: object, **_k: object) -> _Builder:
            return self

        def limit(self, *_a: object, **_k: object) -> _Builder:
            return self

        def execute(self) -> _Result:
            return _Result()

    class _Client:
        def table(self, _name: str) -> _Builder:
            return _Builder()

    monkeypatch.setattr(profile_api, "get_admin_client", lambda: _Client())

    client, _user_id, _token = authed_client
    res = await client.get("/api/profile")
    assert res.status_code == 200
    assert res.json() == {"health_conditions": []}


@requires_supabase
@pytest.mark.asyncio
async def test_get_profile_handles_missing_row(
    supabase_admin: Client,
    reset_db: None,
) -> None:
    """If a user somehow exists without a profiles row (older account,
    trigger off), GET should still 200 with empty conditions.
    """
    email = f"no-profile-{uuid4()}@example.com"
    create_res = supabase_admin.auth.admin.create_user(
        {"email": email, "password": "testpass-12345", "email_confirm": True}
    )
    user_id: str = create_res.user.id  # type: ignore[union-attr]
    try:
        # Delete the auto-created profiles row to simulate an orphan auth user.
        supabase_admin.table("profiles").delete().eq("id", user_id).execute()
        token = mint_jwt(user_id)

        from app.main import app

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {token}"},
        ) as client:
            res = await client.get("/api/profile")

        assert res.status_code == 200
        assert res.json() == {"health_conditions": []}
    finally:
        supabase_admin.auth.admin.delete_user(user_id)

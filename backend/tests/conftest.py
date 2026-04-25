"""Shared pytest fixtures for the Clean. backend test suite.

Conventions live in /Users/harshitagarwal/Project/docs/testing.md.

The local Supabase stack is started independently via `supabase start`
(see scripts/db-reset.sh). Tests assume it is running on the default
ports — fixtures will skip with a clear message if not.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from jose import jwt
from supabase import Client, create_client

LOCAL_SUPABASE_URL = "http://127.0.0.1:54321"
LOCAL_SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9."
    "CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
)
LOCAL_SUPABASE_SERVICE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0."
    "EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
)
LOCAL_SUPABASE_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long"

CASSETTE_DIR = Path(__file__).parent / "cassettes"


def _supabase_running() -> bool:
    try:
        r = httpx.get(f"{LOCAL_SUPABASE_URL}/auth/v1/health", timeout=1.0)
        return r.status_code < 500
    except Exception:
        return False


requires_supabase = pytest.mark.skipif(
    not _supabase_running(),
    reason="local Supabase not running — start with `supabase start`",
)


@pytest.fixture(scope="session")
def supabase_admin() -> Client:
    """Service-role Supabase client against local stack."""
    return create_client(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_SERVICE_KEY)


@pytest.fixture
def reset_db(supabase_admin: Client) -> Iterator[None]:
    """Truncate user-scoped tables between tests.

    Does NOT touch food_cache (harmless to share across tests; tests that
    care should clear it explicitly).
    """
    yield
    if not _supabase_running():
        return
    pg_meta_url = f"{LOCAL_SUPABASE_URL}/pg/query"
    httpx.post(
        pg_meta_url,
        headers={
            "Authorization": f"Bearer {LOCAL_SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "query": (
                "truncate public.scan_history, public.food_insights, "
                "public.profiles restart identity cascade;"
            )
        },
        timeout=5.0,
    )


def mint_jwt(user_id: str, ttl_seconds: int = 3600) -> str:
    """Sign an HS256 Supabase-shaped JWT for the given user_id.

    Used by tests to call authenticated endpoints without going through
    the full sign-in flow.
    """
    now = int(time.time())
    payload = {
        "sub": user_id,
        "aud": "authenticated",
        "role": "authenticated",
        "iss": f"{LOCAL_SUPABASE_URL}/auth/v1",
        "iat": now,
        "exp": now + ttl_seconds,
    }
    return jwt.encode(payload, LOCAL_SUPABASE_JWT_SECRET, algorithm="HS256")


@pytest_asyncio.fixture
async def authed_client(
    supabase_admin: Client,
) -> AsyncIterator[tuple[httpx.AsyncClient, str, str]]:
    """Yield (client, user_id, jwt) for an authenticated test user.

    Creates a real Supabase auth user (so the handle_new_user trigger fires
    and a profiles row is auto-created), mints a JWT, and cleans up.
    """
    if not _supabase_running():
        pytest.skip("local Supabase not running")

    email = f"test-{uuid4()}@example.com"
    res = supabase_admin.auth.admin.create_user(
        {"email": email, "password": "testpass-12345", "email_confirm": True}
    )
    user_id = res.user.id  # type: ignore[union-attr]
    token = mint_jwt(user_id)

    # Lazy-import the FastAPI app so a missing local Supabase doesn't break
    # collection for tests that don't need an authed client.
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        yield client, user_id, token

    supabase_admin.auth.admin.delete_user(user_id)


@pytest_asyncio.fixture
async def unauthed_client() -> AsyncIterator[httpx.AsyncClient]:
    """Yield an httpx.AsyncClient bound to the FastAPI app, no auth header."""
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def cassette_dir() -> Path:
    return CASSETTE_DIR


def load_cassette(*parts: str) -> dict[str, Any]:
    """Load a JSON cassette by path under tests/cassettes/."""
    path = CASSETTE_DIR.joinpath(*parts)
    return json.loads(path.read_text())


@pytest.fixture
def load_cassette_fn() -> Any:
    return load_cassette


@pytest.fixture(autouse=True)
def _local_supabase_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure backend code reading env sees local Supabase by default.

    Tests can override individual vars via monkeypatch.setenv.
    """
    monkeypatch.setenv("SUPABASE_URL", LOCAL_SUPABASE_URL)
    monkeypatch.setenv("SUPABASE_ANON_KEY", LOCAL_SUPABASE_ANON_KEY)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", LOCAL_SUPABASE_SERVICE_KEY)
    monkeypatch.setenv("SUPABASE_JWT_SECRET", LOCAL_SUPABASE_JWT_SECRET)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    # Clear cached Settings so the new env is picked up
    from app.core.config import get_settings

    get_settings.cache_clear()


@pytest.fixture
def freeze_settings_cache() -> Iterator[None]:
    """For tests that need a fresh Settings instance after env changes."""
    from app.core.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# Make the marker available on the module for test imports
pytest.requires_supabase = requires_supabase  # type: ignore[attr-defined]

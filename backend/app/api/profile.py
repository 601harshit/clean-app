"""HTTP endpoints under /api/profile.

Two routes:
- GET /api/profile  → current user's health_conditions
- PUT /api/profile  → update current user's health_conditions

Both require a valid Supabase JWT (enforced via `get_current_user`).
We use the service-role Supabase client and trust the JWT for identity;
RLS isn't enforced via service-role, so the SQL queries always filter by
the authenticated user_id.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from app.core.auth import get_current_user
from app.core.supabase import get_admin_client
from app.models.user import ProfileResponse

logger = logging.getLogger(__name__)

router = APIRouter()

# Single source of truth for valid conditions (matches the DB CHECK constraint).
VALID_CONDITIONS: frozenset[str] = frozenset(
    {"diabetes", "cholesterol", "hypertension", "obesity"}
)


class ProfileUpdateRequest(BaseModel):
    health_conditions: list[str]

    @field_validator("health_conditions")
    @classmethod
    def _validate_conditions(cls, v: list[str]) -> list[str]:
        invalid = [c for c in v if c not in VALID_CONDITIONS]
        if invalid:
            raise ValueError(
                f"invalid condition(s): {invalid}. allowed: {sorted(VALID_CONDITIONS)}"
            )
        # Deduplicate while preserving order so the response is stable.
        seen: set[str] = set()
        out: list[str] = []
        for c in v:
            if c not in seen:
                seen.add(c)
                out.append(c)
        return out


def _read_conditions(user_id: str) -> list[str]:
    """Look up the user's health_conditions, or [] if the row is missing.

    The handle_new_user trigger should have inserted a profiles row at
    sign-up. If it's missing for some reason (older user, etc.), we
    treat it as empty so the UI still renders.
    """
    client = get_admin_client()
    res = (
        client.table("profiles")
        .select("health_conditions")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows or not isinstance(rows[0], dict):
        return []
    raw = rows[0].get("health_conditions") or []
    if not isinstance(raw, list):
        return []
    return [str(c) for c in raw if isinstance(c, str)]


@router.get("", response_model=ProfileResponse)
def get_profile(
    user_id: Annotated[str, Depends(get_current_user)],
) -> ProfileResponse:
    """Return the authenticated user's health profile."""
    try:
        conditions = _read_conditions(user_id)
    except Exception as exc:
        logger.exception("profile read failed for user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read profile",
        ) from exc
    return ProfileResponse(health_conditions=conditions)


@router.put("", response_model=ProfileResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    user_id: Annotated[str, Depends(get_current_user)],
) -> ProfileResponse:
    """Replace the authenticated user's health_conditions list."""
    client = get_admin_client()
    try:
        # Upsert keeps the route resilient if the trigger row is missing.
        client.table("profiles").upsert(
            {"id": user_id, "health_conditions": payload.health_conditions},
        ).execute()
    except Exception as exc:
        logger.exception("profile update failed for user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update profile",
        ) from exc
    return ProfileResponse(health_conditions=payload.health_conditions)

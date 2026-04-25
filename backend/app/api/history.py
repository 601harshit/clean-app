"""HTTP endpoints under /api/history.

Two routes:
- GET /api/history     → recent 20 scan_history rows for the user
- DELETE /api/history  → truncate the user's scan_history (204)

Auth required for both. Uses service-role client; queries always filter
by the authenticated user_id (we trust the JWT for identity).
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.core.auth import get_current_user
from app.core.supabase import get_admin_client
from app.models.user import HistoryItem

logger = logging.getLogger(__name__)

router = APIRouter()

HISTORY_LIMIT = 20


def _row_to_item(row: dict[str, Any]) -> HistoryItem:
    return HistoryItem(
        id=str(row["id"]),
        barcode=row.get("barcode"),
        product_name=row["product_name"],
        brand=row.get("brand"),
        image_url=row.get("image_url"),
        score=int(row["score"]),
        scanned_at=row["scanned_at"],
    )


@router.get("", response_model=dict[str, list[HistoryItem]])
def get_history(
    user_id: Annotated[str, Depends(get_current_user)],
) -> dict[str, list[HistoryItem]]:
    """Return the authenticated user's most recent scan_history items.

    Ordered by scanned_at desc, capped at HISTORY_LIMIT (20).
    """
    client = get_admin_client()
    try:
        res = (
            client.table("scan_history")
            .select("id,barcode,product_name,brand,image_url,score,scanned_at")
            .eq("user_id", user_id)
            .order("scanned_at", desc=True)
            .limit(HISTORY_LIMIT)
            .execute()
        )
    except Exception as exc:
        logger.exception("history read failed for user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read history",
        ) from exc
    rows = res.data or []
    items = [_row_to_item(r) for r in rows if isinstance(r, dict)]
    return {"items": items}


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_history(
    user_id: Annotated[str, Depends(get_current_user)],
) -> Response:
    """Delete every scan_history row owned by the authenticated user."""
    client = get_admin_client()
    try:
        client.table("scan_history").delete().eq("user_id", user_id).execute()
    except Exception as exc:
        logger.exception("history clear failed for user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to clear history",
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)

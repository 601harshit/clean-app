"""HTTP endpoints under /api/food.

Three routes:
- GET /api/food/categories      → curated browsing chips
- GET /api/food/search          → text + category search with server-side filters
- GET /api/food/barcode/{code}  → product detail (optional auth = personalized)

The route layer is intentionally thin: it parses query params, calls
food_service + scoring_service, and serializes Pydantic responses.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import get_current_user_optional
from app.core.supabase import get_admin_client
from app.models.food import (
    Category,
    FoodResult,
    Nutrient,
    ProductSummary,
    SearchResponse,
)
from app.services import food_service, llm_service, scoring_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Curated category list — matches docs/features/food-search.md.
_CATEGORIES: list[Category] = [
    Category(slug="snacks", label="Snacks", icon="🍿"),
    Category(slug="dairy", label="Dairy", icon="🥛"),
    Category(slug="beverages", label="Beverages", icon="🧃"),
    Category(slug="cereals", label="Cereals", icon="🥣"),
    Category(slug="condiments", label="Condiments", icon="🧴"),
    Category(slug="frozen", label="Frozen", icon="🧊"),
    Category(slug="breads", label="Breads", icon="🍞"),
    Category(slug="meats", label="Meats", icon="🥩"),
]


def _conditions_for_user(user_id: str | None) -> list[str]:
    """Look up the user's profile.health_conditions list, or [] on miss/error.

    Failures (DB down, missing row) are intentionally swallowed to "no
    conditions" so the detail page degrades gracefully to a generic score
    instead of returning 500.
    """
    if not user_id:
        return []
    try:
        client = get_admin_client()
        res = (
            client.table("profiles")
            .select("health_conditions")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning("profile lookup failed for user %s: %s", user_id, exc)
        return []
    rows = res.data or []
    if not rows or not isinstance(rows[0], dict):
        return []
    raw = rows[0].get("health_conditions") or []
    if not isinstance(raw, list):
        return []
    return [str(c) for c in raw if isinstance(c, str)]


def _record_scan_history(
    user_id: str,
    *,
    barcode: str,
    name: str,
    brand: str | None,
    image_url: str | None,
    score: int,
) -> None:
    """Append a scan_history row for the authed user (best-effort).

    Per FR-7.1: every authenticated detail-page view is recorded. We
    swallow + log any DB errors so a history insert failure never breaks
    the food detail response.
    """
    try:
        client = get_admin_client()
        client.table("scan_history").insert(
            {
                "user_id": user_id,
                "barcode": barcode,
                "product_name": name,
                "brand": brand,
                "image_url": image_url,
                "score": score,
            }
        ).execute()
    except Exception as exc:
        logger.warning("scan_history insert failed for user %s: %s", user_id, exc)


@router.get("/categories")
def get_categories() -> dict[str, list[Category]]:
    """Return the curated category list (8 entries)."""
    return {"categories": _CATEGORIES}


@router.get("/search", response_model=SearchResponse)
async def search(
    q: Annotated[str | None, Query()] = None,
    category: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    min_score: Annotated[int | None, Query(ge=0, le=100)] = None,
    safe_for: Annotated[list[str] | None, Query()] = None,
    nutri_score: Annotated[list[str] | None, Query()] = None,
    nova_group: Annotated[list[int] | None, Query()] = None,
) -> SearchResponse:
    """Search/browse Open Food Facts with scoring + safety filters applied.

    Per docs/features/food-search.md, scoring happens server-side using a
    GENERIC score (no user conditions) so search results are stable across
    users; the personalization is reserved for the detail endpoint.
    """
    if not q and not category:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="must provide at least `q` or `category`",
        )

    products, total = await food_service.search_products(
        q=q,
        category=category,
        page=page,
        nutri_score=nutri_score,
        nova_group=nova_group,
    )

    summaries: list[ProductSummary] = []
    safe_for_set = {s.lower() for s in (safe_for or [])}
    for p in products:
        score, _label, _factors = scoring_service.compute_score(
            p["nutrients"], p.get("nutri_score"), p.get("nova_group"), conditions=None
        )
        if min_score is not None and score < min_score:
            continue
        if safe_for_set and not all(
            scoring_service.is_safe_for(c, p["nutrients"]) for c in safe_for_set
        ):
            continue
        summaries.append(
            ProductSummary(
                barcode=p["barcode"],
                name=p["name"],
                brand=p.get("brand"),
                image_url=p.get("image_url"),
                nutri_score=p.get("nutri_score"),
                nova_group=p.get("nova_group"),
                score=score,
            )
        )

    return SearchResponse(products=summaries, total=total, page=page)


@router.get("/barcode/{barcode}", response_model=FoodResult)
async def get_food_by_barcode(
    barcode: str,
    user_id: Annotated[str | None, Depends(get_current_user_optional)] = None,
) -> FoodResult:
    """Return a full FoodResult for a barcode.

    Auth is optional: if a valid Supabase JWT is presented, we look up the
    user's conditions and personalize the score; otherwise we return a
    generic score with `personalized: false`.

    `alternatives` stays [] (T1.6 fills it). `body_impact` is populated
    via llm_service — cache hit returns the stored summary, miss calls
    Claude (Haiku) and persists the result. Any LLM failure leaves the
    field as None so the page degrades gracefully.
    """
    product = await food_service.get_product(barcode)
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Product not found"
        )

    conditions = _conditions_for_user(user_id)
    score, label, factors = scoring_service.compute_score(
        product["nutrients"],
        product.get("nutri_score"),
        product.get("nova_group"),
        conditions=conditions,
    )

    # Breakdown sorted by absolute impact, largest first (per scoring spec).
    factors_sorted = sorted(factors, key=lambda f: -abs(f.impact))

    nutrients = Nutrient(
        energy_kcal=product["nutrients"]["energy_kcal"],
        fat=product["nutrients"]["fat"],
        saturated_fat=product["nutrients"]["saturated_fat"],
        carbohydrates=product["nutrients"]["carbohydrates"],
        sugars=product["nutrients"]["sugars"],
        fiber=product["nutrients"]["fiber"],
        proteins=product["nutrients"]["proteins"],
        sodium=product["nutrients"]["sodium"],
    )

    if user_id:
        _record_scan_history(
            user_id,
            barcode=product["barcode"],
            name=product["name"],
            brand=product.get("brand"),
            image_url=product.get("image_url"),
            score=score,
        )

    body_impact = await llm_service.get_body_impact(
        product, conditions, get_admin_client()
    )

    # Pick the most specific OFF category tag; pnns_groups_1 is missing in
    # our parsed shape, so we fall back to the last entry of categories_tags
    # which is the most specific (e.g. "en:hazelnut-spreads"). The very
    # specific tag often returns too few candidates, so we prefer the
    # broader root category — categories_tags[0] — per docs/features
    # /alternatives.md ("use pnns_groups_1 or categories_tags[0]").
    cats = product.get("categories_tags") or []
    alt_category = cats[0] if cats else None

    alternatives = await food_service.get_alternatives(
        barcode=product["barcode"],
        category=alt_category,
        current_score=score,
        conditions=conditions,
    )

    return FoodResult(
        barcode=product["barcode"],
        name=product["name"],
        brand=product.get("brand"),
        image_url=product.get("image_url"),
        nutri_score=product.get("nutri_score"),
        nova_group=product.get("nova_group"),
        nutrients=nutrients,
        score=score,
        score_label=label,
        score_breakdown=factors_sorted,
        alternatives=alternatives,
        body_impact=body_impact,
        personalized=bool(conditions),
    )

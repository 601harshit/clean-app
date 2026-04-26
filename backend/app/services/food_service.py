"""Open Food Facts client + caching layer.

Two cache layers:

* `food_cache` table (Postgres) for product lookups by barcode, 7-day TTL.
* `cachetools.TTLCache` (in-memory) for search-result snapshots, 1-hour TTL.

The OFF API is public and unauthenticated. We always pass our own User-Agent
per OFF policy (`https://wiki.openfoodfacts.org/API`).

Parsing notes:
- OFF stores nutrients per 100g under ``product.nutriments.{key}_100g``.
  The keys we care about don't always match our model field names; see
  ``_NUTRIENT_KEY_MAP`` below.
- Some products are missing nutrient values. Missing is treated as 0 by
  the scorer; we preserve this by emitting 0 in the parsed dict.
- Sodium: prefer ``sodium_100g``, fall back to ``salt_100g / 2.5``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from cachetools import TTLCache

from app.core.supabase import get_admin_client
from app.models.food import Alternative

logger = logging.getLogger(__name__)

ALTERNATIVES_MIN_SCORE = 60
ALTERNATIVES_MAX = 5

OFF_BASE = "https://world.openfoodfacts.org"
USER_AGENT = "Clean.App/0.1 (https://github.com/getclean/clean-app)"
DEFAULT_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
PRODUCT_CACHE_TTL = timedelta(days=7)
SEARCH_CACHE_TTL_SECONDS = 60 * 60  # 1 hour
SEARCH_CACHE_MAX = 256
PAGE_SIZE = 20

# In-memory cache shared across requests (process-local).
_search_cache: TTLCache[str, tuple[list[dict[str, Any]], int]] = TTLCache(
    maxsize=SEARCH_CACHE_MAX, ttl=SEARCH_CACHE_TTL_SECONDS
)

# Map model nutrient field → list of OFF keys to try, in priority order.
_NUTRIENT_KEY_MAP: dict[str, tuple[str, ...]] = {
    "energy_kcal": ("energy-kcal_100g", "energy_kcal_100g"),
    "fat": ("fat_100g",),
    "saturated_fat": ("saturated-fat_100g", "saturated_fat_100g"),
    "carbohydrates": ("carbohydrates_100g",),
    "sugars": ("sugars_100g",),
    "fiber": ("fiber_100g",),
    "proteins": ("proteins_100g",),
    "sodium": ("sodium_100g",),  # salt fallback handled explicitly
}


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def _coerce_float(v: Any) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def parse_product(off_payload: dict[str, Any]) -> dict[str, Any] | None:
    """Translate an OFF product payload into our normalized shape.

    Returns None if the payload represents "no product" (status 0 or
    missing product object).
    """
    if not off_payload:
        return None
    if off_payload.get("status") == 0:
        return None
    product = off_payload.get("product") or off_payload
    if not isinstance(product, dict) or not product.get("code"):
        return None

    nutriments = product.get("nutriments") or {}
    nutrients: dict[str, float] = {}
    for field, keys in _NUTRIENT_KEY_MAP.items():
        val = None
        for k in keys:
            if k in nutriments:
                val = nutriments[k]
                break
        nutrients[field] = _coerce_float(val)
    # Sodium fallback: salt_100g is in g; sodium ≈ salt / 2.5
    if nutrients["sodium"] == 0 and nutriments.get("salt_100g") is not None:
        nutrients["sodium"] = round(_coerce_float(nutriments["salt_100g"]) / 2.5, 4)

    nutri = product.get("nutriscore_grade") or product.get("nutrition_grade_fr")
    nutri_upper = nutri.upper() if isinstance(nutri, str) and nutri else None

    nova_raw = product.get("nova_group")
    nova_group: int | None
    try:
        nova_group = int(nova_raw) if nova_raw is not None else None
    except (TypeError, ValueError):
        nova_group = None

    image_url = (
        product.get("image_url")
        or product.get("image_front_url")
        or product.get("image_front_small_url")
    )

    return {
        "barcode": str(product.get("code")),
        "name": product.get("product_name") or product.get("generic_name") or "Unknown",
        "brand": (product.get("brands") or "").split(",")[0].strip() or None,
        "image_url": image_url,
        "nutri_score": nutri_upper,
        "nova_group": nova_group,
        "nutrients": nutrients,
        "categories_tags": product.get("categories_tags") or [],
    }


# ---------------------------------------------------------------------------
# food_cache (Postgres)
# ---------------------------------------------------------------------------


def _cache_get(barcode: str) -> dict[str, Any] | None:
    """Read from the food_cache table; honor 7-day TTL.

    Returns the raw OFF payload if a fresh row exists, else None.
    """
    try:
        client = get_admin_client()
        res = (
            client.table("food_cache")
            .select("data,cached_at")
            .eq("barcode", barcode)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # supabase client raises various errors
        logger.warning("food_cache read failed for %s: %s", barcode, exc)
        return None
    rows = res.data or []
    if not rows:
        return None
    row = rows[0]
    if not isinstance(row, dict):
        return None
    cached_at_raw = row.get("cached_at")
    if isinstance(cached_at_raw, str):
        try:
            cached_at = datetime.fromisoformat(cached_at_raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    elif isinstance(cached_at_raw, datetime):
        cached_at = cached_at_raw
    else:
        return None
    if cached_at.tzinfo is None:
        cached_at = cached_at.replace(tzinfo=UTC)
    if datetime.now(UTC) - cached_at > PRODUCT_CACHE_TTL:
        return None
    data = row.get("data")
    if isinstance(data, dict):
        return data
    return None


def _cache_put(barcode: str, payload: dict[str, Any]) -> None:
    try:
        client = get_admin_client()
        client.table("food_cache").upsert(
            {
                "barcode": barcode,
                "data": payload,
                "cached_at": datetime.now(UTC).isoformat(),
            }
        ).execute()
    except Exception as exc:
        logger.warning("food_cache write failed for %s: %s", barcode, exc)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_product(barcode: str) -> dict[str, Any] | None:
    """Fetch a product by barcode.

    Lookup order:
      1. ``food_cache`` table (TTL 7 days). On hit, parse from cached payload.
      2. Open Food Facts ``/api/v2/product/{barcode}.json``. On hit, persist
         the raw payload into ``food_cache`` for next time.

    Returns the parsed product dict (see ``parse_product``), or ``None`` if
    the product is unknown to OFF.
    """
    cached = _cache_get(barcode)
    if cached is not None:
        parsed = parse_product(cached)
        if parsed is not None:
            return parsed

    url = f"{OFF_BASE}/api/v2/product/{barcode}.json"
    try:
        async with httpx.AsyncClient(
            timeout=DEFAULT_TIMEOUT, headers={"User-Agent": USER_AGENT}
        ) as client:
            resp = await client.get(url)
    except httpx.HTTPError as exc:
        logger.warning("OFF product fetch failed for %s: %s", barcode, exc)
        return None

    if resp.status_code != 200:
        return None
    try:
        payload = resp.json()
    except ValueError:
        return None
    parsed = parse_product(payload)
    if parsed is None:
        return None
    # Only persist real hits, not "no code" fallbacks.
    _cache_put(barcode, payload)
    return parsed


def _search_cache_key(
    q: str | None,
    category: str | None,
    page: int,
    nutri_score: tuple[str, ...] | None,
    nova_group: tuple[int, ...] | None,
) -> str:
    parts = [
        f"q={(q or '').lower()}",
        f"c={(category or '').lower()}",
        f"p={page}",
        f"ns={','.join(sorted(s.upper() for s in (nutri_score or ())))}",
        f"nv={','.join(str(n) for n in sorted(nova_group or ()))}",
    ]
    return "|".join(parts)


async def search_products(
    q: str | None = None,
    category: str | None = None,
    page: int = 1,
    nutri_score: list[str] | None = None,
    nova_group: list[int] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Search Open Food Facts.

    Returns ``(products, total)`` where ``products`` is a list of parsed
    product dicts. ``total`` is the unfiltered OFF count for the query.

    Caches each (q, category, page, nutri_score, nova_group) tuple in an
    in-memory TTLCache for 1 hour.
    """
    if not q and not category:
        return [], 0

    page = max(1, int(page))
    ns_tuple = tuple(nutri_score) if nutri_score else None
    nv_tuple = tuple(nova_group) if nova_group else None
    key = _search_cache_key(q, category, page, ns_tuple, nv_tuple)
    cached: tuple[list[dict[str, Any]], int] | None = _search_cache.get(key)
    if cached is not None:
        return cached

    params: dict[str, Any] = {
        "page": page,
        "page_size": PAGE_SIZE,
        "json": 1,
    }
    if q:
        params["search_terms"] = q
    if category:
        params["tagtype_0"] = "categories"
        params["tag_contains_0"] = "contains"
        params["tag_0"] = category
    if nutri_score:
        params["tagtype_1"] = "nutrition_grades"
        params["tag_contains_1"] = "contains"
        # OFF accepts comma-separated lower-case grades
        params["tag_1"] = ",".join(s.lower() for s in nutri_score)
    if nova_group:
        params["tagtype_2"] = "nova_groups"
        params["tag_contains_2"] = "contains"
        params["tag_2"] = ",".join(str(n) for n in nova_group)

    url = f"{OFF_BASE}/cgi/search.pl"
    try:
        async with httpx.AsyncClient(
            timeout=DEFAULT_TIMEOUT, headers={"User-Agent": USER_AGENT}
        ) as client:
            resp = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        logger.warning("OFF search failed for %r: %s", q or category, exc)
        return [], 0

    if resp.status_code != 200:
        return [], 0
    try:
        payload = resp.json()
    except ValueError:
        return [], 0

    raw_products = payload.get("products") or []
    parsed: list[dict[str, Any]] = []
    for raw in raw_products:
        p = parse_product(raw)
        if p is not None:
            parsed.append(p)
    total = int(payload.get("count") or len(parsed))
    result = (parsed, total)
    _search_cache[key] = result
    return result


async def get_alternatives(
    barcode: str,
    category: str | None,
    current_score: int,
    conditions: list[str] | None,
) -> list[Alternative]:
    """Return up to 5 healthier in-category alternatives.

    Algorithm (per docs/features/alternatives.md FR-6.4):
      1. Bail out early when ``category`` is missing — we have no axis to
         search along, so there is nothing to recommend.
      2. Search Open Food Facts for products in the same ``category`` slug.
      3. Score each candidate with the user's ``conditions`` so the gate
         is personalized.
      4. Keep candidates whose ``score`` is ``>= 60`` AND strictly greater
         than ``current_score``, excluding the current ``barcode`` itself
         and dropping name-less or barcode-less rows.
      5. Sort by score descending; cap at ``ALTERNATIVES_MAX`` (5).
      6. For each survivor, ask amazon_service for an affiliate link. The
         amazon_service is best-effort: a ``None`` URL still yields a
         valid Alternative — the frontend renders the card without an
         "Order on Amazon" button.

    Failure modes:
      * OFF search returns nothing → empty list.
      * OFF API down → ``search_products`` swallows the error and returns
        ``([], 0)``, which we propagate as an empty list.
      * Amazon API failure / missing creds → per-product URL is ``None``,
        the alternative is still returned.

    Args:
        barcode: the current product's barcode (excluded from results).
        category: OFF category tag (e.g. ``"en:spreads"``) to search.
        current_score: the score of the product the user is viewing.
        conditions: the user's health conditions (used to personalize the
            candidate scoring so an alternative is "healthier *for them*").

    Returns:
        A list of ``Alternative`` (length 0..5).
    """
    # Lazy import to avoid a circular reference: scoring_service is pure,
    # but importing it at module load order trips through the larger
    # services package init.
    from app.services import amazon_service, scoring_service

    if not category:
        return []

    products, _total = await search_products(category=category)
    if not products:
        return []

    scored: list[tuple[int, dict[str, Any]]] = []
    for p in products:
        if not p.get("barcode") or not p.get("name"):
            continue
        if p["barcode"] == barcode:
            continue
        score, _label, _factors = scoring_service.compute_score(
            p["nutrients"],
            p.get("nutri_score"),
            p.get("nova_group"),
            conditions=conditions,
        )
        if score < ALTERNATIVES_MIN_SCORE:
            continue
        if score <= current_score:
            continue
        scored.append((score, p))

    # Stable sort by score desc; ties preserve OFF order (a reasonable
    # popularity proxy since OFF returns most-complete entries first).
    scored.sort(key=lambda t: -t[0])
    top = scored[:ALTERNATIVES_MAX]

    alternatives: list[Alternative] = []
    for score, p in top:
        query_parts = [p["name"]]
        if p.get("brand"):
            query_parts.append(str(p["brand"]))
        amazon_url = await amazon_service.get_affiliate_link(" ".join(query_parts))
        alternatives.append(
            Alternative(
                barcode=str(p["barcode"]),
                name=str(p["name"]),
                brand=p.get("brand"),
                score=score,
                image_url=p.get("image_url"),
                amazon_url=amazon_url,
            )
        )
    return alternatives


def clear_search_cache() -> None:
    """Test-only helper to drop the in-memory search cache."""
    _search_cache.clear()

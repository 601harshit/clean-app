"""Claude-generated body-impact summary, cached in Supabase.

Public surface:

* ``conditions_key(conditions)`` — normalize a conditions list into the
  cache key used in ``food_insights``: sorted, comma-joined, lowercased.
  Empty list (or all-invalid) becomes ``""`` (the guest key).
* ``get_body_impact(product, conditions, supabase)`` — return a 2-3
  sentence summary for the product. Cache-first against
  ``food_insights(barcode, conditions_key)``; on miss, calls Claude
  (Haiku 4.5) with a prompt-cached system prompt and writes the row.

Failure mode: any error (Claude API down, malformed response, DB write
failure) returns ``None`` silently — the detail page degrades gracefully
to "no summary" instead of returning 500.
"""

from __future__ import annotations

import logging
from typing import Any

from anthropic import AsyncAnthropic
from supabase import Client

from app.core.config import get_settings
from app.services.scoring_service import VALID_CONDITIONS

logger = logging.getLogger(__name__)

# Haiku 4.5 — cheap + fast, plenty smart for a 2-3 sentence summary.
# Pinned to the dated snapshot per the synthetic cassette and task brief.
CLAUDE_MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 256

# Stable system prompt — kept as a single string so the prompt cache stays
# valid across every (barcode, conditions) request. Anything dynamic
# (product name, nutrients, conditions) goes in the user message.
SYSTEM_PROMPT = (
    "You are a nutrition explainer for a food-scoring app called Clean. "
    "Given a single packaged food product and an optional list of the "
    "user's health conditions, you write a concise 2-3 sentence summary "
    "of what eating this food would do to the user's body.\n\n"
    "Style rules:\n"
    "- Plain English, no jargon, no markdown, no bullet points.\n"
    "- 2 to 3 complete sentences. No more.\n"
    "- If conditions are listed, ground at least one sentence in how the "
    "product specifically interacts with those conditions (e.g. blood "
    "sugar, cholesterol, sodium, calories).\n"
    "- If no conditions are listed, give a generic nutritional summary.\n"
    "- Be honest. If the food is nutritionally poor, say so. If it has "
    "real upsides, say so.\n"
    "- Do not refuse, hedge, or add disclaimers about consulting a doctor."
)


def conditions_key(conditions: list[str] | None) -> str:
    """Normalize a conditions list into the cache key.

    * lower-cased
    * filtered to the four valid conditions (anything else is dropped)
    * de-duplicated
    * sorted
    * comma-joined

    Returns ``""`` for guest / no-conditions / all-invalid inputs.
    """
    if not conditions:
        return ""
    normalized = sorted(
        {c.lower() for c in conditions if isinstance(c, str)} & VALID_CONDITIONS
    )
    return ",".join(normalized)


def _build_user_prompt(product: dict[str, Any], conditions: list[str]) -> str:
    """Render the per-request user message.

    Kept short and structured: the system prompt does the heavy lifting
    and stays cacheable; the user prompt is the only thing that changes
    per request.
    """
    name = product.get("name") or "Unknown product"
    brand = product.get("brand")
    nutri = product.get("nutri_score") or "unknown"
    nova = product.get("nova_group")
    nova_str = str(nova) if nova is not None else "unknown"
    nutrients = product.get("nutrients") or {}

    def _n(key: str) -> str:
        v = nutrients.get(key)
        if v is None:
            return "?"
        # Avoid trailing zeros for clean output.
        return f"{float(v):g}"

    header = f"Product: {name}"
    if brand:
        header += f" ({brand})"

    cond_str = (
        ", ".join(conditions) if conditions else "none (no specific conditions)"
    )

    return (
        f"{header}\n"
        f"Nutri-Score: {nutri}\n"
        f"NOVA group: {nova_str}\n"
        f"Per 100g: energy {_n('energy_kcal')} kcal, "
        f"fat {_n('fat')}g, saturated fat {_n('saturated_fat')}g, "
        f"carbs {_n('carbohydrates')}g, sugars {_n('sugars')}g, "
        f"fiber {_n('fiber')}g, protein {_n('proteins')}g, "
        f"sodium {_n('sodium')}g\n"
        f"User health conditions: {cond_str}\n\n"
        "Write the 2-3 sentence body-impact summary now."
    )


def _cache_get(supabase: Client, barcode: str, key: str) -> str | None:
    """Look up a cached summary. Returns ``None`` on miss or DB error."""
    try:
        res = (
            supabase.table("food_insights")
            .select("message")
            .eq("barcode", barcode)
            .eq("conditions_key", key)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning(
            "food_insights read failed for %s/%r: %s", barcode, key, exc
        )
        return None
    rows = res.data or []
    if not rows or not isinstance(rows[0], dict):
        return None
    msg = rows[0].get("message")
    if isinstance(msg, str) and msg.strip():
        return msg
    return None


def _cache_put(supabase: Client, barcode: str, key: str, message: str) -> None:
    """Persist a summary. Failures are logged and swallowed."""
    try:
        supabase.table("food_insights").upsert(
            {"barcode": barcode, "conditions_key": key, "message": message}
        ).execute()
    except Exception as exc:
        logger.warning(
            "food_insights write failed for %s/%r: %s", barcode, key, exc
        )


def _extract_text(response: Any) -> str | None:
    """Pull the text from a Messages API response, or None if malformed."""
    content = getattr(response, "content", None)
    if not content:
        return None
    parts: list[str] = []
    for block in content:
        # Support both SDK objects (block.type / block.text) and dict-shaped
        # cassette payloads (block["type"] / block["text"]).
        btype = getattr(block, "type", None)
        if btype is None and isinstance(block, dict):
            btype = block.get("type")
        if btype != "text":
            continue
        text = getattr(block, "text", None)
        if text is None and isinstance(block, dict):
            text = block.get("text")
        if isinstance(text, str):
            parts.append(text)
    if not parts:
        return None
    joined = "".join(parts).strip()
    return joined or None


async def _call_claude(user_prompt: str) -> str | None:
    """One-shot Anthropic call. Returns the text or None on any failure."""
    try:
        settings = get_settings()
        client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        # System prompt is structured as a list with `cache_control` so the
        # SDK sends `cache_control: {"type": "ephemeral"}` and we pay the
        # cache-read price on every subsequent request with the same prefix.
        response = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=MAX_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception as exc:
        logger.warning("Anthropic call failed: %s", exc)
        return None
    return _extract_text(response)


async def get_body_impact(
    product: dict[str, Any],
    conditions: list[str] | None,
    supabase: Client,
) -> str | None:
    """Return a cached or freshly-generated body-impact summary.

    Args:
        product: parsed product dict (from food_service.get_product). Must
            contain at least ``barcode``; ``name``, ``brand``, ``nutrients``,
            ``nutri_score``, ``nova_group`` are used when present.
        conditions: user health conditions. Order doesn't matter; invalid
            values are ignored. ``None`` or ``[]`` means guest.
        supabase: admin Supabase client used for cache reads/writes.

    Returns:
        A 2-3 sentence string, or ``None`` if the product has no barcode
        or every step (cache, Claude, parse) fails.
    """
    barcode = product.get("barcode")
    if not isinstance(barcode, str) or not barcode:
        return None

    # Normalize conditions for the cache key AND for the prompt — same
    # canonical list goes into both, so the prompt the model sees matches
    # the key we cache under.
    key = conditions_key(conditions)
    normalized: list[str] = key.split(",") if key else []

    cached = _cache_get(supabase, barcode, key)
    if cached is not None:
        return cached

    user_prompt = _build_user_prompt(product, normalized)
    summary = await _call_claude(user_prompt)
    if summary is None:
        return None

    _cache_put(supabase, barcode, key, summary)
    return summary

"""Pure scoring functions for the Clean. food health score.

The algorithm is documented in `docs/lld.md` § Scoring Algorithm.

This module is pure: no I/O, no globals other than the threshold tables.
That makes it cheap to table-test.
"""

from __future__ import annotations

from collections.abc import Mapping

from app.models.food import ScoreFactor

# ---------------------------------------------------------------------------
# Tables (kept module-level so tests can import them and so the source of
# truth lives next to the code that uses it).
# ---------------------------------------------------------------------------

NUTRI_BASE: dict[str, int] = {
    "A": 80,
    "B": 65,
    "C": 50,
    "D": 35,
    "E": 20,
}
NUTRI_BASE_DEFAULT = 50  # Unknown / missing → neutral

NOVA_PENALTY: dict[int, int] = {
    1: 0,
    2: -5,
    3: -10,
    4: -20,
}

VALID_CONDITIONS: frozenset[str] = frozenset(
    {"diabetes", "cholesterol", "hypertension", "obesity"}
)

# Score-band labels keyed by lower bound (inclusive). Tested explicitly
# at every boundary.
SCORE_BANDS: tuple[tuple[int, str], ...] = (
    (80, "Excellent"),
    (60, "Good"),
    (40, "Fair"),
    (20, "Poor"),
    (0, "Avoid"),
)

# Safety thresholds — see docs/lld.md § Condition Safety Thresholds and
# docs/features/food-search.md § Condition Safety Definition.
#
# A product is "safe for X" if it does NOT exceed any of these limits.
SAFETY_THRESHOLDS: dict[str, dict[str, float]] = {
    "diabetes": {"sugars": 15.0, "carbohydrates": 40.0},
    "cholesterol": {"saturated_fat": 5.0, "fat": 20.0},
    "hypertension": {"sodium": 0.3},
    "obesity": {"energy_kcal": 400.0},
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get(nutrients: Mapping[str, float], key: str) -> float:
    """Return the nutrient value or 0 if missing/None.

    Missing/None nutrient values must NOT raise — many OFF products have
    incomplete nutrient panels. We treat absence as zero, which is the
    most conservative choice (no penalty / no bonus).
    """
    v = nutrients.get(key)
    if v is None:
        return 0.0
    return float(v)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def score_label(score: int) -> str:
    """Bucket a 0-100 score into one of: Excellent, Good, Fair, Poor, Avoid."""
    for lower, label in SCORE_BANDS:
        if score >= lower:
            return label
    # Negative scores shouldn't happen post-clamp, but if they do, treat
    # as Avoid rather than crashing.
    return "Avoid"


def is_safe_for(condition: str, nutrients: Mapping[str, float]) -> bool:
    """Return True iff the product satisfies all thresholds for the condition.

    Unknown conditions return True (they impose no constraint), so callers
    that pass through user input don't accidentally hide all products.
    """
    thresholds = SAFETY_THRESHOLDS.get(condition)
    if thresholds is None:
        return True
    for key, limit in thresholds.items():
        if _get(nutrients, key) > limit:
            return False
    return True


def _nutri_base(nutri_score: str | None) -> tuple[int, ScoreFactor]:
    if not nutri_score:
        return (
            NUTRI_BASE_DEFAULT,
            ScoreFactor(
                factor="Nutri-Score unknown",
                impact=NUTRI_BASE_DEFAULT,
                reason="No Nutri-Score on file — neutral baseline applied",
            ),
        )
    grade = nutri_score.upper()
    base = NUTRI_BASE.get(grade, NUTRI_BASE_DEFAULT)
    if grade not in NUTRI_BASE:
        return (
            NUTRI_BASE_DEFAULT,
            ScoreFactor(
                factor="Nutri-Score unknown",
                impact=NUTRI_BASE_DEFAULT,
                reason=f"Unrecognized Nutri-Score '{nutri_score}' — neutral baseline applied",
            ),
        )
    return (
        base,
        ScoreFactor(
            factor=f"Nutri-Score {grade}",
            impact=base,
            reason="Base score from Open Food Facts Nutri-Score",
        ),
    )


def _nova_penalty(nova_group: int | None) -> tuple[int, ScoreFactor | None]:
    if nova_group is None:
        return (0, None)
    penalty = NOVA_PENALTY.get(nova_group)
    if penalty is None:
        return (0, None)
    if penalty == 0:
        # NOVA 1 contributes 0 — record it as a factor so the breakdown
        # still tells the story, but with zero impact.
        return (
            0,
            ScoreFactor(
                factor="NOVA 1 (unprocessed)",
                impact=0,
                reason="Whole/unprocessed food — no processing penalty",
            ),
        )
    labels = {
        2: "NOVA 2 (processed ingredients)",
        3: "NOVA 3 (processed)",
        4: "NOVA 4 (ultra-processed)",
    }
    reasons = {
        2: "Processed culinary ingredients",
        3: "Processed food",
        4: "Ultra-processed food — significant penalty",
    }
    return (
        penalty,
        ScoreFactor(
            factor=labels[nova_group],
            impact=penalty,
            reason=reasons[nova_group],
        ),
    )


def _diabetes_factors(nutrients: Mapping[str, float]) -> list[ScoreFactor]:
    factors: list[ScoreFactor] = []
    sugars = _get(nutrients, "sugars")
    carbs = _get(nutrients, "carbohydrates")
    if sugars > 15:
        factors.append(
            ScoreFactor(
                factor="High sugar",
                impact=-15,
                reason=f"Sugar {sugars:g}g/100g exceeds 15g — penalized for diabetes",
            )
        )
    if carbs > 40:
        factors.append(
            ScoreFactor(
                factor="High carbohydrates",
                impact=-5,
                reason=f"Carbs {carbs:g}g/100g exceeds 40g — penalized for diabetes",
            )
        )
    return factors


def _cholesterol_factors(nutrients: Mapping[str, float]) -> list[ScoreFactor]:
    factors: list[ScoreFactor] = []
    sat = _get(nutrients, "saturated_fat")
    fat = _get(nutrients, "fat")
    if sat > 5:
        factors.append(
            ScoreFactor(
                factor="High saturated fat",
                impact=-15,
                reason=f"Saturated fat {sat:g}g/100g exceeds 5g — penalized for cholesterol",
            )
        )
    if fat > 20:
        factors.append(
            ScoreFactor(
                factor="High total fat",
                impact=-5,
                reason=f"Total fat {fat:g}g/100g exceeds 20g — penalized for cholesterol",
            )
        )
    return factors


def _hypertension_factors(nutrients: Mapping[str, float]) -> list[ScoreFactor]:
    sodium = _get(nutrients, "sodium")
    if sodium > 0.6:
        return [
            ScoreFactor(
                factor="Very high sodium",
                impact=-20,
                reason=f"Sodium {sodium:g}g/100g exceeds 0.6g — penalized for hypertension",
            )
        ]
    if sodium > 0.3:
        return [
            ScoreFactor(
                factor="High sodium",
                impact=-10,
                reason=f"Sodium {sodium:g}g/100g exceeds 0.3g — penalized for hypertension",
            )
        ]
    return []


def _obesity_factors(nutrients: Mapping[str, float]) -> list[ScoreFactor]:
    factors: list[ScoreFactor] = []
    energy = _get(nutrients, "energy_kcal")
    fiber = _get(nutrients, "fiber")
    proteins = _get(nutrients, "proteins")
    if energy > 400:
        factors.append(
            ScoreFactor(
                factor="High calories",
                impact=-10,
                reason=f"{energy:g} kcal/100g exceeds 400 — penalized for obesity",
            )
        )
    if fiber > 3:
        factors.append(
            ScoreFactor(
                factor="High fiber",
                impact=5,
                reason=f"Fiber {fiber:g}g/100g — satiety bonus for obesity",
            )
        )
    if proteins > 10:
        factors.append(
            ScoreFactor(
                factor="High protein",
                impact=5,
                reason=f"Protein {proteins:g}g/100g — satiety bonus for obesity",
            )
        )
    return factors


_CONDITION_FUNCS = {
    "diabetes": _diabetes_factors,
    "cholesterol": _cholesterol_factors,
    "hypertension": _hypertension_factors,
    "obesity": _obesity_factors,
}


def compute_score(
    nutrients: Mapping[str, float],
    nutri_score: str | None,
    nova_group: int | None,
    conditions: list[str] | None = None,
) -> tuple[int, str, list[ScoreFactor]]:
    """Compute the personalized 0-100 health score.

    Args:
        nutrients: per-100g nutrient values (keys per `Nutrient` model fields).
            Missing keys are treated as 0 so partial OFF data still scores.
        nutri_score: OFF Nutri-Score grade (A-E, case-insensitive) or None.
        nova_group: OFF NOVA group (1-4) or None.
        conditions: list of user health conditions. Only valid conditions
            (`diabetes`, `cholesterol`, `hypertension`, `obesity`) contribute
            modifiers; unknown values are ignored. None or empty list yields
            a generic score.

    Returns:
        `(score, label, breakdown)` — score is clamped to [0, 100].
    """
    factors: list[ScoreFactor] = []

    base, base_factor = _nutri_base(nutri_score)
    factors.append(base_factor)

    nova_pen, nova_factor = _nova_penalty(nova_group)
    if nova_factor is not None:
        factors.append(nova_factor)

    cond_total = 0
    if conditions:
        # Iterate in a stable order so the breakdown is deterministic
        # regardless of how the caller ordered conditions.
        for cond in sorted(set(conditions)):
            fn = _CONDITION_FUNCS.get(cond)
            if fn is None:
                continue
            cond_factors = fn(nutrients)
            factors.extend(cond_factors)
            cond_total += sum(f.impact for f in cond_factors)

    raw = base + nova_pen + cond_total
    clamped = max(0, min(100, raw))
    return clamped, score_label(clamped), factors

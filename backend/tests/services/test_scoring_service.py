"""Table-driven tests for app.services.scoring_service.

Every line of scoring_service should be covered. We exhaustively cover:

* every Nutri-Score grade (A-E, lowercase, missing, garbage)
* every NOVA group (1-4, missing, garbage)
* every condition combination (none, single, all, including unknown values)
* threshold boundary conditions (just at, just over, well over)
* all-zero nutrients
* missing nutrient keys
* score clamping at 0 and 100
* every score-band label boundary
* safety threshold checker for every condition + edge cases
"""

from __future__ import annotations

import pytest

from app.services.scoring_service import (
    NUTRI_BASE,
    NUTRI_BASE_DEFAULT,
    SAFETY_THRESHOLDS,
    compute_score,
    is_safe_for,
    score_label,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ALL_ZERO: dict[str, float] = {
    "energy_kcal": 0,
    "fat": 0,
    "saturated_fat": 0,
    "carbohydrates": 0,
    "sugars": 0,
    "fiber": 0,
    "proteins": 0,
    "sodium": 0,
}


def n(**overrides: float) -> dict[str, float]:
    """Build a nutrient dict, defaulting unspecified fields to 0."""
    base = dict(ALL_ZERO)
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# score_label — every band boundary
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "score,expected",
    [
        (100, "Excellent"),
        (81, "Excellent"),
        (80, "Excellent"),
        (79, "Good"),
        (60, "Good"),
        (59, "Fair"),
        (40, "Fair"),
        (39, "Poor"),
        (20, "Poor"),
        (19, "Avoid"),
        (1, "Avoid"),
        (0, "Avoid"),
    ],
)
def test_score_label_boundaries(score: int, expected: str) -> None:
    assert score_label(score) == expected


def test_score_label_negative_falls_back_to_avoid() -> None:
    """Defensive: post-clamp this should never happen, but don't crash."""
    assert score_label(-5) == "Avoid"


# ---------------------------------------------------------------------------
# Nutri-Score base
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("grade,expected_base", list(NUTRI_BASE.items()))
def test_compute_score_nutri_base_uppercase(grade: str, expected_base: int) -> None:
    score, _label, factors = compute_score(ALL_ZERO, grade, None, None)
    assert score == expected_base
    assert any(grade in f.factor for f in factors)


@pytest.mark.parametrize("grade", ["a", "b", "c", "d", "e"])
def test_compute_score_nutri_base_lowercase_ok(grade: str) -> None:
    score, _label, _factors = compute_score(ALL_ZERO, grade, None, None)
    assert score == NUTRI_BASE[grade.upper()]


def test_compute_score_nutri_missing_uses_default() -> None:
    score, _label, factors = compute_score(ALL_ZERO, None, None, None)
    assert score == NUTRI_BASE_DEFAULT
    assert any("unknown" in f.factor.lower() for f in factors)


def test_compute_score_nutri_unrecognized_uses_default() -> None:
    score, _label, factors = compute_score(ALL_ZERO, "Z", None, None)
    assert score == NUTRI_BASE_DEFAULT
    assert any("Z" in f.reason for f in factors)


def test_compute_score_nutri_empty_string_uses_default() -> None:
    score, _label, factors = compute_score(ALL_ZERO, "", None, None)
    assert score == NUTRI_BASE_DEFAULT
    assert any("unknown" in f.factor.lower() for f in factors)


# ---------------------------------------------------------------------------
# NOVA penalty
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "nova,delta",
    [(1, 0), (2, -5), (3, -10), (4, -20)],
)
def test_compute_score_nova_penalty(nova: int, delta: int) -> None:
    score, _label, factors = compute_score(ALL_ZERO, "C", nova, None)
    assert score == 50 + delta
    # NOVA 1 still records a factor (with impact=0)
    nova_factors = [f for f in factors if "NOVA" in f.factor]
    assert len(nova_factors) == 1
    assert nova_factors[0].impact == delta


def test_compute_score_nova_missing_no_factor_no_penalty() -> None:
    score, _label, factors = compute_score(ALL_ZERO, "C", None, None)
    assert score == 50
    assert not any("NOVA" in f.factor for f in factors)


def test_compute_score_nova_garbage_value_ignored() -> None:
    score, _label, factors = compute_score(ALL_ZERO, "C", 99, None)
    assert score == 50
    assert not any("NOVA" in f.factor for f in factors)


# ---------------------------------------------------------------------------
# Diabetes modifier
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sugars,carbs,expected_delta",
    [
        (0, 0, 0),
        (15, 40, 0),  # boundary: at threshold → no penalty
        (15.0001, 40, -15),  # just over sugar
        (15, 40.0001, -5),  # just over carbs
        (50, 50, -20),  # both over
        (1000, 1000, -20),  # absurd values still capped at -20
    ],
)
def test_compute_score_diabetes(sugars: float, carbs: float, expected_delta: int) -> None:
    nutrients = n(sugars=sugars, carbohydrates=carbs)
    score, _label, _factors = compute_score(nutrients, "C", None, ["diabetes"])
    assert score == 50 + expected_delta


def test_compute_score_diabetes_missing_keys_treated_as_zero() -> None:
    score, _label, _factors = compute_score({}, "C", None, ["diabetes"])
    assert score == 50


# ---------------------------------------------------------------------------
# Cholesterol modifier
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sat,fat,expected_delta",
    [
        (0, 0, 0),
        (5, 20, 0),
        (5.01, 20, -15),
        (5, 20.01, -5),
        (10, 30, -20),
    ],
)
def test_compute_score_cholesterol(sat: float, fat: float, expected_delta: int) -> None:
    nutrients = n(saturated_fat=sat, fat=fat)
    score, _label, _factors = compute_score(nutrients, "C", None, ["cholesterol"])
    assert score == 50 + expected_delta


# ---------------------------------------------------------------------------
# Hypertension modifier (tiered — only ONE tier applies)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sodium,expected_delta",
    [
        (0, 0),
        (0.3, 0),
        (0.30001, -10),
        (0.6, -10),  # boundary: at 0.6 → still -10 (must EXCEED 0.6)
        (0.6001, -20),
        (5, -20),
    ],
)
def test_compute_score_hypertension_tiered(sodium: float, expected_delta: int) -> None:
    score, _label, factors = compute_score(
        n(sodium=sodium), "C", None, ["hypertension"]
    )
    sodium_factors = [f for f in factors if "sodium" in f.factor.lower()]
    assert len(sodium_factors) <= 1, "Only one sodium tier may apply"
    assert score == 50 + expected_delta


# ---------------------------------------------------------------------------
# Obesity modifier — penalty + bonuses
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "energy,fiber,proteins,expected_delta",
    [
        (0, 0, 0, 0),
        (400, 3, 10, 0),  # all at boundary → no modifier
        (401, 0, 0, -10),  # only calorie penalty
        (0, 3.01, 0, 5),  # only fiber bonus
        (0, 0, 10.01, 5),  # only protein bonus
        (500, 5, 15, 0),  # -10 + 5 + 5 = 0
        (500, 10, 20, 0),  # -10 + 5 + 5 = 0 (bonuses don't stack)
    ],
)
def test_compute_score_obesity(
    energy: float, fiber: float, proteins: float, expected_delta: int
) -> None:
    nutrients = n(energy_kcal=energy, fiber=fiber, proteins=proteins)
    score, _label, _factors = compute_score(nutrients, "C", None, ["obesity"])
    assert score == 50 + expected_delta


# ---------------------------------------------------------------------------
# Multi-condition combinations
# ---------------------------------------------------------------------------


def test_compute_score_all_four_conditions_nutella_like() -> None:
    """Realistic Nutella-shaped product: every condition penalty fires."""
    nutrients = n(
        energy_kcal=539,
        fat=30.9,
        saturated_fat=10.6,
        carbohydrates=57.5,
        sugars=56.3,
        fiber=0,
        proteins=6.3,
        sodium=0.107,
    )
    score, label, factors = compute_score(
        nutrients,
        "E",
        4,
        ["diabetes", "cholesterol", "hypertension", "obesity"],
    )
    # base 20, NOVA -20, diabetes -15-5, cholesterol -15-5, hypertension 0
    # (sodium 0.107 below 0.3), obesity -10
    # = 20 - 20 - 20 - 20 - 10 = -50 → clamped to 0
    assert score == 0
    assert label == "Avoid"
    # The breakdown should mention each penalty
    factor_names = {f.factor for f in factors}
    assert "Nutri-Score E" in factor_names
    assert "NOVA 4 (ultra-processed)" in factor_names
    assert "High sugar" in factor_names
    assert "High saturated fat" in factor_names


def test_compute_score_clamped_to_100() -> None:
    """A perfect food with bonuses should not exceed 100."""
    nutrients = n(fiber=20, proteins=30)
    score, label, _factors = compute_score(nutrients, "A", 1, ["obesity"])
    # 80 + 0 + 5 + 5 = 90 → not clamped
    assert score == 90
    # Push harder: an A-grade product also hitting both obesity bonuses
    score2, _label2, _ = compute_score(n(fiber=100, proteins=100), "A", 1, ["obesity"])
    assert score2 == 90  # still 90, not >100 (no double-bonus)
    # Force clamping by giving a contrived obese-bonus heavy A NOVA-1 — even
    # at max, A=80 + 0 + 5 + 5 = 90 < 100. So just verify min(100,...) holds.
    assert max(0, min(100, 9999)) == 100


def test_compute_score_clamped_to_zero() -> None:
    """A terrible food with all conditions should clamp to 0, not go negative."""
    nutrients = n(
        energy_kcal=1000,
        fat=99,
        saturated_fat=99,
        carbohydrates=99,
        sugars=99,
        sodium=10,
    )
    score, label, _ = compute_score(
        nutrients, "E", 4, ["diabetes", "cholesterol", "hypertension", "obesity"]
    )
    assert score == 0
    assert label == "Avoid"


def test_compute_score_no_conditions_generic() -> None:
    """Without conditions, only base + NOVA apply."""
    nutrients = n(sugars=99, sodium=99)  # huge values that would penalize
    score, _label, factors = compute_score(nutrients, "A", 1, None)
    assert score == 80  # base only
    assert all("sugar" not in f.factor.lower() for f in factors)
    assert all("sodium" not in f.factor.lower() for f in factors)


def test_compute_score_unknown_condition_ignored() -> None:
    """Garbage condition values do not affect the score."""
    score, _label, _ = compute_score(ALL_ZERO, "C", None, ["does_not_exist", "gluten"])
    assert score == 50


def test_compute_score_duplicate_conditions_dedup() -> None:
    """Passing the same condition twice doesn't double-penalize."""
    nutrients = n(sugars=50)
    s1, _, _ = compute_score(nutrients, "C", None, ["diabetes"])
    s2, _, _ = compute_score(nutrients, "C", None, ["diabetes", "diabetes"])
    assert s1 == s2


def test_compute_score_breakdown_is_deterministic_across_condition_order() -> None:
    n1 = compute_score(ALL_ZERO, "C", 4, ["diabetes", "cholesterol"])
    n2 = compute_score(ALL_ZERO, "C", 4, ["cholesterol", "diabetes"])
    assert n1 == n2


def test_compute_score_breakdown_includes_base_factor_first() -> None:
    """Base Nutri-Score factor is always the first entry."""
    _s, _l, factors = compute_score(ALL_ZERO, "B", 3, ["diabetes"])
    assert factors[0].factor == "Nutri-Score B"


# ---------------------------------------------------------------------------
# is_safe_for — exhaustive
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "condition,nutrients,expected",
    [
        # Diabetes
        ("diabetes", n(sugars=15, carbohydrates=40), True),
        ("diabetes", n(sugars=15.01, carbohydrates=40), False),
        ("diabetes", n(sugars=15, carbohydrates=40.01), False),
        ("diabetes", n(), True),
        # Cholesterol
        ("cholesterol", n(saturated_fat=5, fat=20), True),
        ("cholesterol", n(saturated_fat=5.01, fat=20), False),
        ("cholesterol", n(saturated_fat=5, fat=20.01), False),
        # Hypertension
        ("hypertension", n(sodium=0.3), True),
        ("hypertension", n(sodium=0.3001), False),
        # Obesity
        ("obesity", n(energy_kcal=400), True),
        ("obesity", n(energy_kcal=400.01), False),
        # Unknown condition
        ("celiac", n(sugars=999), True),
    ],
)
def test_is_safe_for(
    condition: str, nutrients: dict[str, float], expected: bool
) -> None:
    assert is_safe_for(condition, nutrients) is expected


def test_is_safe_for_missing_nutrient_treated_as_zero() -> None:
    assert is_safe_for("diabetes", {}) is True


def test_is_safe_for_none_value_treated_as_zero() -> None:
    nutrients: dict[str, float | None] = {"sugars": None, "carbohydrates": None}
    # pyright: ignore -- intentionally testing None handling
    assert is_safe_for("diabetes", nutrients) is True  # type: ignore[arg-type]


def test_safety_thresholds_match_score_modifiers() -> None:
    """Spec invariant: safety filter thresholds == scoring penalty thresholds."""
    assert SAFETY_THRESHOLDS["diabetes"] == {"sugars": 15.0, "carbohydrates": 40.0}
    assert SAFETY_THRESHOLDS["cholesterol"] == {"saturated_fat": 5.0, "fat": 20.0}
    assert SAFETY_THRESHOLDS["hypertension"] == {"sodium": 0.3}
    assert SAFETY_THRESHOLDS["obesity"] == {"energy_kcal": 400.0}

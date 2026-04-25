"""Round-trip and validation tests for Pydantic models in app.models.

These tests prove the models in T0.3 match the JSON shapes documented
in docs/lld.md § API Contracts. Every model is exercised: happy path,
optional-field omission, type coercion, and the obvious failure cases.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models.food import (
    Alternative,
    Category,
    FoodResult,
    Nutrient,
    ProductSummary,
    ScoreFactor,
    SearchResponse,
)
from app.models.user import HistoryItem, ProfileResponse

# ---------------------------------------------------------------------------
# Nutrient
# ---------------------------------------------------------------------------


class TestNutrient:
    def test_happy_path(self) -> None:
        n = Nutrient(
            energy_kcal=539,
            fat=30.9,
            saturated_fat=10.6,
            carbohydrates=57.5,
            sugars=56.3,
            fiber=3.0,
            proteins=6.3,
            sodium=0.107,
        )
        assert n.energy_kcal == 539
        assert n.sugars == 56.3

    def test_round_trip(self) -> None:
        data = {
            "energy_kcal": 539,
            "fat": 30.9,
            "saturated_fat": 10.6,
            "carbohydrates": 57.5,
            "sugars": 56.3,
            "fiber": 3.0,
            "proteins": 6.3,
            "sodium": 0.107,
        }
        assert Nutrient(**data).model_dump() == data

    def test_int_coerced_to_float(self) -> None:
        n = Nutrient(
            energy_kcal=100,
            fat=0,
            saturated_fat=0,
            carbohydrates=0,
            sugars=0,
            fiber=0,
            proteins=0,
            sodium=0,
        )
        assert isinstance(n.fat, float)

    def test_missing_required_field(self) -> None:
        with pytest.raises(ValidationError) as exc:
            Nutrient(  # type: ignore[call-arg]
                energy_kcal=100, fat=0, saturated_fat=0, carbohydrates=0,
                sugars=0, fiber=0, proteins=0,
            )
        assert "sodium" in str(exc.value)

    def test_zero_values_allowed(self) -> None:
        n = Nutrient(
            energy_kcal=0, fat=0, saturated_fat=0, carbohydrates=0,
            sugars=0, fiber=0, proteins=0, sodium=0,
        )
        assert n.energy_kcal == 0


# ---------------------------------------------------------------------------
# ProductSummary
# ---------------------------------------------------------------------------


class TestProductSummary:
    def test_minimal(self) -> None:
        p = ProductSummary(barcode="3017620422003", name="Nutella", score=12)
        assert p.brand is None
        assert p.image_url is None
        assert p.nutri_score is None
        assert p.nova_group is None

    def test_full(self) -> None:
        p = ProductSummary(
            barcode="3017620422003",
            name="Nutella",
            brand="Ferrero",
            image_url="https://example.com/n.jpg",
            nutri_score="E",
            nova_group=4,
            score=12,
        )
        assert p.brand == "Ferrero"
        assert p.nova_group == 4

    def test_round_trip_excludes_none(self) -> None:
        data = {"barcode": "x", "name": "y", "score": 50}
        assert ProductSummary(**data).model_dump(exclude_none=True) == data


# ---------------------------------------------------------------------------
# ScoreFactor
# ---------------------------------------------------------------------------


class TestScoreFactor:
    def test_positive_impact(self) -> None:
        f = ScoreFactor(factor="High fiber", impact=5, reason="Satiety bonus")
        assert f.impact == 5

    def test_negative_impact(self) -> None:
        f = ScoreFactor(factor="High sugar", impact=-15, reason="Diabetes penalty")
        assert f.impact == -15

    def test_required_fields(self) -> None:
        with pytest.raises(ValidationError):
            ScoreFactor(factor="x", impact=0)  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# Alternative
# ---------------------------------------------------------------------------


class TestAlternative:
    def test_with_amazon_url(self) -> None:
        a = Alternative(
            barcode="x",
            name="Justin's Almond Butter",
            brand="Justin's",
            score=72,
            image_url="https://example.com/jab.jpg",
            amazon_url="https://amazon.com/dp/X?tag=clean-20",
        )
        assert a.amazon_url is not None

    def test_without_amazon_url(self) -> None:
        """Per spec: alternatives without an Amazon match still appear."""
        a = Alternative(barcode="x", name="y", score=70)
        assert a.amazon_url is None
        assert a.brand is None


# ---------------------------------------------------------------------------
# FoodResult
# ---------------------------------------------------------------------------


def _make_food_result(**overrides: object) -> FoodResult:
    base: dict[str, object] = {
        "barcode": "3017620422003",
        "name": "Nutella",
        "brand": "Ferrero",
        "image_url": "https://example.com/n.jpg",
        "nutri_score": "E",
        "nova_group": 4,
        "nutrients": Nutrient(
            energy_kcal=539, fat=30.9, saturated_fat=10.6,
            carbohydrates=57.5, sugars=56.3, fiber=3.0,
            proteins=6.3, sodium=0.107,
        ),
        "score": 12,
        "score_label": "Avoid",
        "score_breakdown": [
            ScoreFactor(factor="Nutri-Score E", impact=-25, reason="Poor quality"),
            ScoreFactor(factor="High sugar", impact=-15, reason="Diabetes penalty"),
        ],
        "alternatives": [],
        "body_impact": None,
        "personalized": False,
    }
    base.update(overrides)
    return FoodResult(**base)  # type: ignore[arg-type]


class TestFoodResult:
    def test_happy_path(self) -> None:
        fr = _make_food_result()
        assert fr.score == 12
        assert fr.personalized is False
        assert len(fr.score_breakdown) == 2

    def test_with_body_impact(self) -> None:
        fr = _make_food_result(
            body_impact="Nutella is extremely high in sugar.",
            personalized=True,
        )
        assert fr.body_impact is not None
        assert fr.personalized is True

    def test_with_alternatives(self) -> None:
        alt = Alternative(barcode="x", name="Almond butter", score=72)
        fr = _make_food_result(alternatives=[alt])
        assert fr.alternatives[0].score == 72

    def test_round_trip_full(self) -> None:
        fr = _make_food_result(
            body_impact="Test summary.",
            personalized=True,
            alternatives=[Alternative(barcode="a", name="A", score=80)],
        )
        dumped = fr.model_dump()
        restored = FoodResult(**dumped)
        assert restored.model_dump() == dumped

    def test_missing_personalized_field(self) -> None:
        with pytest.raises(ValidationError) as exc:
            FoodResult(  # type: ignore[call-arg]
                barcode="x", name="y", nutrients=Nutrient(
                    energy_kcal=0, fat=0, saturated_fat=0, carbohydrates=0,
                    sugars=0, fiber=0, proteins=0, sodium=0,
                ),
                score=0, score_label="Avoid",
                score_breakdown=[], alternatives=[],
            )
        assert "personalized" in str(exc.value)


# ---------------------------------------------------------------------------
# SearchResponse
# ---------------------------------------------------------------------------


class TestSearchResponse:
    def test_empty(self) -> None:
        r = SearchResponse(products=[], total=0, page=1)
        assert r.products == []

    def test_with_products(self) -> None:
        r = SearchResponse(
            products=[ProductSummary(barcode="x", name="y", score=50)],
            total=1, page=1,
        )
        assert len(r.products) == 1


# ---------------------------------------------------------------------------
# Category
# ---------------------------------------------------------------------------


class TestCategory:
    def test_happy_path(self) -> None:
        c = Category(slug="snacks", label="Snacks", icon="🍿")
        assert c.slug == "snacks"

    def test_required_fields(self) -> None:
        with pytest.raises(ValidationError):
            Category(slug="x", label="y")  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# ProfileResponse
# ---------------------------------------------------------------------------


class TestProfileResponse:
    def test_empty_conditions(self) -> None:
        p = ProfileResponse(health_conditions=[])
        assert p.health_conditions == []

    def test_multiple_conditions(self) -> None:
        p = ProfileResponse(health_conditions=["diabetes", "hypertension"])
        assert len(p.health_conditions) == 2


# ---------------------------------------------------------------------------
# HistoryItem
# ---------------------------------------------------------------------------


class TestHistoryItem:
    def test_happy_path(self) -> None:
        h = HistoryItem(
            id="abc-123",
            barcode="3017620422003",
            product_name="Nutella",
            brand="Ferrero",
            image_url="https://example.com/n.jpg",
            score=12,
            scanned_at=datetime(2026, 4, 25, tzinfo=UTC),
        )
        assert h.score == 12

    def test_minimal(self) -> None:
        h = HistoryItem(
            id="abc",
            product_name="Plain Yogurt",
            score=80,
            scanned_at=datetime.now(UTC),
        )
        assert h.barcode is None
        assert h.brand is None

    def test_iso_string_parsed(self) -> None:
        h = HistoryItem(
            id="abc",
            product_name="x",
            score=0,
            scanned_at="2026-04-25T10:00:00Z",  # type: ignore[arg-type]
        )
        assert h.scanned_at.year == 2026

"""Tests for food_service.get_alternatives.

Strategy: rather than wiring the full OFF cassette through search_products,
we monkeypatch ``food_service.search_products`` to return a controlled
list of candidate dicts. Scoring runs through the real
``scoring_service.compute_score`` so the table is grounded in actual
algorithm output.

amazon_service.get_affiliate_link is stubbed to keep the test offline.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.services import amazon_service, food_service


def _candidate(
    *,
    barcode: str,
    name: str,
    nutri: str = "A",
    nova: int = 1,
    sugars: float = 1.0,
    fat: float = 1.0,
    saturated_fat: float = 0.5,
    carbohydrates: float = 5.0,
    fiber: float = 1.0,
    proteins: float = 5.0,
    sodium: float = 0.05,
    energy_kcal: float = 100.0,
    brand: str | None = "Brand",
    image_url: str | None = "https://img/x.jpg",
) -> dict[str, Any]:
    return {
        "barcode": barcode,
        "name": name,
        "brand": brand,
        "image_url": image_url,
        "nutri_score": nutri,
        "nova_group": nova,
        "nutrients": {
            "energy_kcal": energy_kcal,
            "fat": fat,
            "saturated_fat": saturated_fat,
            "carbohydrates": carbohydrates,
            "sugars": sugars,
            "fiber": fiber,
            "proteins": proteins,
            "sodium": sodium,
        },
        "categories_tags": ["en:spreads"],
    }


@pytest.fixture
def stub_amazon(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[str]]:
    """Replace amazon_service.get_affiliate_link with a deterministic stub.

    Records each query the function was called with so tests can assert
    that food_service builds a sensible search query.
    """
    seen: dict[str, list[str]] = {"queries": []}

    async def _fake(query: str) -> str | None:
        seen["queries"].append(query)
        return f"https://www.amazon.com/dp/FAKE?q={query}&tag=clean-20"

    monkeypatch.setattr(amazon_service, "get_affiliate_link", _fake)
    return seen


@pytest.fixture
def stub_amazon_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """Amazon integration disabled — every call returns None."""

    async def _fake(_query: str) -> None:
        return None

    monkeypatch.setattr(amazon_service, "get_affiliate_link", _fake)


def _patch_search(
    monkeypatch: pytest.MonkeyPatch, products: list[dict[str, Any]]
) -> dict[str, Any]:
    """Replace food_service.search_products with one that yields ``products``."""
    captured: dict[str, Any] = {"calls": 0, "kwargs": None}

    async def _fake_search(**kwargs: Any) -> tuple[list[dict[str, Any]], int]:
        captured["calls"] += 1
        captured["kwargs"] = kwargs
        return products, len(products)

    monkeypatch.setattr(food_service, "search_products", _fake_search)
    return captured


# ---------------------------------------------------------------------------
# Fast paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_empty_when_category_none(stub_amazon_none: None) -> None:
    assert (
        await food_service.get_alternatives("3017620422003", None, 12, ["diabetes"])
        == []
    )


@pytest.mark.asyncio
async def test_returns_empty_when_category_empty_string(stub_amazon_none: None) -> None:
    assert (
        await food_service.get_alternatives("3017620422003", "", 12, ["diabetes"]) == []
    )


@pytest.mark.asyncio
async def test_returns_empty_when_search_yields_nothing(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    _patch_search(monkeypatch, [])
    out = await food_service.get_alternatives("X", "en:spreads", 50, None)
    assert out == []


@pytest.mark.asyncio
async def test_returns_empty_when_no_candidate_passes_score_gate(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    # All candidates are NOVA-4 ultra-processed → score after gate < 60.
    products = [
        _candidate(barcode="A1", name="Junk A", nutri="E", nova=4),
        _candidate(barcode="A2", name="Junk B", nutri="D", nova=4),
    ]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("X", "en:spreads", 30, None)
    assert out == []


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_filters_out_products_below_60(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    # Mix: A/NOVA-1 (80, kept), C/NOVA-3 (40, dropped).
    products = [
        _candidate(barcode="GOOD", name="Yogurt", nutri="A", nova=1),
        _candidate(barcode="MID", name="Cracker", nutri="C", nova=3),
    ]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("X", "en:spreads", 20, None)
    assert [a.barcode for a in out] == ["GOOD"]
    assert out[0].score == 80


@pytest.mark.asyncio
async def test_filters_out_products_at_or_below_current_score(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    # Two A/NOVA-1 products = score 80 each. current_score=80 → both excluded.
    products = [
        _candidate(barcode="EQ1", name="Eq A", nutri="A", nova=1),
        _candidate(barcode="EQ2", name="Eq B", nutri="A", nova=1),
    ]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("X", "en:spreads", 80, None)
    assert out == []


@pytest.mark.asyncio
async def test_excludes_current_product_by_barcode(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    products = [
        _candidate(barcode="CURRENT", name="Current", nutri="A", nova=1),
        _candidate(barcode="OTHER", name="Other", nutri="A", nova=1),
    ]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("CURRENT", "en:spreads", 20, None)
    assert [a.barcode for a in out] == ["OTHER"]


@pytest.mark.asyncio
async def test_skips_candidates_missing_barcode_or_name(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    bad = _candidate(barcode="GOOD", name="Good", nutri="A", nova=1)
    products: list[dict[str, Any]] = [
        {**bad, "barcode": ""},  # missing barcode
        {**bad, "name": ""},  # missing name
        bad,
    ]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("X", "en:spreads", 20, None)
    assert [a.barcode for a in out] == ["GOOD"]


# ---------------------------------------------------------------------------
# Sorting + cap
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sorts_by_score_desc(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    # B/NOVA-1 → 65. A/NOVA-1 → 80. B/NOVA-2 → 60.
    products = [
        _candidate(barcode="MID", name="Mid", nutri="B", nova=1),
        _candidate(barcode="TOP", name="Top", nutri="A", nova=1),
        _candidate(barcode="LOW", name="Low", nutri="B", nova=2),
    ]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("X", "en:spreads", 20, None)
    assert [a.barcode for a in out] == ["TOP", "MID", "LOW"]
    assert [a.score for a in out] == [80, 65, 60]


@pytest.mark.asyncio
async def test_caps_at_five(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    # 7 A/NOVA-1 candidates → all score 80 → only 5 returned.
    products = [
        _candidate(barcode=f"A{i}", name=f"Alt {i}", nutri="A", nova=1) for i in range(7)
    ]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("X", "en:spreads", 20, None)
    assert len(out) == 5


@pytest.mark.asyncio
async def test_returns_exactly_five_when_input_is_five(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    products = [
        _candidate(barcode=f"A{i}", name=f"Alt {i}", nutri="A", nova=1) for i in range(5)
    ]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("X", "en:spreads", 20, None)
    assert len(out) == 5


# ---------------------------------------------------------------------------
# Personalization + Amazon enrichment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_conditions_can_drop_a_candidate(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    # B/NOVA-1 with sugars 20 → generic 65 (passes), with diabetes -15 → 50 (fails).
    p = _candidate(
        barcode="SUGARY", name="Sugary", nutri="B", nova=1, sugars=20.0
    )
    healthy = _candidate(barcode="GOOD", name="Healthy", nutri="A", nova=1)
    _patch_search(monkeypatch, [p, healthy])

    out_generic = await food_service.get_alternatives("X", "en:spreads", 30, None)
    assert {a.barcode for a in out_generic} == {"SUGARY", "GOOD"}

    out_diabetic = await food_service.get_alternatives(
        "X", "en:spreads", 30, ["diabetes"]
    )
    assert [a.barcode for a in out_diabetic] == ["GOOD"]


@pytest.mark.asyncio
async def test_amazon_url_populated_when_creds_present(
    monkeypatch: pytest.MonkeyPatch, stub_amazon: dict[str, list[str]]
) -> None:
    products = [_candidate(barcode="A", name="Almonds", brand="Blue Diamond")]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("X", "en:spreads", 20, None)
    assert len(out) == 1
    assert out[0].amazon_url is not None
    assert "tag=clean-20" in out[0].amazon_url
    assert stub_amazon["queries"] == ["Almonds Blue Diamond"]


@pytest.mark.asyncio
async def test_amazon_url_is_none_when_creds_missing(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    products = [_candidate(barcode="A", name="Almonds")]
    _patch_search(monkeypatch, products)
    out = await food_service.get_alternatives("X", "en:spreads", 20, None)
    assert len(out) == 1
    assert out[0].amazon_url is None


@pytest.mark.asyncio
async def test_amazon_query_omits_brand_when_brand_missing(
    monkeypatch: pytest.MonkeyPatch, stub_amazon: dict[str, list[str]]
) -> None:
    products = [_candidate(barcode="A", name="Plain Yogurt", brand=None)]
    _patch_search(monkeypatch, products)
    await food_service.get_alternatives("X", "en:spreads", 20, None)
    assert stub_amazon["queries"] == ["Plain Yogurt"]


@pytest.mark.asyncio
async def test_search_called_with_category(
    monkeypatch: pytest.MonkeyPatch, stub_amazon_none: None
) -> None:
    captured = _patch_search(monkeypatch, [])
    await food_service.get_alternatives("X", "en:spreads", 20, None)
    assert captured["calls"] == 1
    assert captured["kwargs"] == {"category": "en:spreads"}

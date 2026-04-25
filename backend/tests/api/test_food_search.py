"""Tests for GET /api/food/search.

Stubs ``food_service.search_products`` so we don't depend on cassette
re-recording for every search-shape variation. The OFF parsing path is
covered separately in ``test_food_service.py``.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.services import food_service


def _stub(results: list[dict[str, Any]], total: int | None = None):
    async def _fake(*_, **__) -> tuple[list[dict[str, Any]], int]:
        return results, total if total is not None else len(results)

    return _fake


def _product(**kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "barcode": "x",
        "name": "P",
        "brand": "B",
        "image_url": "http://img",
        "nutri_score": "C",
        "nova_group": 3,
        "nutrients": {
            "energy_kcal": 100,
            "fat": 1,
            "saturated_fat": 0,
            "carbohydrates": 10,
            "sugars": 1,
            "fiber": 1,
            "proteins": 5,
            "sodium": 0.05,
        },
        "categories_tags": [],
    }
    base.update(kw)
    return base


@pytest.mark.asyncio
async def test_requires_q_or_category(unauthed_client: httpx.AsyncClient) -> None:
    res = await unauthed_client.get("/api/food/search")
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_basic_query(
    unauthed_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        food_service, "search_products", _stub([_product(barcode="1", name="A")], 1)
    )
    res = await unauthed_client.get("/api/food/search", params={"q": "x"})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["products"][0]["barcode"] == "1"


@pytest.mark.asyncio
async def test_min_score_filters_low(
    unauthed_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Two products: one A NOVA-1 (score 80), one E NOVA-4 (score 0)
    bad = _product(barcode="bad", nutri_score="E", nova_group=4)
    good = _product(barcode="good", nutri_score="A", nova_group=1)
    monkeypatch.setattr(food_service, "search_products", _stub([bad, good], 2))
    res = await unauthed_client.get(
        "/api/food/search", params={"q": "x", "min_score": 60}
    )
    assert res.status_code == 200
    body = res.json()
    assert [p["barcode"] for p in body["products"]] == ["good"]
    # total reflects upstream OFF count, not post-filter
    assert body["total"] == 2


@pytest.mark.asyncio
async def test_safe_for_diabetes_filters_high_sugar(
    unauthed_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sugary = _product(
        barcode="sugary",
        nutrients={
            "energy_kcal": 200,
            "fat": 0,
            "saturated_fat": 0,
            "carbohydrates": 50,
            "sugars": 30,
            "fiber": 0,
            "proteins": 0,
            "sodium": 0,
        },
    )
    safe = _product(
        barcode="safe",
        nutrients={
            "energy_kcal": 100,
            "fat": 1,
            "saturated_fat": 0,
            "carbohydrates": 10,
            "sugars": 5,
            "fiber": 1,
            "proteins": 5,
            "sodium": 0.05,
        },
    )
    monkeypatch.setattr(food_service, "search_products", _stub([sugary, safe], 2))
    res = await unauthed_client.get(
        "/api/food/search", params=[("q", "x"), ("safe_for", "diabetes")]
    )
    assert res.status_code == 200
    body = res.json()
    assert [p["barcode"] for p in body["products"]] == ["safe"]


@pytest.mark.asyncio
async def test_safe_for_multi_condition_excludes_failing_either(
    unauthed_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Salty but low-sugar
    salty = _product(
        barcode="salty",
        nutrients={
            "energy_kcal": 100,
            "fat": 1,
            "saturated_fat": 0,
            "carbohydrates": 5,
            "sugars": 1,
            "fiber": 1,
            "proteins": 5,
            "sodium": 1.0,
        },
    )
    monkeypatch.setattr(food_service, "search_products", _stub([salty], 1))
    res = await unauthed_client.get(
        "/api/food/search",
        params=[("q", "x"), ("safe_for", "diabetes"), ("safe_for", "hypertension")],
    )
    body = res.json()
    assert body["products"] == []


@pytest.mark.asyncio
async def test_invalid_min_score(unauthed_client: httpx.AsyncClient) -> None:
    res = await unauthed_client.get(
        "/api/food/search", params={"q": "x", "min_score": 500}
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_page_must_be_positive(unauthed_client: httpx.AsyncClient) -> None:
    res = await unauthed_client.get("/api/food/search", params={"q": "x", "page": 0})
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_pagination_passthrough(
    unauthed_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    async def _fake(**kwargs: Any) -> tuple[list[dict[str, Any]], int]:
        captured.update(kwargs)
        return [], 0

    monkeypatch.setattr(food_service, "search_products", _fake)
    await unauthed_client.get("/api/food/search", params={"q": "x", "page": 3})
    assert captured["page"] == 3


@pytest.mark.asyncio
async def test_repeated_filter_params_passthrough(
    unauthed_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    async def _fake(**kwargs: Any) -> tuple[list[dict[str, Any]], int]:
        captured.update(kwargs)
        return [], 0

    monkeypatch.setattr(food_service, "search_products", _fake)
    await unauthed_client.get(
        "/api/food/search",
        params=[
            ("q", "x"),
            ("nutri_score", "A"),
            ("nutri_score", "B"),
            ("nova_group", "1"),
            ("nova_group", "2"),
        ],
    )
    assert captured["nutri_score"] == ["A", "B"]
    assert captured["nova_group"] == [1, 2]

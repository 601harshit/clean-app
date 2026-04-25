"""Tests for GET /api/food/categories."""

from __future__ import annotations

import httpx
import pytest


@pytest.mark.asyncio
async def test_returns_eight_categories(unauthed_client: httpx.AsyncClient) -> None:
    res = await unauthed_client.get("/api/food/categories")
    assert res.status_code == 200
    body = res.json()
    assert "categories" in body
    assert len(body["categories"]) == 8


@pytest.mark.asyncio
async def test_each_category_has_slug_label_icon(
    unauthed_client: httpx.AsyncClient,
) -> None:
    body = (await unauthed_client.get("/api/food/categories")).json()
    for cat in body["categories"]:
        assert set(cat.keys()) == {"slug", "label", "icon"}
        assert cat["slug"]
        assert cat["label"]
        assert cat["icon"]


@pytest.mark.asyncio
async def test_includes_known_slugs(unauthed_client: httpx.AsyncClient) -> None:
    body = (await unauthed_client.get("/api/food/categories")).json()
    slugs = {c["slug"] for c in body["categories"]}
    assert {"snacks", "dairy", "beverages", "cereals"}.issubset(slugs)


@pytest.mark.asyncio
async def test_no_auth_required(unauthed_client: httpx.AsyncClient) -> None:
    """Categories must work for guests."""
    res = await unauthed_client.get("/api/food/categories")
    assert res.status_code == 200

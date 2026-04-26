"""Tests for app.services.amazon_service.

The PA API is mocked at the HTTP layer with respx. Cassettes/credentials
are not required: tests inject keys via monkeypatch and assert that the
function returns ``None`` quietly when keys are absent or when the
upstream is unreachable / malformed.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx

from app.core.config import get_settings
from app.services import amazon_service
from app.services.amazon_service import (
    DEFAULT_HOST,
    URI,
    _build_signed_request,
    _ensure_affiliate_tag,
    _extract_first_item_url,
    get_affiliate_link,
)

PA_URL = f"https://{DEFAULT_HOST}{URI}"


@pytest.fixture
def with_creds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AMAZON_ACCESS_KEY", "AKIAFAKEKEY12345")
    monkeypatch.setenv("AMAZON_SECRET_KEY", "fake/secret/key+abcdef1234567890")
    monkeypatch.setenv("AMAZON_PARTNER_TAG", "clean-20")
    monkeypatch.setenv("AMAZON_REGION", "us-east-1")
    get_settings.cache_clear()


@pytest.fixture
def without_creds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AMAZON_ACCESS_KEY", raising=False)
    monkeypatch.delenv("AMAZON_SECRET_KEY", raising=False)
    monkeypatch.delenv("AMAZON_PARTNER_TAG", raising=False)
    monkeypatch.delenv("AMAZON_REGION", raising=False)
    get_settings.cache_clear()


def _ok_payload(url: str = "https://www.amazon.com/dp/B00FAKE?tag=clean-20") -> dict[str, Any]:
    return {
        "SearchResult": {
            "Items": [
                {
                    "ASIN": "B00FAKE",
                    "DetailPageURL": url,
                    "ItemInfo": {"Title": {"DisplayValue": "Mock Product"}},
                }
            ]
        }
    }


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestBuildSignedRequest:
    def test_includes_required_headers_and_signed_body(self) -> None:
        url, headers, body = _build_signed_request(
            access_key="AKIA1",
            secret_key="secret",
            partner_tag="clean-20",
            region="us-east-1",
            payload={"Keywords": "almond butter", "SearchIndex": "Grocery"},
        )
        assert url == PA_URL
        assert headers["X-Amz-Target"].endswith("SearchItems")
        assert headers["Authorization"].startswith("AWS4-HMAC-SHA256 ")
        assert "Signature=" in headers["Authorization"]
        assert "PartnerTag" in body and "clean-20" in body
        assert "Marketplace" in body  # we inject it for the caller


class TestExtractFirstItemUrl:
    def test_happy_path(self) -> None:
        assert (
            _extract_first_item_url(_ok_payload("https://www.amazon.com/dp/X"))
            == "https://www.amazon.com/dp/X"
        )

    @pytest.mark.parametrize(
        "payload",
        [
            None,
            {},
            {"SearchResult": None},
            {"SearchResult": {}},
            {"SearchResult": {"Items": None}},
            {"SearchResult": {"Items": []}},
            {"SearchResult": {"Items": [{"DetailPageURL": 123}]}},
            {"SearchResult": {"Items": [{}]}},
            {"SearchResult": {"Items": [{"DetailPageURL": "ftp://nope"}]}},
            "not a dict",
        ],
    )
    def test_malformed_returns_none(self, payload: Any) -> None:
        assert _extract_first_item_url(payload) is None


class TestEnsureAffiliateTag:
    def test_appends_when_missing(self) -> None:
        assert (
            _ensure_affiliate_tag("https://www.amazon.com/dp/X", "clean-20")
            == "https://www.amazon.com/dp/X?tag=clean-20"
        )

    def test_appends_with_amp_when_query_present(self) -> None:
        assert (
            _ensure_affiliate_tag("https://www.amazon.com/dp/X?foo=1", "clean-20")
            == "https://www.amazon.com/dp/X?foo=1&tag=clean-20"
        )

    def test_keeps_url_unchanged_when_already_tagged(self) -> None:
        url = "https://www.amazon.com/dp/X?tag=clean-20"
        assert _ensure_affiliate_tag(url, "clean-20") == url


# ---------------------------------------------------------------------------
# get_affiliate_link
# ---------------------------------------------------------------------------


class TestGetAffiliateLinkCredsGate:
    @pytest.mark.asyncio
    async def test_returns_none_when_creds_missing(self, without_creds: None) -> None:
        assert await get_affiliate_link("Justin's Almond Butter") is None

    @pytest.mark.asyncio
    async def test_returns_none_for_empty_query(self, with_creds: None) -> None:
        assert await get_affiliate_link("") is None
        assert await get_affiliate_link("   ") is None


class TestGetAffiliateLinkHttp:
    @pytest.mark.asyncio
    async def test_success_returns_url(self, with_creds: None) -> None:
        with respx.mock(assert_all_called=False) as router:
            router.post(PA_URL).mock(
                return_value=httpx.Response(
                    200,
                    json=_ok_payload("https://www.amazon.com/dp/B00FAKE?tag=clean-20"),
                )
            )
            url = await get_affiliate_link("Justin's Almond Butter Justin's")
        assert url == "https://www.amazon.com/dp/B00FAKE?tag=clean-20"

    @pytest.mark.asyncio
    async def test_url_without_tag_gets_tag_appended(self, with_creds: None) -> None:
        with respx.mock(assert_all_called=False) as router:
            router.post(PA_URL).mock(
                return_value=httpx.Response(
                    200, json=_ok_payload("https://www.amazon.com/dp/X")
                )
            )
            url = await get_affiliate_link("X")
        assert url == "https://www.amazon.com/dp/X?tag=clean-20"

    @pytest.mark.asyncio
    async def test_falls_back_to_health_when_grocery_empty(
        self, with_creds: None
    ) -> None:
        empty = {"SearchResult": {"Items": []}}
        ok = _ok_payload("https://www.amazon.com/dp/HEALTH?tag=clean-20")
        responses = [httpx.Response(200, json=empty), httpx.Response(200, json=ok)]
        call_idx = {"i": 0}

        def _handler(_request: httpx.Request) -> httpx.Response:
            r = responses[call_idx["i"]]
            call_idx["i"] += 1
            return r

        with respx.mock(assert_all_called=False) as router:
            router.post(PA_URL).mock(side_effect=_handler)
            url = await get_affiliate_link("multivitamin")
        assert url == "https://www.amazon.com/dp/HEALTH?tag=clean-20"
        assert call_idx["i"] == 2

    @pytest.mark.asyncio
    async def test_500_returns_none(self, with_creds: None) -> None:
        with respx.mock(assert_all_called=False) as router:
            router.post(PA_URL).mock(
                return_value=httpx.Response(503, json={"error": "down"})
            )
            assert await get_affiliate_link("anything") is None

    @pytest.mark.asyncio
    async def test_network_error_returns_none(self, with_creds: None) -> None:
        with respx.mock(assert_all_called=False) as router:
            router.post(PA_URL).mock(side_effect=httpx.ConnectError("boom"))
            assert await get_affiliate_link("anything") is None

    @pytest.mark.asyncio
    async def test_malformed_json_returns_none(self, with_creds: None) -> None:
        with respx.mock(assert_all_called=False) as router:
            router.post(PA_URL).mock(
                return_value=httpx.Response(200, content=b"not-json{")
            )
            assert await get_affiliate_link("anything") is None

    @pytest.mark.asyncio
    async def test_no_items_returns_none_after_both_indexes(
        self, with_creds: None
    ) -> None:
        with respx.mock(assert_all_called=False) as router:
            router.post(PA_URL).mock(
                return_value=httpx.Response(200, json={"SearchResult": {"Items": []}})
            )
            assert await get_affiliate_link("nothing matches") is None

    @pytest.mark.asyncio
    async def test_unexpected_exception_returns_none(
        self, with_creds: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Force _build_signed_request to blow up — exercises the
        # last-ditch except block in get_affiliate_link.
        def _boom(**_: Any) -> Any:
            raise RuntimeError("signing imploded")

        monkeypatch.setattr(amazon_service, "_build_signed_request", _boom)
        assert await get_affiliate_link("anything") is None

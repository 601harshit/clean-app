"""Amazon Product Advertising API v5 client.

Used to enrich healthier-alternative cards with an "Order on Amazon"
affiliate link. The API requires AWS SigV4 signing of the JSON body for
the ``ProductAdvertisingAPIv1.SearchItems`` operation.

Public surface:

* ``get_affiliate_link(query)`` — returns an affiliate URL for the first
  matching grocery item, or ``None`` if anything fails (missing creds,
  network error, no results, malformed response). The caller is expected
  to render the alternative card without an "Order on Amazon" button when
  the URL is ``None`` (per docs/features/alternatives.md acceptance).

Failure mode: the function NEVER raises. It logs a warning and returns
``None`` so the calling food_service can keep building alternatives even
when Amazon is down or unconfigured.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import hmac
import json
import logging
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Amazon PA API v5 — see https://webservices.amazon.com/paapi5/documentation
DEFAULT_HOST = "webservices.amazon.com"
DEFAULT_REGION = "us-east-1"
SERVICE = "ProductAdvertisingAPI"
TARGET = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems"
URI = "/paapi5/searchitems"
DEFAULT_TIMEOUT = httpx.Timeout(8.0, connect=4.0)

# We try Grocery first, then HealthPersonalCare per the feature spec.
SEARCH_INDEXES: tuple[str, ...] = ("Grocery", "HealthPersonalCare")
RESOURCES: list[str] = [
    "ItemInfo.Title",
    "Offers.Listings.Price",
    "Images.Primary.Medium",
]


def _credentials() -> tuple[str, str, str, str] | None:
    """Return (access_key, secret_key, partner_tag, region) or None if unset.

    All four must be present; if any is missing we treat the integration
    as disabled and return ``None`` from ``get_affiliate_link`` silently.
    """
    s = get_settings()
    access = s.AMAZON_ACCESS_KEY
    secret = s.AMAZON_SECRET_KEY
    tag = s.AMAZON_PARTNER_TAG
    region = s.AMAZON_REGION or DEFAULT_REGION
    if not access or not secret or not tag:
        return None
    return access, secret, tag, region


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date = _sign(("AWS4" + secret).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    return _sign(k_service, "aws4_request")


def _build_signed_request(
    *,
    access_key: str,
    secret_key: str,
    partner_tag: str,
    region: str,
    payload: dict[str, Any],
    host: str = DEFAULT_HOST,
    now: _dt.datetime | None = None,
) -> tuple[str, dict[str, str], str]:
    """Build a fully SigV4-signed POST for the SearchItems endpoint.

    Returns ``(url, headers, body)``. Pure: takes a clock so tests can pin
    the timestamp. Body is JSON-encoded with sorted keys for canonical
    hashing — Amazon does NOT require sorted keys but it makes test
    fixtures deterministic.
    """
    now = now or _dt.datetime.now(_dt.UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    full_payload = {
        **payload,
        "PartnerTag": partner_tag,
        "PartnerType": "Associates",
        "Marketplace": "www.amazon.com",
    }
    body = json.dumps(full_payload, sort_keys=True, separators=(",", ":"))
    body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()

    canonical_headers = (
        f"content-encoding:amz-1.0\n"
        f"host:{host}\n"
        f"x-amz-date:{amz_date}\n"
        f"x-amz-target:{TARGET}\n"
    )
    signed_headers = "content-encoding;host;x-amz-date;x-amz-target"

    canonical_request = "\n".join(
        [
            "POST",
            URI,
            "",
            canonical_headers,
            signed_headers,
            body_hash,
        ]
    )

    credential_scope = f"{date_stamp}/{region}/{SERVICE}/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )

    signing_key = _signing_key(secret_key, date_stamp, region, SERVICE)
    signature = hmac.new(
        signing_key, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    headers = {
        "Authorization": authorization,
        "Content-Encoding": "amz-1.0",
        "Content-Type": "application/json; charset=utf-8",
        "Host": host,
        "X-Amz-Date": amz_date,
        "X-Amz-Target": TARGET,
    }
    url = f"https://{host}{URI}"
    return url, headers, body


def _extract_first_item_url(payload: Any) -> str | None:
    """Pull the first item's DetailPageURL out of a SearchItems response.

    Returns ``None`` for any shape we don't recognize; we never trust the
    upstream to be well-formed.
    """
    if not isinstance(payload, dict):
        return None
    sr = payload.get("SearchResult")
    if not isinstance(sr, dict):
        return None
    items = sr.get("Items")
    if not isinstance(items, list) or not items:
        return None
    first = items[0]
    if not isinstance(first, dict):
        return None
    url = first.get("DetailPageURL")
    if isinstance(url, str) and url.startswith("http"):
        return url
    return None


def _ensure_affiliate_tag(url: str, tag: str) -> str:
    """Append ``?tag=...`` to a URL if it's missing.

    Amazon's SearchItems already returns DetailPageURL pre-tagged with the
    PartnerTag we sent, but we belt-and-suspenders this so an upstream
    quirk can't strip the affiliate attribution.
    """
    if f"tag={tag}" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}tag={quote(tag)}"


async def get_affiliate_link(query: str) -> str | None:
    """Return an Amazon affiliate URL for the first matching grocery item.

    Args:
        query: free-text search keywords (typically ``"{name} {brand}"``).

    Returns:
        A URL string with the partner tag attached, or ``None`` if:
          * any of AMAZON_ACCESS_KEY / AMAZON_SECRET_KEY / AMAZON_PARTNER_TAG
            are unset (integration disabled),
          * the network call fails for any reason,
          * the response is non-2xx,
          * no items are returned in any tried SearchIndex,
          * the response is malformed.

    Never raises.
    """
    if not isinstance(query, str) or not query.strip():
        return None

    creds = _credentials()
    if creds is None:
        # Quietly disabled — caller renders the card without a buy button.
        logger.debug("Amazon PA API credentials missing; skipping link lookup")
        return None
    access_key, secret_key, partner_tag, region = creds
    keywords = query.strip()

    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            for index in SEARCH_INDEXES:
                payload = {
                    "Keywords": keywords,
                    "SearchIndex": index,
                    "Resources": RESOURCES,
                    "ItemCount": 1,
                }
                url, headers, body = _build_signed_request(
                    access_key=access_key,
                    secret_key=secret_key,
                    partner_tag=partner_tag,
                    region=region,
                    payload=payload,
                )
                try:
                    resp = await client.post(url, headers=headers, content=body)
                except httpx.HTTPError as exc:
                    logger.warning(
                        "Amazon PA API request failed (%s): %s", index, exc
                    )
                    return None

                if resp.status_code != 200:
                    logger.warning(
                        "Amazon PA API non-200 (%s): %s", index, resp.status_code
                    )
                    # 4xx/5xx → don't try the next index, treat as failure.
                    return None
                try:
                    data = resp.json()
                except ValueError:
                    logger.warning("Amazon PA API returned non-JSON")
                    return None

                item_url = _extract_first_item_url(data)
                if item_url:
                    return _ensure_affiliate_tag(item_url, partner_tag)
                # Fall through to next SearchIndex.
    except Exception as exc:  # last-ditch — never let this bubble up
        logger.warning("Amazon PA API unexpected failure: %s", exc)
        return None

    return None

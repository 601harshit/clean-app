"""Supabase JWT verification.

Two algorithms are supported:

* HS256 — symmetric, signed with ``SUPABASE_JWT_SECRET``. This is the
  legacy/default for self-hosted Supabase using the static JWT secret,
  and the path the test suite exercises via ``mint_jwt``.
* ES256 — asymmetric, signed with the project's signing key. Recent
  Supabase versions (including the local CLI default) issue ES256
  tokens; the public keys are published at
  ``{SUPABASE_URL}/auth/v1/.well-known/jwks.json``.

We pick the algorithm from the token header and look up the matching
key. JWKS responses are cached process-locally for a short TTL — the
keys rotate on the order of months in production.
"""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from typing import Annotated, Any, cast

import httpx
from fastapi import Depends, Header, HTTPException, status
from jose import jwk, jwt
from jose.exceptions import JWTError

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

_SUPPORTED_ALGS = {"HS256", "ES256"}
_JWKS_TTL_SECONDS = 300


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


@lru_cache(maxsize=4)
def _jwks_cache_holder() -> dict[str, Any]:
    """Mutable in-process cache for JWKS lookups, keyed by issuer URL.

    Using lru_cache as a singleton holder; the dict is populated at runtime.
    """
    return {}


def _fetch_jwks(supabase_url: str) -> dict[str, Any] | None:
    cache = _jwks_cache_holder()
    entry = cache.get(supabase_url)
    now = time.time()
    if entry and now - entry["fetched_at"] < _JWKS_TTL_SECONDS:
        return cast(dict[str, Any], entry["jwks"])
    url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    try:
        r = httpx.get(url, timeout=2.0)
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception as exc:
        logger.warning("JWKS fetch failed for %s: %s", url, exc)
        return None
    cache[supabase_url] = {"jwks": data, "fetched_at": now}
    return cast(dict[str, Any], data)


def _key_for_kid(jwks: dict[str, Any], kid: str | None) -> dict[str, Any] | None:
    keys = jwks.get("keys") or []
    if not isinstance(keys, list):
        return None
    if kid:
        for k in keys:
            if isinstance(k, dict) and k.get("kid") == kid:
                return k
    # Fall back to the first key if no kid match (single-key projects).
    return keys[0] if keys and isinstance(keys[0], dict) else None


def _decode(token: str, settings: Settings) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token header",
        ) from exc
    alg = header.get("alg")
    if alg not in _SUPPORTED_ALGS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Unsupported JWT alg: {alg}",
        )

    try:
        if alg == "HS256":
            secret = settings.SUPABASE_JWT_SECRET
            if not secret:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="SUPABASE_JWT_SECRET not configured",
                )
            payload = jwt.decode(
                token, secret, algorithms=["HS256"], audience="authenticated"
            )
        else:
            jwks = _fetch_jwks(settings.SUPABASE_URL)
            if not jwks:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Unable to fetch signing keys",
                )
            key_dict = _key_for_kid(jwks, header.get("kid"))
            if not key_dict:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="No matching signing key",
                )
            public_key = jwk.construct(key_dict, algorithm="ES256")
            payload = jwt.decode(
                token,
                public_key.to_pem(),
                algorithms=["ES256"],
                audience="authenticated",
            )
        return cast(dict[str, Any], payload)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


SettingsDep = Annotated[Settings, Depends(get_settings)]
AuthHeader = Annotated[str | None, Header(alias="Authorization")]


def get_current_user(authorization: AuthHeader = None, settings: SettingsDep = None) -> str:  # type: ignore[assignment]
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    payload = _decode(token, settings)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has no subject",
        )
    return str(sub)


def get_current_user_optional(
    authorization: AuthHeader = None,
    settings: SettingsDep = None,  # type: ignore[assignment]
) -> str | None:
    token = _extract_bearer(authorization)
    if not token:
        return None
    try:
        payload = _decode(token, settings)
    except HTTPException:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None

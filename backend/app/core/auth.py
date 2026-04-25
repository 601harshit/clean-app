from typing import Annotated, Any, cast

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt

from app.core.config import Settings, get_settings


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def _decode(token: str, settings: Settings) -> dict[str, Any]:
    secret = settings.SUPABASE_JWT_SECRET
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_JWT_SECRET not configured",
        )
    try:
        payload = jwt.decode(
            token, secret, algorithms=["HS256"], audience="authenticated"
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

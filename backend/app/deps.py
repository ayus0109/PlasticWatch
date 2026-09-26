"""Shared FastAPI dependencies: demo auth and fixture loading.

Demo auth only (CLAUDE.md §8 — no real auth/OTP). A token is a signed statement of
"this browser picked seeded user X with role Y". It exists so that role violations
return 403 (CLAUDE.md §5); it protects nothing sensitive.

Token format, stdlib only (no new dependency — CLAUDE.md §3):
    base64url(json payload) + "." + base64url(HMAC-SHA256(secret, payload))
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings
from app.schemas import DemoUser, UserRole

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"

_bearer = HTTPBearer(auto_error=False)


# --------------------------------------------------------------------------
# Fixtures (Stage 1 stubs return these; real DB reads arrive in later stages)
# --------------------------------------------------------------------------


@lru_cache
def load_fixture(name: str) -> Any:
    """Load backend/fixtures/<name>.json. Cached — fixtures are read-only."""
    path = FIXTURES_DIR / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def demo_users() -> list[DemoUser]:
    return [DemoUser.model_validate(u) for u in load_fixture("demo_users")]


def find_demo_user(
    user_id: UUID | str | None = None, role: UserRole | None = None
) -> DemoUser | None:
    """By id if given, otherwise the first seeded account with the role."""
    target_id: UUID | None = None
    if user_id is not None:
        try:
            target_id = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
        except (ValueError, TypeError):
            return None
    for user in demo_users():
        if target_id is not None and user.id == target_id:
            return user
        if target_id is None and role is not None and user.role == role:
            return user
    return None


# --------------------------------------------------------------------------
# Token signing
# --------------------------------------------------------------------------


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: bytes) -> str:
    secret = get_settings().DEMO_TOKEN_SECRET.encode("utf-8")
    return _b64encode(hmac.new(secret, payload, hashlib.sha256).digest())


def create_demo_token(user: DemoUser) -> tuple[str, datetime]:
    """Return (token, expires_at) for an authenticated or demo user."""
    expires_at = datetime.now(UTC) + timedelta(hours=get_settings().DEMO_TOKEN_TTL_HOURS)
    payload = json.dumps(
        {
            "sub": str(user.id),
            "role": user.role.value,
            "name": user.name,
            "email": getattr(user, "email", None),
            "ward_id": getattr(user, "ward_id", None),
            "reliability": getattr(user, "reliability", 0.5),
            "is_simulated": getattr(user, "is_simulated", False),
            "exp": int(expires_at.timestamp()),
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"{_b64encode(payload)}.{_sign(payload)}", expires_at


# Alias for create_demo_token for real authentication
create_access_token = create_demo_token


def decode_demo_token(token: str) -> dict[str, Any]:
    """Verify signature and expiry. Raises ValueError on any problem."""
    try:
        body, signature = token.split(".", 1)
        payload = _b64decode(body)
    except (ValueError, TypeError) as exc:
        raise ValueError("malformed token") from exc

    # Constant-time comparison so the signature can't be probed byte by byte.
    if not hmac.compare_digest(signature, _sign(payload)):
        raise ValueError("bad signature")

    claims = json.loads(payload)
    if claims.get("exp", 0) < datetime.now(UTC).timestamp():
        raise ValueError("token expired")
    return claims


# --------------------------------------------------------------------------
# Dependencies
# --------------------------------------------------------------------------


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> DemoUser:
    """Resolve bearer token to an active user account. 401 if absent or invalid."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token. Call POST /auth/login or /auth/demo-login first.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = decode_demo_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    try:
        user_id = UUID(claims["sub"])
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token claims.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    # 1. Check seeded demo fixtures (fast path, preserves fixture metadata)
    user = find_demo_user(user_id=user_id)
    if user is not None:
        return user

    # 2. Reconstruct authenticated user from cryptographically verified token claims
    if "role" in claims and "name" in claims:
        try:
            return DemoUser(
                id=user_id,
                name=claims["name"],
                email=claims.get("email"),
                role=UserRole(claims["role"]),
                ward_id=claims.get("ward_id"),
                reliability=float(claims.get("reliability", 0.5)),
                is_simulated=bool(claims.get("is_simulated", False)),
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Malformed user claims.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user."
    )


def require_role(*roles: UserRole) -> Callable[..., DemoUser]:
    """Dependency factory: 403 unless the caller holds one of `roles` (CLAUDE.md §5)."""
    allowed = set(roles)

    def _check(user: DemoUser = Depends(get_current_user)) -> DemoUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Role '{user.role.value}' may not perform this action; "
                    f"requires one of: {', '.join(sorted(r.value for r in allowed))}."
                ),
            )
        return user

    return _check


# Readable aliases used across routers.
citizen_only = require_role(UserRole.citizen)
authority_only = require_role(UserRole.authority)
team_only = require_role(UserRole.team)
authority_or_team = require_role(UserRole.authority, UserRole.team)
citizen_or_authority = require_role(UserRole.citizen, UserRole.authority)
any_role = require_role(UserRole.citizen, UserRole.authority, UserRole.team)


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> DemoUser | None:
    """Optional bearer token authentication for testing interfaces and public previews."""
    if credentials is None:
        return None
    try:
        claims = decode_demo_token(credentials.credentials)
    except ValueError:
        return None

    try:
        user_id = UUID(claims["sub"])
    except (KeyError, ValueError, TypeError):
        return None

    user = find_demo_user(user_id=user_id)
    if user is not None:
        return user

    if "role" in claims and "name" in claims:
        try:
            return DemoUser(
                id=user_id,
                name=claims["name"],
                email=claims.get("email"),
                role=UserRole(claims["role"]),
                ward_id=claims.get("ward_id"),
                reliability=float(claims.get("reliability", 0.5)),
                is_simulated=bool(claims.get("is_simulated", False)),
            )
        except Exception:
            return None
    return None


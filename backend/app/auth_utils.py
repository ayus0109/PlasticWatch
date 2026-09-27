"""Authentication utilities: secure password hashing and verification.

Uses standard library hashlib.pbkdf2_hmac with SHA-256 and a random salt (CLAUDE.md §3:
no new dependencies).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Final

PBKDF2_ITERATIONS: Final[int] = 100_000
DEFAULT_DEMO_PASSWORD: Final[str] = "password123"

# Common demo accounts for quick evaluation/testing
DEMO_ACCOUNT_EMAILS: Final[dict[str, str]] = {
    "citizen@plasticwatch.local": "11111111-1111-4111-8111-111111111111",
    "citizen2@plasticwatch.local": "11111111-1111-4111-8111-111111111112",
    "authority@plasticwatch.local": "22222222-2222-4222-8222-222222222222",
    "team@plasticwatch.local": "33333333-3333-4333-8333-333333333333",
}

DEMO_ROLE_SHORTCUTS: Final[dict[str, str]] = {
    "citizen": "11111111-1111-4111-8111-111111111111",
    "authority": "22222222-2222-4222-8222-222222222222",
    "team": "33333333-3333-4333-8333-333333333333",
}

RESERVED_DEMO_NAMES: Final[set[str]] = {
    "demo citizen a",
    "demo citizen b",
    "demo ward authority",
    "demo cleanup team 1",
    "citizen",
    "authority",
    "team",
}


def hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with 100,000 iterations and 16-byte random salt."""
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${derived.hex()}"


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    """Verify password against stored PBKDF2 hash using constant-time comparison."""
    if not hashed_password or not plain_password:
        return False
    try:
        parts = hashed_password.split("$", 3)
        if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
            return False
        _, iterations_str, salt, target_hash = parts
        iterations = int(iterations_str)
        derived = hashlib.pbkdf2_hmac(
            "sha256",
            plain_password.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        )
        return hmac.compare_digest(derived.hex(), target_hash)
    except Exception:
        return False

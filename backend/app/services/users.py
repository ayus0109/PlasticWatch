"""User management and persistence.

Supports both seeded demo users and newly registered real users.
"""

from __future__ import annotations

import uuid
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.auth_utils import (
    DEFAULT_DEMO_PASSWORD,
    DEMO_ACCOUNT_EMAILS,
    DEMO_AUTHORITY_CENTRE_ID,
    hash_password,
)
from app.deps import demo_users
from app.schemas import DemoUser, UserRole

_UPSERT = text(
    """
    INSERT INTO users (id, name, email, hashed_password, role, ward_id, reliability,
                       is_simulated, centre_id)
    VALUES (:id, :name, :email, :hashed_password, :role,
            (SELECT id FROM wards WHERE id = :ward_id), :reliability, true, :centre_id)
    ON CONFLICT (id) DO UPDATE SET
        centre_id = EXCLUDED.centre_id,
        name = EXCLUDED.name,
        email = COALESCE(EXCLUDED.email, users.email),
        hashed_password = COALESCE(EXCLUDED.hashed_password, users.hashed_password),
        role = EXCLUDED.role,
        ward_id = EXCLUDED.ward_id,
        reliability = EXCLUDED.reliability,
        is_simulated = true
    """
)

# Invert DEMO_ACCOUNT_EMAILS to get ID -> email
_DEMO_ID_TO_EMAIL = {UUID(uid): email for email, uid in DEMO_ACCOUNT_EMAILS.items()}


def ensure_demo_users(conn: Connection) -> int:
    """Upsert every seeded account with default demo email and hashed password."""
    users = demo_users()
    default_demo_hash = hash_password(DEFAULT_DEMO_PASSWORD)
    for u in users:
        demo_email = u.email or _DEMO_ID_TO_EMAIL.get(u.id)
        id_val = str(u.id) if conn.dialect.name == "sqlite" else u.id
        conn.execute(
            _UPSERT,
            {
                "id": id_val,
                "name": u.name,
                "email": demo_email,
                "hashed_password": default_demo_hash,
                "role": u.role.value,
                "ward_id": u.ward_id,
                "reliability": u.reliability,
                "centre_id": DEMO_AUTHORITY_CENTRE_ID if u.role == UserRole.authority else None,
            },
        )
    return len(users)


def get_user_by_email_or_name(conn: Connection, identifier: str) -> dict[str, Any] | None:
    """Find user by email or name (case-insensitive)."""
    clean = identifier.strip().lower()
    row = conn.execute(
        text(
            """
            SELECT id, name, email, hashed_password, role, ward_id, reliability, is_simulated,
                   centre_id
            FROM users
            WHERE lower(email) = :clean OR lower(name) = :clean
            LIMIT 1
            """
        ),
        {"clean": clean},
    ).mappings().first()
    return dict(row) if row else None


def get_user_by_id(conn: Connection, user_id: UUID) -> DemoUser | None:
    """Find user by UUID."""
    id_val = str(user_id) if conn.dialect.name == "sqlite" else user_id
    row = conn.execute(
        text(
            """
            SELECT id, name, email, role, ward_id, reliability, is_simulated
            FROM users WHERE id = :id
            """
        ),
        {"id": id_val},
    ).mappings().first()
    if not row:
        return None
    return DemoUser(
        id=UUID(str(row["id"])),
        name=row["name"],
        email=row["email"],
        role=UserRole(row["role"]),
        ward_id=row["ward_id"],
        reliability=row["reliability"],
        is_simulated=bool(row.get("is_simulated", False)),
    )


def create_user(
    conn: Connection,
    name: str,
    email: str,
    password: str,
    role: UserRole = UserRole.citizen,
    ward_id: int | None = None,
    centre_id: str | None = None,
) -> DemoUser:
    """Create a new registered user in the database."""
    user_id = uuid.uuid4()
    hashed = hash_password(password)
    clean_email = email.strip().lower()
    clean_name = name.strip()
    id_val = str(user_id) if conn.dialect.name == "sqlite" else user_id

    conn.execute(
        text(
            """
            INSERT INTO users (
                id, name, email, hashed_password, role, ward_id, reliability, is_simulated,
                centre_id
            )
            VALUES (:id, :name, :email, :hashed_password, :role,
                    (SELECT id FROM wards WHERE id = :ward_id), 0.5, false, :centre_id)
            """
        ),
        {
            "id": id_val,
            "name": clean_name,
            "email": clean_email,
            "hashed_password": hashed,
            "role": role.value,
            "ward_id": ward_id,
            "centre_id": centre_id,
        },
    )

    return DemoUser(
        id=user_id,
        name=clean_name,
        email=clean_email,
        role=role,
        ward_id=ward_id,
        reliability=0.5,
        is_simulated=False,
    )

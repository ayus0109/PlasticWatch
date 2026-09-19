"""Seeded demo users (CLAUDE.md §8: no real auth — seeded users + a role switcher).

The accounts come from fixtures/demo_users.json, the same source the demo-login
endpoint uses, and are upserted into the users table so reports can reference them.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.deps import demo_users

_UPSERT = text(
    """
    INSERT INTO users (id, name, role, ward_id, reliability)
    VALUES (:id, :name, :role,
            (SELECT id FROM wards WHERE id = :ward_id), :reliability)
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, role = EXCLUDED.role,
        ward_id = EXCLUDED.ward_id, reliability = EXCLUDED.reliability
    """
)


def ensure_demo_users(conn: Connection) -> int:
    """Upsert every seeded account. A ward that is not loaded yet becomes NULL."""
    users = demo_users()
    for u in users:
        conn.execute(
            _UPSERT,
            {
                "id": u.id,
                "name": u.name,
                "role": u.role.value,
                "ward_id": u.ward_id,
                "reliability": u.reliability,
            },
        )
    return len(users)

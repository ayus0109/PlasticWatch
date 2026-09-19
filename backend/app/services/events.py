"""Audit log writer: every hotspot mutation writes a hotspot_events row (SPEC §8).

actor_id is the human who acted, or None for system transitions (create, attach,
reopen, promotion). Only humans ever move a hotspot to verified / false_positive /
resolved — that rule is enforced in services/workflow.py.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import Connection

_INSERT = text(
    """
    INSERT INTO hotspot_events
        (hotspot_id, actor_id, from_status, to_status, reason, note, created_at)
    VALUES (:hotspot_id, :actor_id, :from_status, :to_status, :reason, :note,
            COALESCE(:created_at, now()))
    RETURNING id
    """
)


def record_event(
    conn: Connection,
    hotspot_id: int,
    to_status: str,
    *,
    from_status: str | None = None,
    actor_id: UUID | None = None,
    reason: str | None = None,
    note: str | None = None,
    at: datetime | None = None,
) -> int:
    """Insert one audit row and return its id. `at` defaults to now()."""
    return conn.execute(
        _INSERT,
        {
            "hotspot_id": hotspot_id,
            "actor_id": actor_id,
            "from_status": from_status,
            "to_status": to_status,
            "reason": reason,
            "note": note,
            "created_at": at,
        },
    ).scalar_one()

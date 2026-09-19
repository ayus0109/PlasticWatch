"""Hotspot status machine + human gate (SPEC §13, CLAUDE.md §2.5).

    ai_detected -> needs_verification -> verified -> cleanup_scheduled
                -> cleanup_completed -> resolved
    false_positive from ai_detected / needs_verification / verified (authority)

Every allowed edge names WHO may take it. Only a human authority ever moves a
hotspot to verified, false_positive or resolved — the system can only queue a
hotspot for review (promotion) or reopen a resolved one when waste is reported
again. There are no auto-transitions to a human-only state anywhere.

Every transition writes exactly one hotspot_events row and rescores the hotspot
(verified => Evidence 1.0 "human-verified"). Illegal edge -> 409, wrong actor -> 403.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.schemas import DemoUser, HotspotEvent, HotspotStatus
from app.services.events import record_event
from app.services.hotspot_state import rescore_hotspot

S = HotspotStatus
SYSTEM = "system"  # actor=None: automated transitions
AUTHORITY = "authority"
TEAM = "team"

# (from, to) -> who may take the edge.
ALLOWED_TRANSITIONS: dict[tuple[HotspotStatus, HotspotStatus], frozenset[str]] = {
    (S.ai_detected, S.needs_verification): frozenset({SYSTEM}),  # §12 step 6 promotion
    (S.ai_detected, S.verified): frozenset({AUTHORITY}),
    (S.ai_detected, S.false_positive): frozenset({AUTHORITY}),
    (S.needs_verification, S.verified): frozenset({AUTHORITY}),
    (S.needs_verification, S.false_positive): frozenset({AUTHORITY}),
    (S.verified, S.false_positive): frozenset({AUTHORITY}),
    (S.verified, S.cleanup_scheduled): frozenset({AUTHORITY}),  # a task is created
    (S.cleanup_scheduled, S.cleanup_completed): frozenset({TEAM, AUTHORITY}),
    (S.cleanup_completed, S.resolved): frozenset({AUTHORITY}),  # §14 confirm only
    (S.cleanup_completed, S.cleanup_scheduled): frozenset({AUTHORITY}),  # §14 reject
    (S.resolved, S.ai_detected): frozenset({SYSTEM}),  # §12 reopen on recurrence
}

# CLAUDE.md §2.5 — belt and braces on top of the table above.
HUMAN_ONLY = frozenset({S.verified, S.false_positive, S.resolved})


class WorkflowError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _actor_kind(actor: DemoUser | None) -> str:
    return SYSTEM if actor is None else actor.role.value


def check_transition(
    from_status: HotspotStatus, to_status: HotspotStatus, actor: DemoUser | None
) -> None:
    """Raise WorkflowError(409) for an illegal edge, (403) for the wrong actor."""
    who = _actor_kind(actor)
    if to_status in HUMAN_ONLY and who != AUTHORITY:
        raise WorkflowError(
            403, f"Only an authority can move a hotspot to {to_status.value}."
        )
    allowed = ALLOWED_TRANSITIONS.get((from_status, to_status))
    if allowed is None:
        raise WorkflowError(
            409, f"A hotspot cannot move from {from_status.value} to {to_status.value}."
        )
    if who not in allowed:
        raise WorkflowError(
            403,
            f"{who} may not move a hotspot from {from_status.value} to {to_status.value}.",
        )


_LOCK = text("SELECT status FROM hotspots WHERE id = :id FOR UPDATE")
_SET = text("UPDATE hotspots SET status = :to WHERE id = :id")
_EVENT = text(
    """
    SELECT e.id, e.from_status, e.to_status, e.reason, e.note, e.actor_id,
           u.name AS actor_name, e.created_at
    FROM hotspot_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.id = :id
    """
)


def transition(
    conn: Connection,
    hotspot_id: int,
    to_status: HotspotStatus,
    *,
    actor: DemoUser | None,
    reason: str | None = None,
    note: str | None = None,
    at: datetime | None = None,
    rescore: bool = True,
) -> HotspotEvent:
    """Validate, apply, audit and (by default) rescore one status change."""
    row = conn.execute(_LOCK, {"id": hotspot_id}).first()
    if row is None:
        raise WorkflowError(404, "Hotspot not found.")
    from_status = HotspotStatus(row.status)
    check_transition(from_status, to_status, actor)

    at = at or datetime.now(UTC)
    conn.execute(_SET, {"id": hotspot_id, "to": to_status.value})
    event_id = record_event(
        conn,
        hotspot_id,
        to_status.value,
        from_status=from_status.value,
        actor_id=actor.id if actor else None,
        reason=reason,
        note=note,
        at=at,
    )
    if rescore:
        rescore_hotspot(conn, hotspot_id, at)
    event = conn.execute(_EVENT, {"id": event_id}).mappings().one()
    return HotspotEvent.model_validate(dict(event))

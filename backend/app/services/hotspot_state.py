"""Hotspot state as of a moment: score inputs, rescoring, stored geo-context.

One function, gather_score_inputs(conn, hotspot_id, as_of), serves both paths:
  * write path — rescore_hotspot() after a report attaches (stores the result);
  * read path  — GET /hotspots?as_of=T (the time slider) computes on the fly and
                 NEVER mutates stored rows (Stage 6 constraint).

Everything is measured relative to `as_of`, using only reports with
created_at <= as_of and audit events up to as_of:
  * status            = to_status of the latest event
  * returns C         = resolved -> ai_detected reopen events
  * open since        = the latest create/reopen event; days_open runs to as_of,
                        or to the closing event if the hotspot was closed by then
  * D                 = distinct report days in the SCORE_REC_WINDOW_DAYS before as_of
Duplicates (pHash) never count as evidence; not-detected reports never join a
hotspot. Report days are counted as UTC calendar dates.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.config import get_settings
from app.services import geo_context
from app.services.scoring import (
    HUMAN_VERIFIED_STATUSES,
    ScoreInputs,
    ScoreResult,
    report_severity,
    score_hotspot,
)

CLOSED_STATUSES = frozenset({"resolved", "false_positive"})

_MEMBERS = text(
    """
    SELECT r.severity, r.plastic_count, r.plastic_area_frac, r.report_confidence,
           r.created_at, r.reporter_id, u.reliability
    FROM reports r JOIN users u ON u.id = r.reporter_id
    WHERE r.hotspot_id = :hid AND r.duplicate_of IS NULL
      AND r.ai_status = 'detected' AND r.created_at <= :as_of
    ORDER BY r.created_at DESC, r.id DESC
    """
)

_EVENTS = text(
    """
    SELECT from_status, to_status, created_at FROM hotspot_events
    WHERE hotspot_id = :hid AND created_at <= :as_of
    ORDER BY created_at, id
    """
)

_DISTANCES = text(
    """
    SELECT d_drain_m, d_water_m, d_school_m, d_hospital_m, d_market_m
    FROM hotspots WHERE id = :hid
    """
)


@dataclass(frozen=True)
class HotspotSnapshot:
    inputs: ScoreInputs
    status: str | None  # None = the hotspot did not exist yet at as_of
    report_count: int  # evidence reports (non-duplicate, likely plastic) up to as_of
    first_at: datetime | None
    last_at: datetime | None


def count_reporter_units(rows: list[tuple]) -> int:
    """§12: a reporter's reports collapse into one unit while each is within 24 h of
    that reporter's previous report. rows = (reporter_id, created_at), any order.

    Must agree with the SQL in services/dedupe.py — test_reports_e2e checks both.
    """
    last_seen: dict = {}
    units = 0
    for reporter, at in sorted(rows, key=lambda r: r[1]):
        prev = last_seen.get(reporter)
        if prev is None or at - prev > timedelta(hours=24):
            units += 1
        last_seen[reporter] = at
    return units


def gather_score_inputs(conn: Connection, hotspot_id: int, as_of: datetime) -> HotspotSnapshot:
    s = get_settings()
    members = conn.execute(_MEMBERS, {"hid": hotspot_id, "as_of": as_of}).all()
    events = conn.execute(_EVENTS, {"hid": hotspot_id, "as_of": as_of}).all()
    distances = dict(conn.execute(_DISTANCES, {"hid": hotspot_id}).mappings().one())

    status = events[-1].to_status if events else None
    returns = sum(1 for e in events if e.from_status == "resolved" and e.to_status == "ai_detected")
    opened = [
        e.created_at for e in events
        if e.to_status == "ai_detected" and e.from_status in (None, "resolved")
    ]
    open_since = opened[-1] if opened else (members[-1].created_at if members else as_of)
    end = events[-1].created_at if status in CLOSED_STATUSES else as_of
    days_open = max(0.0, (end - open_since).total_seconds() / 86400)

    window_start = as_of - timedelta(days=s.SCORE_REC_WINDOW_DAYS)
    # UTC calendar days, explicitly: .date() alone would use whatever time zone the DB
    # session returned, so the same data could score differently on another server.
    distinct_days = len(
        {m.created_at.astimezone(UTC).date() for m in members if m.created_at > window_start}
    )

    severities = [
        m.severity if m.severity is not None
        else report_severity(m.plastic_count or 0, m.plastic_area_frac or 0.0)
        for m in members
    ]
    confidences = [m.report_confidence or 0.0 for m in members]
    reliabilities = [m.reliability for m in members]

    inputs = ScoreInputs(
        report_severities=severities,
        report_details=[(m.plastic_count or 0, m.plastic_area_frac or 0.0) for m in members],
        distinct_days=distinct_days,
        returns=returns,
        distances=distances,
        days_open=days_open,
        mean_confidence=sum(confidences) / len(confidences) if confidences else 0.0,
        unique_reporters=count_reporter_units([(m.reporter_id, m.created_at) for m in members]),
        reliability=sum(reliabilities) / len(reliabilities) if reliabilities else 0.0,
        human_verified=status in HUMAN_VERIFIED_STATUSES,
    )
    return HotspotSnapshot(
        inputs=inputs,
        status=status,
        report_count=len(members),
        first_at=members[-1].created_at if members else None,
        last_at=members[0].created_at if members else None,
    )


_STORE_SCORE = text(
    """
    UPDATE hotspots SET
        severity = :S, recurrence = :R, sensitivity = :Se, persistence = :P,
        impact_score = :impact, evidence_score = :evidence,
        priority_band = :band, score_breakdown = CAST(:breakdown AS jsonb),
        scored_at = :at
    WHERE id = :hid
    """
)


def rescore_hotspot(conn: Connection, hotspot_id: int, as_of: datetime) -> ScoreResult:
    """Score as of `as_of` and STORE the result on the hotspot row."""
    snap = gather_score_inputs(conn, hotspot_id, as_of)
    result = score_hotspot(snap.inputs, scored_at=as_of)
    conn.execute(
        _STORE_SCORE,
        {
            "hid": hotspot_id,
            "S": result.severity,
            "R": result.recurrence,
            "Se": result.sensitivity,
            "P": result.persistence,
            "impact": result.impact,
            "evidence": result.evidence,
            "band": result.priority_band.value,
            "breakdown": result.breakdown.model_dump_json(),
            "at": as_of,
        },
    )
    return result


def score_as_of(
    conn: Connection, hotspot_id: int, as_of: datetime
) -> tuple[ScoreResult, HotspotSnapshot] | None:
    """Read-only: (score, snapshot) as of T, or None if the hotspot did not exist
    yet. Never writes."""
    snap = gather_score_inputs(conn, hotspot_id, as_of)
    if snap.status is None or snap.report_count == 0:
        return None
    return score_hotspot(snap.inputs, scored_at=as_of), snap


_STORE_GEO = text(
    """
    UPDATE hotspots SET d_drain_m = :d_drain_m, d_water_m = :d_water_m,
        d_school_m = :d_school_m, d_hospital_m = :d_hospital_m,
        d_market_m = :d_market_m, ward_id = :ward_id
    WHERE id = :hid
    """
)

_CENTRE = text("SELECT ST_X(geom), ST_Y(geom) FROM hotspots WHERE id = :hid")


def refresh_geo_context(conn: Connection, hotspot_id: int) -> None:
    """Compute and STORE distances + ward for the hotspot's current centre.

    Called only at create or after the centre moved materially — never per request.
    """
    lon, lat = conn.execute(_CENTRE, {"hid": hotspot_id}).one()
    point = (float(lon), float(lat))
    conn.execute(
        _STORE_GEO,
        {
            "hid": hotspot_id,
            **geo_context.nearest_distances(conn, point),
            "ward_id": geo_context.ward_for(conn, point),
        },
    )

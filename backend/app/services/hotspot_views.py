"""Read models for hotspots: the GeoJSON map layer and the evidence ledger.

A hotspot is "simulated" when any of its reports is (§7 keeps is_simulated on
reports only), derived here so the map and detail views can badge it.

With `as_of`, scores are recomputed on the fly from reports and audit events up to
that time (services/hotspot_state.py); nothing is written. The marker stays at the
hotspot's current centre — centres are not replayed.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.schemas import (
    EvidenceBand,
    GeoContext,
    HotspotDetail,
    HotspotEvent,
    HotspotFeature,
    HotspotFeatureCollection,
    HotspotProperties,
    HotspotStatus,
    HotspotSummary,
    PointGeometry,
    PriorityBand,
    ScoreBreakdown,
)
from app.services.before_after import latest_for_hotspot
from app.services.hotspot_state import score_as_of
from app.services.report_views import hotspot_reports
from app.services.scoring import evidence_band

_BASE = """
    SELECT h.id, ST_X(h.geom) AS lon, ST_Y(h.geom) AS lat, h.status, h.radius_m,
           h.impact_score, h.priority_band, h.evidence_score, h.report_count,
           h.unique_reporters, h.recurrence_returns, h.ward_id, w.name AS ward_name,
           h.first_reported_at, h.last_reported_at, h.score_breakdown,
           h.d_drain_m, h.d_water_m, h.d_school_m, h.d_hospital_m, h.d_market_m,
           EXISTS (SELECT 1 FROM reports r WHERE r.hotspot_id = h.id AND r.is_simulated)
               AS is_simulated
    FROM hotspots h LEFT JOIN wards w ON w.id = h.ward_id
"""


def _ev_band(score: float | None) -> EvidenceBand | None:
    return evidence_band(score) if score is not None else None


def _feature(row, **overrides) -> HotspotFeature:
    props = {
        "id": row.id,
        "status": row.status,
        "impact_score": row.impact_score,
        "priority_band": row.priority_band,
        "evidence_score": row.evidence_score,
        "evidence_band": _ev_band(row.evidence_score),
        "report_count": row.report_count,
        "unique_reporters": row.unique_reporters,
        "recurrence_returns": row.recurrence_returns,
        "radius_m": row.radius_m,
        "ward_id": row.ward_id,
        "ward_name": row.ward_name,
        "first_reported_at": row.first_reported_at,
        "last_reported_at": row.last_reported_at,
        "is_simulated": row.is_simulated,
    }
    props.update(overrides)
    return HotspotFeature(
        id=row.id,
        geometry=PointGeometry(coordinates=[row.lon, row.lat]),
        properties=HotspotProperties(**props),
    )


def list_features(
    conn: Connection,
    *,
    status: HotspotStatus | None = None,
    band: PriorityBand | None = None,
    ward: int | None = None,
    min_evidence: float | None = None,
    as_of: datetime | None = None,
) -> HotspotFeatureCollection:
    where, params = [], {}
    if ward is not None:
        where.append("h.ward_id = :ward")
        params["ward"] = ward
    if as_of is None:
        if status is not None:
            where.append("h.status = :status")
            params["status"] = status.value
        if band is not None:
            where.append("h.priority_band = :band")
            params["band"] = band.value
        if min_evidence is not None:
            where.append("h.evidence_score >= :min_ev")
            params["min_ev"] = min_evidence
    else:
        where.append("h.first_reported_at <= :as_of")
        params["as_of"] = as_of

    sql = _BASE + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY h.impact_score DESC NULLS LAST, h.id"
    rows = conn.execute(text(sql), params).all()

    if as_of is None:
        return HotspotFeatureCollection(features=[_feature(r) for r in rows])

    features = []
    for r in rows:
        scored = score_as_of(conn, r.id, as_of)
        if scored is None:
            continue
        result, snap = scored
        if status is not None and snap.status != status.value:
            continue
        if band is not None and result.priority_band != band:
            continue
        if min_evidence is not None and result.evidence < min_evidence:
            continue
        features.append(
            _feature(
                r,
                status=snap.status,
                impact_score=result.impact,
                priority_band=result.priority_band,
                evidence_score=result.evidence,
                evidence_band=result.evidence_band,
                report_count=snap.report_count,
                unique_reporters=snap.inputs.unique_reporters,
                recurrence_returns=snap.inputs.returns,
                first_reported_at=snap.first_at,
                last_reported_at=snap.last_at,
            )
        )
    features.sort(key=lambda f: -(f.properties.impact_score or 0))
    return HotspotFeatureCollection(features=features)


def hotspot_summary(conn: Connection, hotspot_id: int) -> HotspotSummary | None:
    row = conn.execute(text(_BASE + " WHERE h.id = :id"), {"id": hotspot_id}).first()
    if row is None:
        return None
    return HotspotSummary(
        id=row.id,
        status=row.status,
        lat=row.lat,
        lon=row.lon,
        radius_m=row.radius_m,
        report_count=row.report_count,
        unique_reporters=row.unique_reporters,
        impact_score=row.impact_score,
        priority_band=row.priority_band,
        evidence_score=row.evidence_score,
        evidence_band=_ev_band(row.evidence_score),
        is_simulated=row.is_simulated,
    )


_EVENTS = text(
    """
    SELECT e.id, e.from_status, e.to_status, e.reason, e.note, e.actor_id,
           u.name AS actor_name, e.created_at
    FROM hotspot_events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.hotspot_id = :id ORDER BY e.created_at, e.id
    """
)


def hotspot_events(conn: Connection, hotspot_id: int) -> list[HotspotEvent]:
    return [
        HotspotEvent.model_validate(dict(e))
        for e in conn.execute(_EVENTS, {"id": hotspot_id}).mappings().all()
    ]


def hotspot_detail(conn: Connection, hotspot_id: int) -> HotspotDetail | None:
    row = conn.execute(text(_BASE + " WHERE h.id = :id"), {"id": hotspot_id}).first()
    if row is None:
        return None
    return HotspotDetail(
        id=row.id,
        status=row.status,
        lat=row.lat,
        lon=row.lon,
        radius_m=row.radius_m,
        ward_id=row.ward_id,
        ward_name=row.ward_name,
        first_reported_at=row.first_reported_at,
        last_reported_at=row.last_reported_at,
        report_count=row.report_count,
        unique_reporters=row.unique_reporters,
        recurrence_returns=row.recurrence_returns,
        geo_context=GeoContext(
            d_drain_m=row.d_drain_m,
            d_water_m=row.d_water_m,
            d_school_m=row.d_school_m,
            d_hospital_m=row.d_hospital_m,
            d_market_m=row.d_market_m,
        ),
        score_breakdown=ScoreBreakdown.model_validate(row.score_breakdown),
        reports=hotspot_reports(conn, hotspot_id),
        events=hotspot_events(conn, hotspot_id),
        before_after=latest_for_hotspot(conn, hotspot_id),
        is_simulated=row.is_simulated,
    )

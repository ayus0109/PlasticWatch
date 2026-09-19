"""Hotspots: map layer, evidence ledger, human verification (SPEC §8, F5-F7).

====================================================================================
FROZEN CONTRACT — do not change without a stage
------------------------------------------------------------------------------------
GET /hotspots returns a GeoJSON FeatureCollection. The frontend map styles every
marker from these properties; renaming or removing one breaks it.

{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "id": 3,
    "geometry": {"type": "Point", "coordinates": [lon, lat]},     # GeoJSON order
    "properties": {
      "id": int,
      "status": HotspotStatus,              # 7 values, SPEC §13
      "impact_score": float | null,         # 0-100, drives priority_band
      "priority_band": PriorityBand | null, # low | medium | high | critical
      "evidence_score": float | null,       # 0-1; weak evidence => dashed ring
      "evidence_band": EvidenceBand | null, # low | moderate | strong
      "report_count": int,
      "unique_reporters": int,
      "recurrence_returns": int,
      "radius_m": float | null,             # hotspot is a circle, never a polygon
      "ward_id": int | null,
      "ward_name": str | null,
      "first_reported_at": ISO datetime | null,
      "last_reported_at": ISO datetime | null,
      "is_simulated": bool                  # true => SIMULATED badge (CLAUDE.md §2.2)
    }
  }]
}

Filters: status, band, ward, min_evidence, as_of (SPEC §8/§10).
There is deliberately no property naming a responsible party (CLAUDE.md §2.3).
====================================================================================

Served from PostGIS. POST /verify goes through services/workflow.py: illegal
transition -> 409, non-authority -> 403, and every change writes an audit event.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.engine import Connection

from app.db import get_conn
from app.deps import authority_only
from app.schemas import (
    DemoUser,
    HotspotDetail,
    HotspotFeatureCollection,
    HotspotStatus,
    PriorityBand,
    VerifyDecision,
    VerifyRequest,
    VerifyResponse,
)
from app.services.hotspot_views import hotspot_detail, list_features
from app.services.workflow import WorkflowError, transition

router = APIRouter(prefix="/hotspots", tags=["hotspots"])

# SPEC §8 decisions -> SPEC §13 statuses. §13 has no "rejected" state; every §13
# reject reason describes a hotspot that should not proceed, so a reject lands in
# false_positive with its reason recorded — the audit row keeps the two apart.
_DECISION_TO_STATUS = {
    VerifyDecision.verify: HotspotStatus.verified,
    VerifyDecision.reject: HotspotStatus.false_positive,
    VerifyDecision.false_positive: HotspotStatus.false_positive,
}


@router.get("", response_model=HotspotFeatureCollection)
def list_hotspots(
    status: HotspotStatus | None = Query(None),
    band: PriorityBand | None = Query(None),
    ward: int | None = Query(None, description="Ward id."),
    min_evidence: float | None = Query(None, ge=0, le=1),
    as_of: datetime | None = Query(
        None,
        description=(
            "Time slider: recompute scores from reports and events up to this time. "
            "Read-only — stored rows are never changed."
        ),
    ),
    _user: DemoUser = Depends(authority_only),
    conn: Connection = Depends(get_conn),
) -> HotspotFeatureCollection:
    """GeoJSON of hotspots, highest Impact first."""
    return list_features(
        conn, status=status, band=band, ward=ward, min_evidence=min_evidence, as_of=as_of
    )


@router.get("/{hotspot_id}", response_model=HotspotDetail)
def get_hotspot(
    hotspot_id: int,
    _user: DemoUser = Depends(authority_only),
    conn: Connection = Depends(get_conn),
) -> HotspotDetail:
    """Score breakdown, member reports and the audit trail (the evidence ledger)."""
    detail = hotspot_detail(conn, hotspot_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Hotspot not found.")
    return detail


@router.post("/{hotspot_id}/verify", response_model=VerifyResponse)
def verify_hotspot(
    hotspot_id: int,
    body: VerifyRequest,
    user: DemoUser = Depends(authority_only),
    conn: Connection = Depends(get_conn),
) -> VerifyResponse:
    """Human verification gate (CLAUDE.md §2.5). Illegal transition -> 409."""
    try:
        event = transition(
            conn,
            hotspot_id,
            _DECISION_TO_STATUS[body.decision],
            actor=user,
            reason=body.reason.value if body.reason else None,
            note=body.note,
        )
    except WorkflowError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return VerifyResponse(
        hotspot_id=hotspot_id,
        from_status=event.from_status,
        to_status=event.to_status,
        event=event,
    )

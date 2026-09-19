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

STAGE 1 STUB: returns fixtures. Scoring, the status machine (409 on illegal
transitions) and the as_of time slider land in Stages 4-7.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.deps import authority_only, load_fixture
from app.schemas import (
    DemoUser,
    HotspotDetail,
    HotspotEvent,
    HotspotFeatureCollection,
    HotspotStatus,
    PriorityBand,
    VerifyDecision,
    VerifyRequest,
    VerifyResponse,
)

router = APIRouter(prefix="/hotspots", tags=["hotspots"])

# The only terminal reachable from a rejection in the SPEC §13 machine. Stage 4 owns
# the real transition table and returns 409 on illegal moves.
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
        None, description="Time slider: score using only reports up to this time. Stub ignores it."
    ),
    _user: DemoUser = Depends(authority_only),
) -> HotspotFeatureCollection:
    """GeoJSON of hotspots. Filters are applied in memory to the fixture for now."""
    collection = HotspotFeatureCollection.model_validate(load_fixture("hotspots"))

    def keep(props) -> bool:
        if status is not None and props.status != status:
            return False
        if band is not None and props.priority_band != band:
            return False
        if ward is not None and props.ward_id != ward:
            return False
        if min_evidence is not None and (props.evidence_score or 0) < min_evidence:
            return False
        return True

    return collection.model_copy(
        update={"features": [f for f in collection.features if keep(f.properties)]}
    )


@router.get("/{hotspot_id}", response_model=HotspotDetail)
def get_hotspot(hotspot_id: int, _user: DemoUser = Depends(authority_only)) -> HotspotDetail:
    """Score breakdown, member reports and the audit trail (the evidence ledger)."""
    detail = HotspotDetail.model_validate(load_fixture("hotspot_detail"))
    return detail.model_copy(update={"id": hotspot_id})


@router.post("/{hotspot_id}/verify", response_model=VerifyResponse)
def verify_hotspot(
    hotspot_id: int,
    body: VerifyRequest,
    user: DemoUser = Depends(authority_only),
) -> VerifyResponse:
    """Human verification gate (CLAUDE.md §2.5). Only an authority reaches this."""
    from_status = HotspotStatus.needs_verification
    to_status = _DECISION_TO_STATUS[body.decision]
    event = HotspotEvent(
        id=0,
        from_status=from_status,
        to_status=to_status,
        reason=body.reason,
        note=body.note,
        actor_id=user.id,
        actor_name=user.name,
        created_at=datetime.now().astimezone(),
    )
    return VerifyResponse(
        hotspot_id=hotspot_id, from_status=from_status, to_status=to_status, event=event
    )

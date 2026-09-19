"""Before/after approval gate (SPEC §8/§14, F10 — P1).

The system computes a verdict but NEVER auto-resolves (CLAUDE.md §2.5). Only an
authority's confirm_resolved closes a hotspot. Absence of detections after cleanup is
not proof of cleanliness (CLAUDE.md §2.6).

STAGE 1 STUB: returns fixtures.
"""

from datetime import datetime

from fastapi import APIRouter, Depends

from app.deps import authority_only, load_fixture
from app.schemas import (
    BeforeAfterRecord,
    DemoUser,
    HotspotEvent,
    HotspotStatus,
    ReviewDecision,
    ReviewRequest,
    ReviewResponse,
)

router = APIRouter(prefix="/before-after", tags=["before-after"])


@router.post("/{ba_id}/review", response_model=ReviewResponse)
def review_before_after(
    ba_id: int,
    body: ReviewRequest,
    user: DemoUser = Depends(authority_only),
) -> ReviewResponse:
    """Authority inspects before/after side by side and confirms or rejects."""
    record = BeforeAfterRecord.model_validate(load_fixture("before_after"))
    record = record.model_copy(
        update={
            "id": ba_id,
            "review_decision": body.decision,
            "reviewed_by": user.id,
            "reviewed_by_name": user.name,
        }
    )
    # Only a human confirm resolves; a reject sends the hotspot back for more cleanup.
    to_status = (
        HotspotStatus.resolved
        if body.decision == ReviewDecision.confirm_resolved
        else HotspotStatus.cleanup_scheduled
    )
    event = HotspotEvent(
        id=0,
        from_status=HotspotStatus.cleanup_completed,
        to_status=to_status,
        note=body.note,
        actor_id=user.id,
        actor_name=user.name,
        created_at=datetime.now().astimezone(),
    )
    return ReviewResponse(
        before_after=record,
        hotspot_id=record.hotspot_id or 0,
        hotspot_status=to_status,
        event=event,
    )

"""Before/after approval gate (SPEC §8/§14, F10 — Stage P1-B).

The system computes a verdict but NEVER auto-resolves (CLAUDE.md §2.5). Only an
authority's confirm_resolved closes a hotspot; reject sends it back for more cleanup.
Absence of detections after cleanup is not proof of cleanliness (CLAUDE.md §2.6).

GET /before-after and GET /before-after/{id} go beyond §8's table: the authority's
side-by-side review screen needs to find and show the records it reviews.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.engine import Connection

from app.db import get_conn
from app.deps import authority_only
from app.schemas import BeforeAfterRecord, DemoUser, ReviewRequest, ReviewResponse
from app.services import before_after as svc
from app.services.tasks import TaskError
from app.services.workflow import WorkflowError

router = APIRouter(prefix="/before-after", tags=["before-after"])


@router.get("", response_model=list[BeforeAfterRecord])
def list_before_after(
    pending: bool = Query(False, description="Only records awaiting an authority's review."),
    _user: DemoUser = Depends(authority_only),
    conn: Connection = Depends(get_conn),
) -> list[BeforeAfterRecord]:
    return svc.list_records(conn, pending=pending)


@router.get("/{ba_id}", response_model=BeforeAfterRecord)
def get_before_after(
    ba_id: int,
    _user: DemoUser = Depends(authority_only),
    conn: Connection = Depends(get_conn),
) -> BeforeAfterRecord:
    record = svc.get_record(conn, ba_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Before/after record not found.")
    return record


@router.post("/{ba_id}/review", response_model=ReviewResponse)
def review_before_after(
    ba_id: int,
    body: ReviewRequest,
    user: DemoUser = Depends(authority_only),
    conn: Connection = Depends(get_conn),
) -> ReviewResponse:
    """Authority inspects before/after side by side and confirms or rejects."""
    try:
        return svc.review(conn, ba_id, body, user)
    except (TaskError, WorkflowError) as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

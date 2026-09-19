"""Cleanup tasks, routing and the team's field flow (SPEC §8, F9 — P1).

STAGE 1 STUB: returns fixtures. Built for real only after the P0 cut line
(CLAUDE.md §8). ORS routing + greedy fallback, the 50 m arrival check and the
before/after pipeline land in P1-A / P1-B.
"""

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import TypeAdapter

from app.deps import authority_only, authority_or_team, load_fixture, team_only
from app.schemas import (
    ArriveRequest,
    ArriveResponse,
    BeforeAfterRecord,
    DemoUser,
    TaskCreateRequest,
    TaskDetail,
    TaskSummary,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])

_task_list = TypeAdapter(list[TaskSummary])


@router.post("", response_model=TaskDetail, status_code=201)
def create_task(body: TaskCreateRequest, _user: DemoUser = Depends(authority_only)) -> TaskDetail:
    """Optimised route over VERIFIED hotspots only. Non-verified ids will be a 409."""
    return TaskDetail.model_validate(load_fixture("task_detail"))


@router.get("", response_model=list[TaskSummary])
def list_tasks(_user: DemoUser = Depends(authority_or_team)) -> list[TaskSummary]:
    return _task_list.validate_python(load_fixture("tasks"))


@router.get("/{task_id}", response_model=TaskDetail)
def get_task(task_id: int, _user: DemoUser = Depends(authority_or_team)) -> TaskDetail:
    detail = TaskDetail.model_validate(load_fixture("task_detail"))
    return detail.model_copy(update={"id": task_id})


@router.post("/{task_id}/stops/{stop_id}/arrive", response_model=ArriveResponse)
def arrive_at_stop(
    task_id: int,
    stop_id: int,
    body: ArriveRequest,
    _user: DemoUser = Depends(team_only),
) -> ArriveResponse:
    """Mark arrival. The real check requires the team within 50 m of the stop."""
    detail = TaskDetail.model_validate(load_fixture("task_detail"))
    stop = next((s for s in detail.stops if s.id == stop_id), detail.stops[0])
    return ArriveResponse(stop=stop, distance_m=12.0, within_range=True)


@router.post("/{task_id}/stops/{stop_id}/after", response_model=BeforeAfterRecord, status_code=201)
def upload_after_photos(
    task_id: int,
    stop_id: int,
    wide: UploadFile = File(..., description="Wide after-photo."),
    close: UploadFile = File(..., description="Close-up after-photo."),
    _user: DemoUser = Depends(team_only),
) -> BeforeAfterRecord:
    """Two after-photos -> before/after record + verdict. Never resolves anything."""
    return BeforeAfterRecord.model_validate(load_fixture("before_after"))

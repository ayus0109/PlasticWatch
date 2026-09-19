"""Cleanup tasks, routing and the team's field flow (SPEC §8, F9 — Stage P1-A).

Tasks accept VERIFIED hotspots only (409 otherwise). Routes come from OpenRouteService
when available, else the greedy fallback. POST .../after is Stage P1-B.
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.engine import Connection

from app.db import get_conn
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
from app.services import tasks as svc
from app.services.workflow import WorkflowError

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _raise(exc: svc.TaskError | WorkflowError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("", response_model=TaskDetail, status_code=201)
def create_task(
    body: TaskCreateRequest,
    user: DemoUser = Depends(authority_only),
    conn: Connection = Depends(get_conn),
) -> TaskDetail:
    """Optimised route over VERIFIED hotspots. Each hotspot becomes cleanup_scheduled."""
    try:
        return svc.create_task(conn, body, user)
    except (svc.TaskError, WorkflowError) as exc:
        _raise(exc)


@router.get("", response_model=list[TaskSummary])
def list_tasks(
    user: DemoUser = Depends(authority_or_team), conn: Connection = Depends(get_conn)
) -> list[TaskSummary]:
    """All tasks for an authority; only its own for a team."""
    return svc.list_tasks(conn, user)


@router.get("/{task_id}", response_model=TaskDetail)
def get_task(
    task_id: int,
    user: DemoUser = Depends(authority_or_team),
    conn: Connection = Depends(get_conn),
) -> TaskDetail:
    detail = svc.task_detail(conn, task_id, user)
    if detail is None:
        raise HTTPException(status_code=404, detail="Task not found.")
    return detail


@router.post("/{task_id}/stops/{stop_id}/arrive", response_model=ArriveResponse)
def arrive_at_stop(
    task_id: int,
    stop_id: int,
    body: ArriveRequest,
    user: DemoUser = Depends(team_only),
    conn: Connection = Depends(get_conn),
) -> ArriveResponse:
    """Mark arrival — recorded only within ARRIVE_RADIUS_M (50 m) of the hotspot."""
    try:
        return svc.arrive(conn, task_id, stop_id, user, body.lon, body.lat)
    except svc.TaskError as exc:
        _raise(exc)


@router.post("/{task_id}/stops/{stop_id}/after", response_model=BeforeAfterRecord, status_code=201)
def upload_after_photos(
    task_id: int,
    stop_id: int,
    wide: UploadFile = File(..., description="Wide after-photo."),
    close: UploadFile = File(..., description="Close-up after-photo."),
    _user: DemoUser = Depends(team_only),
) -> BeforeAfterRecord:
    """Two after-photos -> before/after record + verdict. Never resolves anything.
    STUB until Stage P1-B."""
    return BeforeAfterRecord.model_validate(load_fixture("before_after"))

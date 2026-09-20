"""Citizen reporting (SPEC §8, F1/F2): detect -> dedupe -> context -> score.

POST /detect is P1 and still returns a fixture.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.engine import Connection

from app.db import get_conn
from app.deps import citizen_only, citizen_or_authority, load_fixture
from app.schemas import (
    AiStatus,
    ConfidenceTier,
    DemoUser,
    DetectorOutput,
    DetectPreview,
    LocationSource,
    ReportCreateResponse,
    ReportDetail,
    ReportSummary,
    UserRole,
)
from app.services.confidence import confidence_tier
from app.services.detector import is_stub_mode
from app.services.hotspot_views import hotspot_summary
from app.services.pipeline import PipelineError, PipelineResult, process_report
from app.services.report_views import my_reports, report_detail

router = APIRouter(tags=["reports"])


@router.post("/detect", response_model=DetectPreview)
def detect_preview(
    image: UploadFile = File(..., description="Photo to preview. Not saved."),
    _user: DemoUser = Depends(citizen_only),
) -> DetectPreview:
    """P1: preview likely-plastic detection without saving a report."""
    # Stub: fixed tier for the fixed fixture (P1 — not wired to the detector yet).
    return DetectPreview(
        result=DetectorOutput.model_validate(load_fixture("detector_output")),
        confidence_tier=ConfidenceTier.medium,
        is_simulated=True,
    )


def _message(result: PipelineResult) -> str:
    det = result.detection
    demo = " (Demo mode: detections are simulated.)" if is_stub_mode() else ""
    if det.ai_status == AiStatus.error:
        return "We couldn't analyse this photo right now. It was saved; please try again later."
    if det.ai_status == AiStatus.not_detected:
        return (
            "No likely plastic was found in this photo, so it was not added to a hotspot. "
            "If you can see plastic waste, try a closer photo." + demo
        )
    tier = confidence_tier(det.report_confidence).value
    head = f"Likely plastic detected ({det.plastic_count} items, {tier} confidence)."
    d = result.dedupe
    if d.duplicate_of is not None:
        body = (
            " This photo matches one already reported, so it was attached to that hotspot "
            "but not counted as new evidence."
        )
    elif d.reopened:
        body = " A hotspot here had been cleaned; your report reopened it."
    elif d.merged:
        body = " Your report was added to an existing hotspot nearby."
    else:
        body = " A new hotspot was created."
    if result.promoted:
        body += " It is now waiting for verification by the authority."
    if result.low_accuracy:
        body += f" Location accuracy was low, so reports within {d.radius_m:.0f} m were matched."
    return head + body + demo


@router.post("/reports", response_model=ReportCreateResponse, status_code=201)
def create_report(
    image: UploadFile = File(...),
    lat: float | None = Form(None, description="Omit lat/lon to use the photo's EXIF GPS."),
    lon: float | None = Form(None),
    source: LocationSource | None = Form(None, description="browser | exif | pin"),
    accuracy: float | None = Form(None, description="GPS accuracy in metres."),
    note: str | None = Form(None, max_length=1000),
    reporter_name: str | None = Form(None, max_length=120, description="Citizen reporter name."),
    reporter_phone: str | None = Form(None, max_length=30, description="Citizen contact phone number."),
    user: DemoUser = Depends(citizen_only),
    conn: Connection = Depends(get_conn),
) -> ReportCreateResponse:
    """Submit a photo report. Records that waste appears to be present — not who is
    responsible (CLAUDE.md §2.3).
    """
    try:
        result = process_report(
            conn,
            reporter_id=user.id,
            image_bytes=image.file.read(),
            lat=lat,
            lon=lon,
            source=source,
            accuracy_m=accuracy,
            note=note,
            reporter_name=reporter_name or user.name,
            reporter_phone=reporter_phone,
        )
    except PipelineError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message, **exc.extra},
        ) from exc

    detail, _ = report_detail(conn, result.report_id)
    d = result.dedupe
    return ReportCreateResponse(
        report=detail,
        detections=detail.detections,
        hotspot=hotspot_summary(conn, d.hotspot_id) if d else None,
        merged=bool(d and d.merged),
        duplicate_of=d.duplicate_of if d else None,
        low_accuracy=result.low_accuracy,
        message=_message(result),
    )


@router.get("/reports/mine", response_model=list[ReportSummary])
def mine(
    user: DemoUser = Depends(citizen_only), conn: Connection = Depends(get_conn)
) -> list[ReportSummary]:
    """The caller's own reports and the status of each one's hotspot."""
    return my_reports(conn, user.id)


@router.get("/reports/{report_id}", response_model=ReportDetail)
def get_report(
    report_id: UUID,
    user: DemoUser = Depends(citizen_or_authority),
    conn: Connection = Depends(get_conn),
) -> ReportDetail:
    """A citizen may read their own reports; an authority may read any. Another
    citizen's report is a 404, so report ids can't be probed."""
    found = report_detail(conn, report_id)
    if found is None or (user.role != UserRole.authority and found[1] != user.id):
        raise HTTPException(status_code=404, detail="Report not found.")
    return found[0]

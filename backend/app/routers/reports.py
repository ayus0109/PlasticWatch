"""Citizen reporting (SPEC §8, F1/F2).

STAGE 1 STUB: returns fixtures. The real pipeline — detect -> dedupe -> geo-context ->
score — lands in Stages 3-6. No DB reads here yet.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import TypeAdapter

from app.deps import citizen_only, load_fixture
from app.schemas import (
    ConfidenceTier,
    DemoUser,
    DetectorOutput,
    DetectPreview,
    LocationSource,
    ReportCreateResponse,
    ReportDetail,
    ReportSummary,
)

router = APIRouter(tags=["reports"])

_report_list = TypeAdapter(list[ReportSummary])


@router.post("/detect", response_model=DetectPreview)
def detect_preview(
    image: UploadFile = File(..., description="Photo to preview. Not saved."),
    _user: DemoUser = Depends(citizen_only),
) -> DetectPreview:
    """P1: preview likely-plastic detection without saving a report."""
    # Stub: fixed tier for the fixed fixture. Stage 3 derives the tier from
    # config thresholds and runs the real detector when DETECTOR_MODE=real.
    return DetectPreview(
        result=DetectorOutput.model_validate(load_fixture("detector_output")),
        confidence_tier=ConfidenceTier.medium,
        is_simulated=True,
    )


@router.post("/reports", response_model=ReportCreateResponse, status_code=201)
def create_report(
    image: UploadFile = File(...),
    lat: float = Form(...),
    lon: float = Form(...),
    source: LocationSource = Form(..., description="browser | exif | pin"),
    accuracy: float | None = Form(None, description="GPS accuracy in metres."),
    note: str | None = Form(None),
    _user: DemoUser = Depends(citizen_only),
) -> ReportCreateResponse:
    """Submit a photo report. Records that waste appears to be present — not who is
    responsible (CLAUDE.md §2.3).
    """
    return ReportCreateResponse.model_validate(load_fixture("report_result"))


@router.get("/reports/mine", response_model=list[ReportSummary])
def my_reports(_user: DemoUser = Depends(citizen_only)) -> list[ReportSummary]:
    """The caller's own reports and the status of each one's hotspot."""
    return _report_list.validate_python(load_fixture("reports_mine"))


@router.get("/reports/{report_id}", response_model=ReportDetail)
def get_report(report_id: UUID, _user: DemoUser = Depends(citizen_only)) -> ReportDetail:
    detail = ReportDetail.model_validate(load_fixture("report_detail"))
    return detail.model_copy(update={"id": report_id})

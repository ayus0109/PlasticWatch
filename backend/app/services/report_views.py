"""Read models for reports (GET /reports/mine, GET /reports/{id})."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.config import get_settings
from app.schemas import Detection, ReportDetail, ReportSummary
from app.services.confidence import confidence_tier
from app.services.media import annotated_for

_SELECT = """
    SELECT r.id, r.created_at, r.captured_at, r.image_path, r.note,
           ST_Y(r.geom) AS lat, ST_X(r.geom) AS lon, r.location_source, r.gps_accuracy_m,
           r.ai_status, r.plastic_count, r.plastic_area_frac, r.report_confidence,
           r.hotspot_id, h.status AS hotspot_status, r.duplicate_of, r.is_simulated,
           r.reporter_id,
           COALESCE(r.reporter_name, u.name, 'Citizen') AS reporter_name,
           r.reporter_phone
    FROM reports r
    LEFT JOIN hotspots h ON h.id = r.hotspot_id
    LEFT JOIN users u ON u.id = r.reporter_id
"""


def summary_from_row(row) -> ReportSummary:
    s = get_settings()
    conf = row.report_confidence
    return ReportSummary(
        id=row.id,
        created_at=row.created_at,
        captured_at=row.captured_at,
        image_path=row.image_path,
        annotated_jpg_path=annotated_for(row.image_path),
        note=row.note,
        lat=row.lat,
        lon=row.lon,
        location_source=row.location_source,
        gps_accuracy_m=row.gps_accuracy_m,
        low_accuracy=(
            row.gps_accuracy_m is not None and row.gps_accuracy_m > s.GPS_ACCURACY_WIDEN_M
        ),
        ai_status=row.ai_status,
        plastic_count=row.plastic_count,
        plastic_area_frac=row.plastic_area_frac,
        report_confidence=conf,
        confidence_tier=confidence_tier(conf) if conf is not None else None,
        hotspot_id=row.hotspot_id,
        hotspot_status=row.hotspot_status,
        is_duplicate=row.duplicate_of is not None,
        is_simulated=row.is_simulated,
        reporter_name=getattr(row, "reporter_name", None),
        reporter_phone=getattr(row, "reporter_phone", None),
    )


def my_reports(conn: Connection, reporter_id: UUID) -> list[ReportSummary]:
    rows = conn.execute(
        text(_SELECT + " WHERE r.reporter_id = :rid ORDER BY r.created_at DESC"),
        {"rid": reporter_id},
    ).all()
    return [summary_from_row(r) for r in rows]


def hotspot_reports(conn: Connection, hotspot_id: int) -> list[ReportSummary]:
    rows = conn.execute(
        text(_SELECT + " WHERE r.hotspot_id = :hid ORDER BY r.created_at DESC"),
        {"hid": hotspot_id},
    ).all()
    return [summary_from_row(r) for r in rows]


def report_detail(conn: Connection, report_id: UUID) -> tuple[ReportDetail, UUID] | None:
    """(detail, reporter_id) so the router can enforce ownership."""
    row = conn.execute(text(_SELECT + " WHERE r.id = :id"), {"id": report_id}).first()
    if row is None:
        return None
    dets = conn.execute(
        text(
            "SELECT class_name, confidence, x1, y1, x2, y2, area_frac FROM detections"
            " WHERE report_id = :id ORDER BY confidence DESC, id"
        ),
        {"id": report_id},
    ).mappings().all()
    detail = ReportDetail(
        **summary_from_row(row).model_dump(),
        detections=[Detection.model_validate(dict(d)) for d in dets],
    )
    return detail, row.reporter_id

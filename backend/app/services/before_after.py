"""Before/after closure with false-clean protection (SPEC §14, F10 — Stage P1-B).

    team checked in at the stop (within ARRIVE_RADIUS_M)
      -> 2 after-photos: one wide, one close
      -> per photo: quality gate (blur, brightness), detector, ORB viewpoint vs before
      -> location: form GPS, else the photos' EXIF GPS, else the stop's check-in
      -> reduction_ratio = 1 - after_area / before_area on the WORSE after-photo
      -> verdict likely_cleaned | partial | not_cleaned | inconclusive
      -> hotspot cleanup_scheduled -> cleanup_completed (the team's claim, audited)

A verdict is a SUGGESTION. Nothing here resolves a hotspot: only an authority's
confirm_resolved review does (CLAUDE.md §2.5). A photo with no detections is not
proof the place is clean (§2.6) — which is why a human compares both photos.
Until reviewed, the team may retake the photos (e.g. after an inconclusive verdict).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, ImageOps
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.config import get_settings
from app.schemas import (
    BeforeAfterRecord,
    DemoUser,
    DetectorOutput,
    HotspotStatus,
    ReviewDecision,
    ReviewRequest,
    ReviewResponse,
    UserRole,
    Verdict,
)
from app.services import detector, quality, viewpoint
from app.services.events import record_event
from app.services.media import annotated_for, to_fs, to_public, upload_root
from app.services.pipeline import PipelineError, decode_photo, exif_gps
from app.services.routing import haversine_m
from app.services.tasks import TaskError
from app.services.workflow import transition

PHOTO_KINDS = ("wide", "close")
EPS = 1e-9  # half-open bands, like scoring: 0.8 - float noise still counts as 0.8

VERDICT_LABEL = {
    Verdict.likely_cleaned: "likely cleaned",
    Verdict.partial: "partial",
    Verdict.not_cleaned: "not cleaned",
    Verdict.inconclusive: "inconclusive",
}


# ---------------------------------------------------------------------------
# The verdict — a pure function of the checks (SPEC §14)
# ---------------------------------------------------------------------------


def decide_verdict(
    *,
    quality_ok: bool,
    location_ok: bool | None,
    viewpoint_ok: bool,
    reduction: float | None,
    after_count: int,
) -> tuple[Verdict, list[str]]:
    """(verdict, plain-language reasons). Failed checks always win: inconclusive.

    `location_ok=None` means unverified — no GPS came with the photos and nobody
    checked in on site (an authority uploading a crew's photos). That is not a failed
    check, so it does not force inconclusive; the viewpoint match still has to place
    the photos at the hotspot, and the caution is recorded either way.
    """
    s = get_settings()
    reasons = []
    if not quality_ok:
        reasons.append("An after-photo is too blurry, dark or bright to assess.")
    if location_ok is False:
        reasons.append("The after-photos were not taken at the hotspot.")
    if not viewpoint_ok:
        reasons.append("Neither after-photo matches the before photo's viewpoint.")
    if reduction is None:
        reasons.append("The before photo has no likely-plastic area to compare against.")
    if reasons:
        return Verdict.inconclusive, reasons

    caution = (
        []
        if location_ok
        else ["Location unverified: no GPS with the photos and no on-site check-in."]
    )
    change = (
        f"likely-plastic area down {reduction:.0%}"
        if reduction >= 0
        else f"likely-plastic area UP {-reduction:.0%}"
    )
    left = f"{after_count} likely-plastic detection(s) remain"
    if reduction + EPS >= s.VERDICT_CLEANED_MIN_REDUCTION:
        if after_count <= s.VERDICT_CLEANED_MAX_DETECTIONS:
            return Verdict.likely_cleaned, [f"{change.capitalize()}; {left}.", *caution]
        return Verdict.partial, [
            f"{change.capitalize()}, but {left} "
            f"(likely cleaned needs at most {s.VERDICT_CLEANED_MAX_DETECTIONS}).",
            *caution,
        ]
    if reduction + EPS >= s.VERDICT_PARTIAL_MIN_REDUCTION:
        return Verdict.partial, [f"{change.capitalize()}; {left}.", *caution]
    worse = f"Only {change}; {left}." if reduction >= 0 else f"{change}."
    return Verdict.not_cleaned, [worse, *caution]


def reduction_ratio(before_area: float | None, after_area: float) -> float | None:
    """1 - after/before. None when there is no before area to compare against."""
    if not before_area or before_area <= 0:
        return None
    return round(1 - after_area / before_area, 4)


# ---------------------------------------------------------------------------
# Reading records
# ---------------------------------------------------------------------------

_RECORD = """
    SELECT b.id, b.task_stop_id, s.task_id, s.hotspot_id, h.status AS hotspot_status,
           b.before_report_id, r.image_path AS before_image_path,
           b.after_image_paths, b.before_count, b.before_area, b.after_count, b.after_area,
           b.reduction_ratio, b.viewpoint_match, b.quality_flags, b.verdict,
           b.review_decision, b.reviewed_by, u.name AS reviewed_by_name, b.created_at,
           COALESCE(r.is_simulated, false) AS before_simulated
    FROM before_after b
    LEFT JOIN task_stops s ON s.id = b.task_stop_id
    LEFT JOIN hotspots h ON h.id = s.hotspot_id
    LEFT JOIN reports r ON r.id = b.before_report_id
    LEFT JOIN users u ON u.id = b.reviewed_by
"""


def _record(row) -> BeforeAfterRecord:
    after = list(row.after_image_paths or [])
    flags = dict(row.quality_flags or {})
    before_img = row.before_image_path
    return BeforeAfterRecord(
        id=row.id,
        task_stop_id=row.task_stop_id,
        task_id=row.task_id,
        hotspot_id=row.hotspot_id,
        hotspot_status=row.hotspot_status,
        before_report_id=row.before_report_id,
        before_image_path=row.before_image_path,
        before_annotated_path=annotated_for(before_img) if before_img else None,
        after_image_paths=after,
        after_annotated_paths=[annotated_for(p) for p in after],
        before_count=row.before_count,
        before_area=row.before_area,
        after_count=row.after_count,
        after_area=row.after_area,
        reduction_ratio=row.reduction_ratio,
        viewpoint_match=row.viewpoint_match,
        quality_flags=flags,
        verdict=row.verdict,
        review_decision=row.review_decision,
        reviewed_by=row.reviewed_by,
        reviewed_by_name=row.reviewed_by_name,
        created_at=row.created_at,
        is_simulated=bool(row.before_simulated) or bool(flags.get("simulated_detection")),
    )


def get_record(conn: Connection, ba_id: int) -> BeforeAfterRecord | None:
    row = conn.execute(text(_RECORD + " WHERE b.id = :id"), {"id": ba_id}).first()
    return _record(row) if row else None


def list_records(conn: Connection, pending: bool = False) -> list[BeforeAfterRecord]:
    """All records, newest first; `pending` = awaiting an authority's review."""
    sql = _RECORD
    if pending:
        sql += " WHERE b.review_decision IS NULL AND h.status = 'cleanup_completed'"
    rows = conn.execute(text(sql + " ORDER BY b.created_at DESC, b.id DESC LIMIT 200")).all()
    return [_record(r) for r in rows]


def latest_for_hotspot(conn: Connection, hotspot_id: int) -> BeforeAfterRecord | None:
    row = conn.execute(
        text(_RECORD + " WHERE s.hotspot_id = :h ORDER BY b.created_at DESC, b.id DESC LIMIT 1"),
        {"h": hotspot_id},
    ).first()
    return _record(row) if row else None


# ---------------------------------------------------------------------------
# Submitting after-photos (the team)
# ---------------------------------------------------------------------------

_STOP = text(
    """
    SELECT s.id, s.task_id, s.hotspot_id, s.arrived_at, s.completed_at, t.assigned_team,
           h.status AS hotspot_status, ST_X(h.geom) AS lon, ST_Y(h.geom) AS lat
    FROM task_stops s
    JOIN cleanup_tasks t ON t.id = s.task_id
    JOIN hotspots h ON h.id = s.hotspot_id
    WHERE s.id = :sid AND s.task_id = :tid
    FOR UPDATE OF s
    """
)

_BEFORE = text(
    """
    SELECT id, image_path, plastic_count, plastic_area_frac
    FROM reports
    WHERE hotspot_id = :h AND duplicate_of IS NULL AND ai_status = 'detected'
      AND created_at <= :at
    ORDER BY created_at DESC LIMIT 1
    """
)


@dataclass(frozen=True)
class _Photo:
    kind: str
    public_path: str
    fs_path: Path
    quality: dict
    gps: tuple[float, float] | None
    det: DetectorOutput
    view: viewpoint.ViewpointResult | None


def _store(img: Image.Image, stop_id: int, kind: str) -> tuple[str, Path]:
    """EXIF-rotated, metadata-free JPEG under uploads/after/. Unique per upload."""
    out = upload_root() / "after" / f"{stop_id}-{kind}-{uuid.uuid4().hex[:10]}.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    ImageOps.exif_transpose(img).convert("RGB").save(out, "JPEG", quality=90)
    return to_public(out), out


def _analyse(
    kind: str, data: bytes, stop_id: int, before_fs: Path | None, known: list[dict] | None
) -> _Photo:
    img = decode_photo(data)
    gps = exif_gps(img)  # read BEFORE the stored copy drops the metadata
    _, flags = quality.is_low_quality(img)
    public, fs = _store(img, stop_id, kind)
    det = (
        detector.run_detection(fs)
        if known is None
        else detector.from_known(fs, known, simulated=True)
    )
    view = viewpoint.match(before_fs, fs) if before_fs is not None and before_fs.is_file() else None
    return _Photo(kind, public, fs, flags, gps, det, view)


def submit_after(
    conn: Connection,
    task_id: int,
    stop_id: int,
    photos: dict[str, bytes],
    actor: DemoUser,
    *,
    lat: float | None = None,
    lon: float | None = None,
    at: datetime | None = None,
    known_detections: dict[str, list[dict]] | None = None,
) -> BeforeAfterRecord:
    """Analyse two after-photos and record the team's cleanup claim.

    `known_detections` ({"wide": [...], "close": [...]}) is for the demo seed only:
    boxes of synthetic scenes, used instead of the detector (simulated data).
    """
    s = get_settings()
    at = at or datetime.now(UTC)
    if set(photos) != set(PHOTO_KINDS):
        raise TaskError(422, "Upload exactly two after-photos: one wide and one close-up.")

    stop = conn.execute(_STOP, {"sid": stop_id, "tid": task_id}).first()
    if stop is None or (actor.role == UserRole.team and stop.assigned_team != actor.id):
        raise TaskError(404, "Stop not found on this task.")
    if stop.arrived_at is None and actor.role == UserRole.team:
        raise TaskError(
            409,
            f"Check in within {s.ARRIVE_RADIUS_M:.0f} m of the stop before uploading "
            "after-photos.",
        )

    existing = conn.execute(
        text("SELECT id, review_decision FROM before_after WHERE task_stop_id = :sid"),
        {"sid": stop_id},
    ).first()
    status = HotspotStatus(stop.hotspot_status)
    first_claim = status == HotspotStatus.cleanup_scheduled and stop.completed_at is None
    retake = (
        status == HotspotStatus.cleanup_completed
        and existing is not None
        and existing.review_decision is None
    )
    if not (first_claim or retake):
        raise TaskError(
            409,
            f"After-photos are not expected for this stop (hotspot is {status.value}"
            + (", already reviewed" if existing and existing.review_decision else "")
            + ").",
        )

    before = conn.execute(_BEFORE, {"h": stop.hotspot_id, "at": at}).first()
    before_fs = to_fs(before.image_path) if before else None
    try:
        shots = [
            _analyse(
                k, photos[k], stop_id, before_fs,
                None if known_detections is None else known_detections.get(k, []),
            )
            for k in PHOTO_KINDS
        ]
    except PipelineError as exc:
        raise TaskError(exc.status_code, exc.message) from exc

    # Location: GPS at upload, else a photo's EXIF, else the on-site check-in. With
    # none of those (an authority uploading a crew's photos) it stays UNVERIFIED — never
    # silently "ok" (CLAUDE.md §2.6: we do not claim evidence we do not have).
    fix, source = None, "check_in" if stop.arrived_at is not None else "unverified"
    if lat is not None and lon is not None:
        fix, source = (lat, lon), "gps"
    else:
        exif = next((p.gps for p in shots if p.gps), None)
        if exif:
            fix, source = exif, "exif"
    distance = haversine_m((fix[1], fix[0]), (stop.lon, stop.lat)) if fix else None
    location_ok: bool | None = (
        (distance <= s.ARRIVE_RADIUS_M) if distance is not None else (source == "check_in" or None)
    )

    quality_ok = all(p.quality["blur_ok"] and p.quality["brightness_ok"] for p in shots)
    views = [p.view for p in shots if p.view is not None]
    best_view = max(views, key=lambda v: (v.score, v.inliers), default=None)
    viewpoint_ok = best_view is not None and best_view.ok

    # The WORSE after-photo decides: most likely-plastic area, then most items.
    worse = max(shots, key=lambda p: (p.det.plastic_area_frac, p.det.plastic_count))
    before_area = float(before.plastic_area_frac) if before else None
    before_count = int(before.plastic_count) if before else None
    reduction = reduction_ratio(before_area, worse.det.plastic_area_frac)
    verdict, reasons = decide_verdict(
        quality_ok=quality_ok,
        location_ok=location_ok,
        viewpoint_ok=viewpoint_ok,
        reduction=reduction,
        after_count=worse.det.plastic_count,
    )

    flags = {
        "blur_ok": all(p.quality["blur_ok"] for p in shots),
        "brightness_ok": all(p.quality["brightness_ok"] for p in shots),
        "location_ok": location_ok,
        "viewpoint_ok": viewpoint_ok,
        "location_source": source,
        "location_distance_m": round(distance, 1) if distance is not None else None,
        "worse_photo": worse.kind,
        "count_change": (
            None if before_count is None else worse.det.plastic_count - before_count
        ),
        "reasons": reasons,
        "photos": {
            p.kind: {
                **p.quality,
                "plastic_count": p.det.plastic_count,
                "plastic_area_frac": p.det.plastic_area_frac,
                "ai_status": p.det.ai_status.value,
                "viewpoint_match": p.view.score if p.view else None,
                "viewpoint_inliers": p.view.inliers if p.view else None,
            }
            for p in shots
        },
        "simulated_detection": known_detections is not None or detector.is_stub_mode(),
        "note": "A verdict is a suggestion. No detections is not proof of a clean site.",
    }
    values = {
        "sid": stop_id,
        "rid": before.id if before else None,
        "paths": [p.public_path for p in shots],
        "bc": before_count,
        "ba": before_area,
        "ac": worse.det.plastic_count,
        "aa": worse.det.plastic_area_frac,
        "rr": reduction,
        "flags": json.dumps(flags),
        "vm": best_view.score if best_view else None,
        "verdict": verdict.value,
        "at": at,
    }
    columns = """before_report_id = :rid, after_image_paths = :paths, before_count = :bc,
                 before_area = :ba, after_count = :ac, after_area = :aa, reduction_ratio = :rr,
                 quality_flags = CAST(:flags AS jsonb), viewpoint_match = :vm, verdict = :verdict,
                 reviewed_by = NULL, review_decision = NULL, created_at = :at"""
    if existing is not None:  # one record per stop (SPEC §7): a retake replaces it
        conn.execute(
            text(f"UPDATE before_after SET {columns} WHERE id = :id"), {**values, "id": existing.id}
        )
        ba_id = existing.id
    else:
        ba_id = conn.execute(
            text(
                """
                INSERT INTO before_after (task_stop_id, before_report_id, after_image_paths,
                    before_count, before_area, after_count, after_area, reduction_ratio,
                    quality_flags, viewpoint_match, verdict, created_at)
                VALUES (:sid, :rid, :paths, :bc, :ba, :ac, :aa, :rr, CAST(:flags AS jsonb),
                        :vm, :verdict, :at)
                RETURNING id
                """
            ),
            values,
        ).scalar_one()

    label = VERDICT_LABEL[verdict]
    if first_claim:
        conn.execute(
            text("UPDATE task_stops SET completed_at = :at WHERE id = :id"),
            {"at": at, "id": stop_id},
        )
        conn.execute(
            text(
                """
                UPDATE cleanup_tasks SET status = CASE
                    WHEN NOT EXISTS (SELECT 1 FROM task_stops WHERE task_id = :t
                                     AND completed_at IS NULL) THEN 'done'
                    ELSE 'in_progress' END
                WHERE id = :t
                """
            ),
            {"t": task_id},
        )
        transition(
            conn, stop.hotspot_id, HotspotStatus.cleanup_completed, actor=actor, at=at,
            note=f"After-photos uploaded (before/after #{ba_id}). Suggested verdict: {label} "
            "— awaiting authority review.",
        )
    else:
        record_event(
            conn, stop.hotspot_id, HotspotStatus.cleanup_completed.value,
            from_status=HotspotStatus.cleanup_completed.value, actor_id=actor.id, at=at,
            note=f"After-photos retaken (before/after #{ba_id}). Suggested verdict: {label}.",
        )
    return get_record(conn, ba_id)


# ---------------------------------------------------------------------------
# The human gate (the authority)
# ---------------------------------------------------------------------------


def review(
    conn: Connection,
    ba_id: int,
    body: ReviewRequest,
    actor: DemoUser,
    *,
    at: datetime | None = None,
) -> ReviewResponse:
    """confirm_resolved -> resolved (the ONLY way to resolve); reject -> redo cleanup."""
    at = at or datetime.now(UTC)
    row = conn.execute(
        text(
            """
            SELECT b.id, b.verdict, b.review_decision, s.id AS stop_id, s.task_id,
                   s.hotspot_id, h.status
            FROM before_after b
            JOIN task_stops s ON s.id = b.task_stop_id
            JOIN hotspots h ON h.id = s.hotspot_id
            WHERE b.id = :id
            FOR UPDATE OF b
            """
        ),
        {"id": ba_id},
    ).first()
    if row is None:
        raise TaskError(404, "Before/after record not found.")
    if row.review_decision is not None:
        raise TaskError(409, "This before/after has already been reviewed.")
    if row.status != HotspotStatus.cleanup_completed.value:
        raise TaskError(409, f"Nothing awaits review: the hotspot is {row.status}.")

    verdict = Verdict(row.verdict) if row.verdict else None
    note = (body.note or "").strip() or None
    label = VERDICT_LABEL.get(verdict, "none")
    if body.decision == ReviewDecision.confirm_resolved:
        if verdict != Verdict.likely_cleaned and note is None:
            raise TaskError(
                422,
                f"The suggested verdict is '{label}'. Add a note explaining why you are "
                "confirming the cleanup anyway.",
            )
        to_status = HotspotStatus.resolved
        text_note = f"Confirmed resolved from before/after #{ba_id} (suggested verdict: {label})."
    else:
        to_status = HotspotStatus.cleanup_scheduled
        text_note = f"Before/after #{ba_id} rejected (suggested verdict: {label}); cleanup to redo."

    event = transition(
        conn, row.hotspot_id, to_status, actor=actor, at=at,
        note=text_note + (f" {note}" if note else ""),
    )
    conn.execute(
        text("UPDATE before_after SET reviewed_by = :by, review_decision = :d WHERE id = :id"),
        {"by": actor.id, "d": body.decision.value, "id": ba_id},
    )
    if to_status == HotspotStatus.cleanup_scheduled:
        # Back to the team: they must return (check in again) and re-photograph.
        conn.execute(
            text("UPDATE task_stops SET arrived_at = NULL, completed_at = NULL WHERE id = :s"),
            {"s": row.stop_id},
        )
        conn.execute(
            text("UPDATE cleanup_tasks SET status = 'in_progress' WHERE id = :t"),
            {"t": row.task_id},
        )
    return ReviewResponse(
        before_after=get_record(conn, ba_id),
        hotspot_id=row.hotspot_id,
        hotspot_status=to_status,
        event=event,
    )

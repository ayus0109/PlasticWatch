"""POST /reports pipeline: save -> quality -> detect -> persist -> dedupe -> geo -> score.

    1. decode + re-encode the photo as JPEG (EXIF orientation applied; metadata such
       as embedded GPS is stripped from the stored copy)
    2. location: form lat/lon, else the photo's EXIF GPS, else ask for a map pin
    3. quality gate (blur / brightness) — a failing photo is rejected BEFORE
       anything is stored, so the citizen can retake it on the spot
    4. detector (stub or real) -> the frozen SPEC §6 output
    5. persist the report + its detections
    6. not detected -> the report is recorded but joins no hotspot
       detected     -> dedupe (§12 steps 1-4) under a transaction-scoped lock
    7. geo-context computed ONLY when the hotspot is new or its centre moved
    8. rescore (§11) and, if §12 step 6 allows, promote to needs_verification —
       a queue for a human, never verification itself

Everything runs in the caller's transaction. `created_at` is injectable so the demo
seed can replay a 45-day history through exactly this code path.
"""

from __future__ import annotations

import io
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.config import get_settings
from app.schemas import AiStatus, DetectorOutput, HotspotStatus, LocationSource
from app.services import detector, quality
from app.services.dedupe import DedupeResult, ReportInput, assign_report, image_phash
from app.services.hotspot_state import refresh_geo_context, rescore_hotspot
from app.services.media import to_public, upload_root
from app.services.scoring import report_severity, should_promote
from app.services.workflow import transition

# Serialises dedupe so two simultaneous nearby reports cannot both create a hotspot.
_DEDUPE_LOCK_KEY = 0x504C5754  # "PLWT"


class PipelineError(Exception):
    """A report the citizen must fix (bad photo, no location). Maps to HTTP 4xx."""

    def __init__(self, status_code: int, code: str, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra or {}


@dataclass(frozen=True)
class PipelineResult:
    report_id: UUID
    detection: DetectorOutput
    dedupe: DedupeResult | None  # None when no likely plastic was found
    low_accuracy: bool
    promoted: bool


# ---------------------------------------------------------------------------
# Photo handling
# ---------------------------------------------------------------------------


def decode_photo(image_bytes: bytes) -> Image.Image:
    max_bytes = get_settings().MAX_UPLOAD_MB * 1024 * 1024
    if len(image_bytes) > max_bytes:
        raise PipelineError(
            413, "too_large", f"Photo is larger than {get_settings().MAX_UPLOAD_MB:.0f} MB."
        )
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise PipelineError(422, "not_an_image", "That file is not a readable photo.") from exc
    return img


def _dms_to_deg(dms, ref) -> float:
    d, m, s = (float(x) for x in dms)
    deg = d + m / 60 + s / 3600
    return -deg if ref in ("S", "W") else deg


def exif_gps(img: Image.Image) -> tuple[float, float] | None:
    """(lat, lon) from the photo's EXIF GPS block, if present and plausible."""
    try:
        gps = img.getexif().get_ifd(0x8825)
        lat = _dms_to_deg(gps[2], gps[1])
        lon = _dms_to_deg(gps[4], gps[3])
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    return lat, lon


def _store_photo(img: Image.Image, report_id: UUID) -> str:
    """Save an EXIF-rotated, metadata-free JPEG. Returns its public path."""
    clean = ImageOps.exif_transpose(img).convert("RGB")
    out = upload_root() / "reports" / f"{report_id}.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    clean.save(out, "JPEG", quality=90)
    return to_public(out)


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

_INSERT_REPORT = text(
    """
    INSERT INTO reports (id, reporter_id, image_path, image_phash, geom, gps_accuracy_m,
                         location_source, created_at, note, reporter_name, reporter_phone,
                         ai_status, report_confidence,
                         plastic_count, plastic_area_frac, severity, is_simulated)
    VALUES (:id, :reporter, :image_path, :phash, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
            :accuracy, :source, :created_at, :note, :reporter_name, :reporter_phone,
            :ai_status, :confidence,
            :count, :area, :severity, :simulated)
    """
)

_INSERT_DETECTION = text(
    """
    INSERT INTO detections (report_id, class_name, confidence, x1, y1, x2, y2, area_frac)
    VALUES (:rid, :class_name, :confidence, :x1, :y1, :x2, :y2, :area_frac)
    """
)

_HOTSPOT_STATE = text("SELECT status, unique_reporters FROM hotspots WHERE id = :hid")


def process_report(
    conn: Connection,
    *,
    reporter_id: UUID,
    image_bytes: bytes,
    lat: float | None,
    lon: float | None,
    source: LocationSource | None,
    accuracy_m: float | None = None,
    note: str | None = None,
    reporter_name: str | None = None,
    reporter_phone: str | None = None,
    created_at: datetime | None = None,
    simulated_location: bool = False,
    known_detections: list[dict] | None = None,
) -> PipelineResult:
    """Run one report through the whole pipeline.

    `known_detections` is for the demo seed only: boxes of a synthetic scene whose
    objects we drew ourselves, used instead of the detector. They are simulated
    data and the report is flagged so.
    """
    s = get_settings()
    created_at = created_at or datetime.now(UTC)
    img = decode_photo(image_bytes)

    # Location: browser GPS / pin from the form, else EXIF, else ask for a pin.
    if lat is None or lon is None:
        gps = exif_gps(img)
        if gps is None:
            raise PipelineError(
                422, "no_location",
                "We couldn't find a location for this photo. Drop a pin on the map.",
            )
        lat, lon, source = gps[0], gps[1], LocationSource.exif
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise PipelineError(422, "bad_location", "Latitude/longitude out of range.")
    source = source or LocationSource.pin

    # Quality gate — before anything is stored.
    low, flags = quality.is_low_quality(img)
    if low:
        why = "too blurry" if not flags["blur_ok"] else "too dark or too bright"
        raise PipelineError(
            422, "low_quality", f"The photo is {why} to assess. Please retake it.", flags
        )

    report_id = uuid.uuid4()
    image_path = _store_photo(img, report_id)
    stored = upload_root() / "reports" / f"{report_id}.jpg"
    phash = image_phash(stored)
    det = (
        detector.run_detection(stored)
        if known_detections is None
        else detector.from_known(stored, known_detections, simulated=True)
    )

    low_accuracy = accuracy_m is not None and accuracy_m > s.GPS_ACCURACY_WIDEN_M
    conn.execute(
        _INSERT_REPORT,
        {
            "id": report_id, "reporter": reporter_id, "image_path": image_path,
            "phash": phash, "lon": lon, "lat": lat, "accuracy": accuracy_m,
            "source": source.value, "created_at": created_at, "note": note,
            "reporter_name": reporter_name, "reporter_phone": reporter_phone,
            "ai_status": det.ai_status.value, "confidence": det.report_confidence,
            "count": det.plastic_count, "area": det.plastic_area_frac,
            "severity": report_severity(det.plastic_count, det.plastic_area_frac),
            # Fabricated geotag OR fabricated detection: either is simulated data (§2.2).
            "simulated": (
                simulated_location or known_detections is not None or detector.is_stub_mode()
            ),
        },
    )
    for d in det.detections:
        conn.execute(_INSERT_DETECTION, {"rid": report_id, **d.model_dump(mode="json")})

    if det.ai_status != AiStatus.detected:
        return PipelineResult(report_id, det, None, low_accuracy, promoted=False)

    conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _DEDUPE_LOCK_KEY})
    result = assign_report(
        conn,
        ReportInput(
            id=report_id, reporter_id=reporter_id, lon=lon, lat=lat, created_at=created_at,
            gps_accuracy_m=accuracy_m, image_phash=phash,
        ),
    )

    if result.created or result.centroid_moved_m > s.GEO_RECOMPUTE_MOVE_M:
        refresh_geo_context(conn, result.hotspot_id)

    score = rescore_hotspot(conn, result.hotspot_id, created_at)

    status, reporters = conn.execute(_HOTSPOT_STATE, {"hid": result.hotspot_id}).one()
    promoted = should_promote(status, reporters, score.evidence)
    if promoted:
        why = (
            f"{reporters} independent reporters"
            if reporters >= s.PROMOTE_MIN_REPORTERS
            else f"evidence {score.evidence:.2f}"
        )
        transition(  # system edge: queues for a human, never verifies (workflow.py)
            conn, result.hotspot_id, HotspotStatus.needs_verification, actor=None,
            at=created_at, note=f"Queued for human verification ({why}).",
        )

    return PipelineResult(report_id, det, result, low_accuracy, promoted)

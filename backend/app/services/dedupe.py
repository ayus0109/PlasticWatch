"""Duplicate merge into hotspots — SPEC §12 steps 1-4, implemented verbatim.

    1. pHash within Hamming <= PHASH_HAMMING_MAX of an existing report image:
       set duplicate_of, attach to that report's hotspot, NOT new unique evidence.
    2. radius = DEDUPE_RADIUS_M, widened up to DEDUPE_RADIUS_MAX_M when
       gps_accuracy_m > GPS_ACCURACY_WIDEN_M (flagged "low location accuracy").
    3. candidates = hotspots (status != false_positive) within radius; a Resolved
       hotspot counts only if resolved within REOPEN_WINDOW_DAYS.
    4. nearest candidate wins -> attach, recompute centroid + radius; if it was
       Resolved, reopen it and recurrence_returns += 1. Otherwise create a new
       hotspot (status ai_detected).

Steps 5-6 (rescore, promote) need scoring and live in the Stage 6 pipeline.

Decisions where §12 is silent:
  * "Now" is the report's created_at, not the wall clock, so replaying history
    (the 45-day demo seed) behaves exactly like live reports.
  * A pHash duplicate never reopens a Resolved hotspot: a resubmitted old photo
    is not evidence that the waste came back.
  * Duplicates are excluded from the hotspot's geometry — step 1 attaches them
    regardless of distance, so their location must not drag the centroid.
  * "Same reporter within 24 h counts once toward unique_reporters" is applied
    literally: a reporter's non-duplicate reports collapse into one unit when each
    is within 24 h of that reporter's previous report.
  * resolved_at is not a §7 column; the reopen window reads the time of the last
    to_status='resolved' event from the audit log.

Pure logic over a DB connection: no HTTP, no scoring.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import UUID

import imagehash
from PIL import Image, ImageOps
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.config import get_settings
from app.services.events import record_event


@dataclass(frozen=True)
class ReportInput:
    """An already-inserted report row (hotspot_id still NULL)."""

    id: UUID
    reporter_id: UUID
    lon: float
    lat: float
    created_at: datetime
    gps_accuracy_m: float | None = None
    image_phash: str | None = None


@dataclass(frozen=True)
class DedupeResult:
    hotspot_id: int
    merged: bool  # joined an existing hotspot (incl. as a pHash duplicate)
    created: bool  # a new hotspot was created
    reopened: bool  # a Resolved hotspot was reopened by this report
    duplicate_of: UUID | None  # set when pHash matched an existing image
    low_accuracy: bool  # GPS accuracy forced the merge radius to widen
    radius_m: float  # merge radius actually used
    centroid_moved_m: float  # how far the hotspot centre moved (0 for new)


def image_phash(path: str | Path) -> str:
    """64-bit perceptual hash as 16 hex chars (EXIF orientation applied first)."""
    with Image.open(path) as img:
        return str(imagehash.phash(ImageOps.exif_transpose(img)))


def merge_radius(gps_accuracy_m: float | None) -> tuple[float, bool]:
    """(radius in metres, low_accuracy flag) per §12 step 2."""
    s = get_settings()
    if gps_accuracy_m is not None and gps_accuracy_m > s.GPS_ACCURACY_WIDEN_M:
        return float(min(s.DEDUPE_RADIUS_MAX_M, max(s.DEDUPE_RADIUS_M, gps_accuracy_m))), True
    return float(s.DEDUPE_RADIUS_M), False


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

# Step 1: nearest image by Hamming distance among reports already on a hotspot.
_PHASH_MATCH = text(
    """
    SELECT r.id, r.hotspot_id,
           bit_count(('x' || r.image_phash)::bit(64) # ('x' || :phash)::bit(64)) AS dist
    FROM reports r
    WHERE r.hotspot_id IS NOT NULL
      AND r.image_phash IS NOT NULL
      AND r.id <> :id
      AND bit_count(('x' || r.image_phash)::bit(64) # ('x' || :phash)::bit(64)) <= :max_dist
    ORDER BY dist, r.created_at DESC
    LIMIT 1
    """
)

# Steps 3-4: nearest eligible hotspot within the radius.
_CANDIDATE = text(
    """
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography AS g)
    SELECT h.id, h.status, ST_Distance(h.geom::geography, p.g) AS dist
    FROM hotspots h, p
    WHERE h.status <> 'false_positive'
      AND ST_DWithin(h.geom::geography, p.g, :radius)
      AND (
        h.status <> 'resolved'
        OR (
          SELECT max(e.created_at) FROM hotspot_events e
          WHERE e.hotspot_id = h.id AND e.to_status = 'resolved'
        ) >= CAST(:now AS timestamptz) - make_interval(days => :window_days)
      )
    ORDER BY dist, h.id
    LIMIT 1
    """
)

_CREATE_HOTSPOT = text(
    """
    INSERT INTO hotspots (geom, radius_m, status, first_reported_at, last_reported_at,
                          report_count, unique_reporters, recurrence_returns)
    VALUES (ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 0, 'ai_detected', :at, :at, 0, 0, 0)
    RETURNING id
    """
)

_ATTACH = text("UPDATE reports SET hotspot_id = :hid, duplicate_of = :dup WHERE id = :rid")

# Centre = minimum bounding circle of non-duplicate members; radius in metres.
# unique_reporters: a reporter's reports collapse into one unit while each is within
# 24 h of that reporter's previous one (§12 step 4). Duplicates never count.
_RECOMPUTE = text(
    """
    WITH members AS (
        SELECT geom, reporter_id, created_at
        FROM reports WHERE hotspot_id = :hid AND duplicate_of IS NULL
    ),
    centre AS (
        SELECT (ST_MinimumBoundingRadius(ST_Collect(geom))).center AS c FROM members
    ),
    sessions AS (
        SELECT CASE
                 WHEN lag(created_at) OVER w IS NULL THEN 1
                 WHEN created_at - lag(created_at) OVER w > interval '24 hours' THEN 1
                 ELSE 0
               END AS starts
        FROM members
        WINDOW w AS (PARTITION BY reporter_id ORDER BY created_at)
    )
    UPDATE hotspots h SET
        geom = ST_SetSRID(centre.c, 4326),
        radius_m = COALESCE((
            SELECT max(ST_Distance(m.geom::geography, ST_SetSRID(centre.c, 4326)::geography))
            FROM members m), 0),
        report_count = (SELECT count(*) FROM reports WHERE hotspot_id = :hid),
        unique_reporters = (SELECT COALESCE(sum(starts), 0) FROM sessions),
        first_reported_at = (SELECT min(created_at) FROM reports WHERE hotspot_id = :hid),
        last_reported_at = (SELECT max(created_at) FROM reports WHERE hotspot_id = :hid)
    FROM centre
    WHERE h.id = :hid
    RETURNING ST_X(h.geom), ST_Y(h.geom)
    """
)

_CENTRE = text("SELECT ST_X(geom), ST_Y(geom), status FROM hotspots WHERE id = :hid")

_DISTANCE_M = text(
    """
    SELECT ST_Distance(ST_SetSRID(ST_MakePoint(:x1, :y1), 4326)::geography,
                       ST_SetSRID(ST_MakePoint(:x2, :y2), 4326)::geography)
    """
)

_REOPEN = text(
    """
    UPDATE hotspots SET status = 'ai_detected', recurrence_returns = recurrence_returns + 1
    WHERE id = :hid
    """
)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def assign_report(conn: Connection, report: ReportInput) -> DedupeResult:
    """Attach `report` to a hotspot (existing or new). Caller owns the transaction."""
    s = get_settings()
    radius, low_accuracy = merge_radius(report.gps_accuracy_m)

    # Step 1 — perceptual-hash duplicate.
    if report.image_phash:
        match = conn.execute(
            _PHASH_MATCH,
            {"phash": report.image_phash, "id": report.id, "max_dist": s.PHASH_HAMMING_MAX},
        ).first()
        if match is not None:
            dup_id, hotspot_id = match[0], match[1]
            status = conn.execute(_CENTRE, {"hid": hotspot_id}).one()[2]
            conn.execute(_ATTACH, {"hid": hotspot_id, "dup": dup_id, "rid": report.id})
            _recompute(conn, hotspot_id)
            record_event(
                conn, hotspot_id, status, from_status=status, at=report.created_at,
                note=f"Duplicate image of report {dup_id} attached; not counted as new evidence.",
            )
            return DedupeResult(
                hotspot_id=hotspot_id, merged=True, created=False, reopened=False,
                duplicate_of=dup_id, low_accuracy=low_accuracy, radius_m=radius,
                centroid_moved_m=0.0,
            )

    # Steps 2-3 — nearest eligible hotspot within the (possibly widened) radius.
    cand = conn.execute(
        _CANDIDATE,
        {
            "lon": report.lon, "lat": report.lat, "radius": radius,
            "now": report.created_at, "window_days": s.REOPEN_WINDOW_DAYS,
        },
    ).first()

    if cand is None:
        hotspot_id = conn.execute(
            _CREATE_HOTSPOT, {"lon": report.lon, "lat": report.lat, "at": report.created_at}
        ).scalar_one()
        conn.execute(_ATTACH, {"hid": hotspot_id, "dup": None, "rid": report.id})
        _recompute(conn, hotspot_id)
        record_event(
            conn, hotspot_id, "ai_detected", at=report.created_at,
            note="Created from a citizen report flagged as likely plastic.",
        )
        return DedupeResult(
            hotspot_id=hotspot_id, merged=False, created=True, reopened=False,
            duplicate_of=None, low_accuracy=low_accuracy, radius_m=radius,
            centroid_moved_m=0.0,
        )

    # Step 4 — attach to the nearest candidate.
    hotspot_id, status = cand[0], cand[1]
    before_x, before_y, _ = conn.execute(_CENTRE, {"hid": hotspot_id}).one()
    conn.execute(_ATTACH, {"hid": hotspot_id, "dup": None, "rid": report.id})
    after_x, after_y = _recompute(conn, hotspot_id)
    moved = conn.execute(
        _DISTANCE_M, {"x1": before_x, "y1": before_y, "x2": after_x, "y2": after_y}
    ).scalar_one()

    reopened = status == "resolved"
    if reopened:
        conn.execute(_REOPEN, {"hid": hotspot_id})
        record_event(
            conn, hotspot_id, "ai_detected", from_status="resolved", at=report.created_at,
            note=f"Reopened: new report within {radius:.0f} m (recurrence +1).",
        )
    else:
        record_event(
            conn, hotspot_id, status, from_status=status, at=report.created_at,
            note="New report attached.",
        )

    return DedupeResult(
        hotspot_id=hotspot_id, merged=True, created=False, reopened=reopened,
        duplicate_of=None, low_accuracy=low_accuracy, radius_m=radius,
        centroid_moved_m=float(moved),
    )


def _recompute(conn: Connection, hotspot_id: int) -> tuple[float, float]:
    x, y = conn.execute(_RECOMPUTE, {"hid": hotspot_id}).one()
    return float(x), float(y)

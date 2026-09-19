"""SPEC §12 duplicate-merge scenarios (Stage 4), against real PostGIS.

Report positions are placed an exact geodesic distance from the hotspot with
ST_Project, so "10 m / 25 m / 45 m" mean exactly that.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.services.dedupe import ReportInput, assign_report, merge_radius
from app.services.events import record_event

BASE = (73.8517, 18.5239)  # lon, lat
T0 = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
PHASH = "f0f0f0f0f0f0f0f0"


def flip_bits(phash: str, k: int) -> str:
    return f"{int(phash, 16) ^ ((1 << k) - 1):016x}"


@pytest.fixture
def users(conn):
    ids = [uuid.uuid4() for _ in range(4)]
    for i, uid in enumerate(ids):
        conn.execute(
            text("INSERT INTO users (id, name, role) VALUES (:id, :n, 'citizen')"),
            {"id": uid, "n": f"citizen {i}"},
        )
    return ids


def offset(conn, point, metres: float, azimuth_deg: float = 0.0) -> tuple[float, float]:
    """The point exactly `metres` away along a geodesic (0 = north, 90 = east)."""
    x, y = conn.execute(
        text(
            "SELECT ST_X(g), ST_Y(g) FROM (SELECT ST_Project("
            "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :m, radians(:az)"
            ")::geometry AS g) s"
        ),
        {"lon": point[0], "lat": point[1], "m": metres, "az": azimuth_deg},
    ).one()
    return float(x), float(y)


def add_report(conn, reporter, point, at=T0, accuracy=None, phash=None) -> ReportInput:
    rid = uuid.uuid4()
    conn.execute(
        text(
            """
            INSERT INTO reports (id, reporter_id, image_path, image_phash, geom,
                                 gps_accuracy_m, location_source, created_at,
                                 ai_status, is_simulated)
            VALUES (:id, :rep, 'uploads/x.jpg', :ph,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
                    :acc, 'browser', :at, 'detected', true)
            """
        ),
        {"id": rid, "rep": reporter, "ph": phash, "lon": point[0], "lat": point[1],
         "acc": accuracy, "at": at},
    )
    return ReportInput(
        id=rid, reporter_id=reporter, lon=point[0], lat=point[1], created_at=at,
        gps_accuracy_m=accuracy, image_phash=phash,
    )


def hotspot(conn, hid):
    return conn.execute(
        text(
            "SELECT status, report_count, unique_reporters, recurrence_returns, radius_m,"
            " ST_X(geom) AS lon, ST_Y(geom) AS lat FROM hotspots WHERE id = :id"
        ),
        {"id": hid},
    ).mappings().one()


def events(conn, hid):
    return conn.execute(
        text(
            "SELECT from_status, to_status, actor_id FROM hotspot_events"
            " WHERE hotspot_id = :id ORDER BY id"
        ),
        {"id": hid},
    ).all()


def resolve(conn, hid, at):
    conn.execute(text("UPDATE hotspots SET status = 'resolved' WHERE id = :id"), {"id": hid})
    record_event(conn, hid, "resolved", from_status="cleanup_completed", at=at)


# ---------------------------------------------------------------------------
# Creation and the 30 m radius
# ---------------------------------------------------------------------------


def test_first_report_creates_an_ai_detected_hotspot(conn, users):
    res = assign_report(conn, add_report(conn, users[0], BASE))
    assert (res.created, res.merged, res.reopened) == (True, False, False)
    h = hotspot(conn, res.hotspot_id)
    assert (h["status"], h["report_count"], h["unique_reporters"]) == ("ai_detected", 1, 1)
    assert events(conn, res.hotspot_id) == [(None, "ai_detected", None)]


@pytest.mark.parametrize(("metres", "merges"), [(10, True), (25, True), (45, False)])
def test_merge_radius_30m(conn, users, metres, merges):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    second = assign_report(
        conn, add_report(conn, users[1], offset(conn, BASE, metres), at=T0 + timedelta(hours=1))
    )
    assert second.merged is merges
    if merges:
        assert second.hotspot_id == first.hotspot_id
        assert hotspot(conn, first.hotspot_id)["report_count"] == 2
    else:
        assert second.created and second.hotspot_id != first.hotspot_id
        assert hotspot(conn, first.hotspot_id)["report_count"] == 1


def test_nearest_candidate_wins(conn, users):
    a = assign_report(conn, add_report(conn, users[0], BASE))
    b_point = offset(conn, BASE, 50, 90)
    b = assign_report(conn, add_report(conn, users[1], b_point))
    assert a.hotspot_id != b.hotspot_id
    # 28 m from A and ~22 m from B: inside both radii, B is nearer.
    between = offset(conn, BASE, 28, 90)
    res = assign_report(conn, add_report(conn, users[2], between, at=T0 + timedelta(hours=2)))
    assert res.hotspot_id == b.hotspot_id


def test_centroid_and_radius_are_recomputed(conn, users):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    north = offset(conn, BASE, 20, 0)
    res = assign_report(conn, add_report(conn, users[1], north, at=T0 + timedelta(hours=1)))
    h = hotspot(conn, first.hotspot_id)
    centre_to_base = conn.execute(
        text(
            "SELECT ST_Distance(ST_SetSRID(ST_MakePoint(:a, :b), 4326)::geography,"
            " ST_SetSRID(ST_MakePoint(:c, :d), 4326)::geography)"
        ),
        {"a": h["lon"], "b": h["lat"], "c": BASE[0], "d": BASE[1]},
    ).scalar()
    assert centre_to_base == pytest.approx(10, abs=0.5)
    assert h["radius_m"] == pytest.approx(10, abs=0.5)
    assert res.centroid_moved_m == pytest.approx(10, abs=0.5)


# ---------------------------------------------------------------------------
# unique_reporters
# ---------------------------------------------------------------------------


def test_same_reporter_within_24h_counts_once(conn, users):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    assign_report(
        conn, add_report(conn, users[0], offset(conn, BASE, 5), at=T0 + timedelta(hours=23))
    )
    h = hotspot(conn, first.hotspot_id)
    assert (h["report_count"], h["unique_reporters"]) == (2, 1)


def test_different_reporter_counts_twice(conn, users):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    assign_report(conn, add_report(conn, users[1], offset(conn, BASE, 5)))
    assert hotspot(conn, first.hotspot_id)["unique_reporters"] == 2


def test_same_reporter_after_24h_counts_again_per_spec(conn, users):
    """§12 applied literally: the 24 h collapse does not extend past 24 h."""
    first = assign_report(conn, add_report(conn, users[0], BASE))
    assign_report(
        conn, add_report(conn, users[0], offset(conn, BASE, 5), at=T0 + timedelta(hours=25))
    )
    assert hotspot(conn, first.hotspot_id)["unique_reporters"] == 2


# ---------------------------------------------------------------------------
# pHash duplicates
# ---------------------------------------------------------------------------


def test_phash_duplicate_attaches_without_new_evidence(conn, users):
    original = add_report(conn, users[0], BASE, phash=PHASH)
    first = assign_report(conn, original)
    before = hotspot(conn, first.hotspot_id)

    # Different reporter, 500 m away, image 6 bits off: still the same photo.
    far = offset(conn, BASE, 500, 45)
    dup = assign_report(
        conn,
        add_report(conn, users[1], far, at=T0 + timedelta(days=2), phash=flip_bits(PHASH, 6)),
    )
    assert dup.duplicate_of == original.id
    assert dup.merged and dup.hotspot_id == first.hotspot_id

    after = hotspot(conn, first.hotspot_id)
    assert after["report_count"] == 2
    assert after["unique_reporters"] == 1, "a duplicate image is not new unique evidence"
    assert (after["lon"], after["lat"]) == pytest.approx((before["lon"], before["lat"]))


def test_phash_beyond_threshold_is_not_a_duplicate(conn, users):
    assign_report(conn, add_report(conn, users[0], BASE, phash=PHASH))
    far = offset(conn, BASE, 500, 45)
    res = assign_report(conn, add_report(conn, users[1], far, phash=flip_bits(PHASH, 7)))
    assert res.duplicate_of is None and res.created


def test_phash_duplicate_never_reopens_a_resolved_hotspot(conn, users):
    original = add_report(conn, users[0], BASE, phash=PHASH)
    first = assign_report(conn, original)
    resolve(conn, first.hotspot_id, T0 + timedelta(days=3))
    dup = assign_report(
        conn, add_report(conn, users[1], BASE, at=T0 + timedelta(days=10), phash=PHASH)
    )
    assert dup.duplicate_of == original.id and not dup.reopened
    h = hotspot(conn, first.hotspot_id)
    assert (h["status"], h["recurrence_returns"]) == ("resolved", 0)


# ---------------------------------------------------------------------------
# Low-accuracy GPS
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("accuracy", "radius", "low"), [(None, 30, False), (25, 30, False), (30, 30, False),
                                    (60, 60, True), (500, 75, True)]
)
def test_merge_radius_widening(set_env, accuracy, radius, low):
    set_env(DEDUPE_RADIUS_M=30, DEDUPE_RADIUS_MAX_M=75, GPS_ACCURACY_WIDEN_M=30)
    assert merge_radius(accuracy) == (radius, low)


def test_low_accuracy_widens_radius_and_merges(conn, users):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    res = assign_report(conn, add_report(conn, users[1], offset(conn, BASE, 45), accuracy=60))
    assert res.low_accuracy and res.radius_m == 60
    assert res.merged and res.hotspot_id == first.hotspot_id


def test_widening_is_capped_at_max(conn, users):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    res = assign_report(conn, add_report(conn, users[1], offset(conn, BASE, 80), accuracy=500))
    assert res.low_accuracy and res.radius_m == 75
    assert res.created and res.hotspot_id != first.hotspot_id


# ---------------------------------------------------------------------------
# Resolved / false-positive candidates
# ---------------------------------------------------------------------------


def test_report_near_recently_resolved_hotspot_reopens_it(conn, users):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    resolve(conn, first.hotspot_id, T0 + timedelta(days=5))
    res = assign_report(
        conn, add_report(conn, users[1], offset(conn, BASE, 12), at=T0 + timedelta(days=20))
    )
    assert res.reopened and res.merged and res.hotspot_id == first.hotspot_id
    h = hotspot(conn, first.hotspot_id)
    assert (h["status"], h["recurrence_returns"]) == ("ai_detected", 1)
    assert events(conn, first.hotspot_id)[-1] == ("resolved", "ai_detected", None)


def test_hotspot_resolved_beyond_window_is_not_a_candidate(conn, users):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    resolve(conn, first.hotspot_id, T0 + timedelta(days=1))
    res = assign_report(
        conn, add_report(conn, users[1], offset(conn, BASE, 5), at=T0 + timedelta(days=120))
    )
    assert res.created and res.hotspot_id != first.hotspot_id
    assert hotspot(conn, first.hotspot_id)["status"] == "resolved"


def test_false_positive_hotspot_is_never_a_candidate(conn, users):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    conn.execute(
        text("UPDATE hotspots SET status = 'false_positive' WHERE id = :id"),
        {"id": first.hotspot_id},
    )
    res = assign_report(conn, add_report(conn, users[1], offset(conn, BASE, 5)))
    assert res.created and res.hotspot_id != first.hotspot_id


def test_every_mutation_writes_an_event(conn, users):
    first = assign_report(conn, add_report(conn, users[0], BASE))
    assign_report(conn, add_report(conn, users[1], offset(conn, BASE, 5)))
    assert len(events(conn, first.hotspot_id)) == 2

"""Stage 9 backend: dashboard aggregates from real data, with exact expected numbers.

A scripted history (all through the real pipeline and workflow):
  day 0  A reports at P1           -> hotspot H1 created
  day 1  B reports at P1           -> merged, promoted (2 reporters)
  day 2  authority verifies H1
  day 3  scheduled; A reports at P2 (500 m away) -> hotspot H2
  day 4  team completes H1 cleanup; B reports at P3 -> H3; authority: H3 false positive
  day 5  authority resolves H1 (5.0 days after it opened); A's report finds no plastic
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.deps import demo_users, find_demo_user
from app.schemas import HotspotStatus, LocationSource, UserRole
from app.services import analytics, pipeline
from app.services.users import ensure_demo_users
from app.services.workflow import transition
from tests.test_reports_e2e import fake_detection, photo

DAY0 = datetime(2026, 8, 10, 9, 0, tzinfo=UTC)
P1 = (73.8517, 18.5239)  # ward A
P2 = (73.8567 + 0.004, 18.5160)  # ward B
P3 = (73.8480, 18.5150)  # ward C
S = HotspotStatus


def day(n: int, hour: int = 0) -> datetime:
    return DAY0 + timedelta(days=n, hours=hour)


@pytest.fixture
def history(conn, monkeypatch):
    from tests.test_geo_context import load_geo

    load_geo.load_all(conn)
    ensure_demo_users(conn)
    citizens = [u for u in demo_users() if u.role == UserRole.citizen]
    a, b = citizens[0].id, citizens[1].id
    authority = find_demo_user(role=UserRole.authority)
    team = find_demo_user(role=UserRole.team)

    state = {"out": fake_detection()}
    monkeypatch.setattr(pipeline.detector, "run_detection", lambda path: state["out"])
    photos = iter(photo(s) for s in range(500, 520))

    def report(who, point, at):
        return pipeline.process_report(
            conn, reporter_id=who, image_bytes=next(photos), lat=point[1], lon=point[0],
            source=LocationSource.browser, created_at=at,
        )

    h1 = report(a, P1, day(0)).dedupe.hotspot_id
    report(b, P1, day(1))
    transition(conn, h1, S.verified, actor=authority, at=day(2))
    transition(conn, h1, S.cleanup_scheduled, actor=authority, at=day(3))
    h2 = report(a, P2, day(3, 2)).dedupe.hotspot_id
    transition(conn, h1, S.cleanup_completed, actor=team, at=day(4))
    h3 = report(b, P3, day(4, 1)).dedupe.hotspot_id
    transition(conn, h3, S.false_positive, actor=authority, reason="not_plastic", at=day(4, 2))
    transition(conn, h1, S.resolved, actor=authority, at=day(5))
    state["out"] = fake_detection(n=0)
    assert report(a, P1, day(5, 3)).dedupe is None  # not detected: joins no hotspot
    return {"h1": h1, "h2": h2, "h3": h3}


def test_kpis_are_exact(conn, history):
    s = analytics.summary(conn)
    k = s.kpis
    assert k.total_reports == 5
    assert k.active_hotspots == 1  # only H2 is still open
    assert k.awaiting_verification == 0
    assert k.verified_hotspots == 0
    assert k.resolved_hotspots == 1
    assert k.median_days_to_resolve == 5.0
    assert s.simulated_data is True  # stub-mode detections are simulated


def test_band_breakdown_counts_open_hotspots_only(conn, history):
    s = analytics.summary(conn)
    h2_band = conn.execute(
        text("SELECT priority_band FROM hotspots WHERE id = :h"), {"h": history["h2"]}
    ).scalar()
    counts = {b.band.value: b.count for b in s.by_band}
    assert sum(counts.values()) == 1 and counts[h2_band] == 1


def test_status_breakdown(conn, history):
    counts = {c.status.value: c.count for c in analytics.summary(conn).by_status}
    assert counts == {
        "ai_detected": 1, "needs_verification": 0, "verified": 0, "cleanup_scheduled": 0,
        "cleanup_completed": 0, "resolved": 1, "false_positive": 1,
    }


def test_trend_per_utc_day(conn, history):
    t = analytics.trend(conn, days=7, today=day(6))
    by_date = {p.date: p for p in t.points}
    assert len(t.points) == 7 and t.points[0].date == day(0).date().isoformat()
    assert [by_date[day(i).date().isoformat()].reports for i in range(7)] == [1, 1, 0, 1, 1, 1, 0]
    assert [by_date[day(i).date().isoformat()].hotspots_opened for i in range(7)] == [
        1, 0, 0, 1, 1, 0, 0
    ]
    assert [by_date[day(i).date().isoformat()].hotspots_resolved for i in range(7)] == [
        0, 0, 0, 0, 0, 1, 0
    ]


def test_ward_stats(conn, history):
    rows = {w.ward_name: w for w in analytics.wards(conn).wards}
    assert (rows["Ward A"].resolved_count, rows["Ward A"].open_count) == (1, 0)
    # H1's two reports; the not-detected report joined no hotspot, so no ward.
    assert rows["Ward A"].total_reports == 2
    assert (rows["Ward B"].open_count, rows["Ward B"].hotspot_count) == (1, 1)
    assert (rows["Ward C"].open_count, rows["Ward C"].hotspot_count) == (0, 1)


def test_analytics_endpoints_are_authority_only(api):
    from tests.conftest import auth_header

    for path in ("/analytics/summary", "/analytics/trend", "/analytics/wards"):
        assert api.get(path, headers=auth_header(api, "citizen")).status_code == 403
        assert api.get(path, headers=auth_header(api, "authority")).status_code == 200


def test_empty_database_gives_zeros_not_errors(api):
    from tests.conftest import auth_header

    body = api.get("/analytics/summary", headers=auth_header(api, "authority")).json()
    assert body["kpis"]["total_reports"] == 0
    assert body["kpis"]["median_days_to_resolve"] is None
    assert body["simulated_data"] is False

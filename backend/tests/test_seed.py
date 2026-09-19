"""Stage 10: the seeded demo history is reproducible AND obeys every live rule."""

from __future__ import annotations

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from app.services.hotspot_views import list_features

SEED = Path(__file__).resolve().parents[2] / "seed" / "seed_demo.py"
NOW = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)


def _seed_module():
    spec = importlib.util.spec_from_file_location("seed_demo_under_test", SEED)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


seed_demo = _seed_module()


@pytest.fixture(scope="module")
def seeded(db_engine, tmp_path_factory):
    """Seed once for the whole module (it takes ~20 s)."""
    import os

    from app.config import get_settings

    old = os.environ.get("UPLOAD_DIR")
    os.environ["UPLOAD_DIR"] = str(tmp_path_factory.mktemp("uploads"))
    get_settings.cache_clear()
    from tests.conftest import truncate_all

    truncate_all(db_engine)
    with db_engine.begin() as conn:
        counts = seed_demo.reset_and_seed(conn, now=NOW)
    yield counts
    if old is None:
        os.environ.pop("UPLOAD_DIR", None)
    else:
        os.environ["UPLOAD_DIR"] = old
    get_settings.cache_clear()


def q(db_engine, sql, **params):
    with db_engine.connect() as c:
        return c.execute(text(sql), params).all()


def test_counts_match_spec_19(seeded):
    assert seeded["reports"] == 61  # SPEC §19: ~60 reports
    assert seeded["hotspots"] == 16  # ~15 hotspots
    assert seeded["tasks"] == 6


def test_statuses_span_the_whole_lifecycle(seeded):
    assert seeded["by_status"] == {
        "ai_detected": 4, "needs_verification": 5, "verified": 1, "cleanup_scheduled": 1,
        "cleanup_completed": 1, "resolved": 2, "false_positive": 2,
    }


def test_every_report_is_simulated(seeded, db_engine):
    assert q(db_engine, "SELECT count(*) FROM reports WHERE NOT is_simulated")[0][0] == 0


def test_history_spans_45_days_and_three_wards(seeded, db_engine):
    first, last = q(db_engine, "SELECT min(created_at), max(created_at) FROM reports")[0]
    assert (last - first) > timedelta(days=40)
    wards = q(db_engine, "SELECT count(DISTINCT ward_id) FROM hotspots WHERE ward_id IS NOT NULL")
    assert wards[0][0] == 3


def test_human_gate_holds_in_seeded_history(seeded, db_engine):
    """CLAUDE.md §2.5: every verified / ruled-out / resolved event has an authority actor."""
    rows = q(
        db_engine,
        """
        SELECT e.to_status, u.role FROM hotspot_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.to_status IN ('verified', 'false_positive', 'resolved')
          AND e.from_status IS DISTINCT FROM e.to_status  -- status CHANGES, not evidence added
        """,
    )
    assert rows and all(role == "authority" for _, role in rows), rows
    completed = q(
        db_engine,
        "SELECT u.role FROM hotspot_events e JOIN users u ON u.id = e.actor_id"
        " WHERE e.to_status = 'cleanup_completed' AND e.from_status <> e.to_status",
    )
    assert completed and all(r == "team" for (r,) in completed)


def test_reopen_arcs_raise_recurrence(seeded, db_engine):
    rows = q(db_engine, "SELECT count(*) FROM hotspots WHERE recurrence_returns >= 1")
    assert rows[0][0] == 2
    reopen_events = q(
        db_engine,
        "SELECT count(*) FROM hotspot_events WHERE from_status = 'resolved'"
        " AND to_status = 'ai_detected' AND actor_id IS NULL",
    )
    assert reopen_events[0][0] == 2


def test_same_reporter_within_24h_counts_once(seeded, db_engine):
    """H15: two reports by one person hours apart -> 1 reporter, stays AI-flagged."""
    rows = q(
        db_engine,
        "SELECT h.status, h.unique_reporters, h.report_count FROM hotspots h"
        " WHERE h.report_count = 2 AND h.unique_reporters = 1",
    )
    assert rows == [("ai_detected", 1, 2)]


def test_duplicate_and_rejected_reports(seeded, db_engine):
    assert q(db_engine, "SELECT count(*) FROM reports WHERE duplicate_of IS NOT NULL")[0][0] == 1
    rejected = q(
        db_engine,
        "SELECT count(*) FROM reports WHERE ai_status = 'not_detected' AND hotspot_id IS NULL",
    )
    assert rejected[0][0] == 3


def test_tasks_have_a_cached_greedy_route_from_the_depot(seeded, db_engine):
    rows = q(db_engine, "SELECT route_geojson, status FROM cleanup_tasks ORDER BY id")
    for geo, _status in rows:
        coords = geo["coordinates"]
        assert geo["type"] == "LineString" and coords[0] == coords[-1] == [73.856, 18.52]
    # Five cleanups were carried out (one awaits the authority's review); one is planned.
    assert sorted(s for _, s in rows) == ["done"] * 5 + ["planned"]


def test_time_slider_shows_the_history_growing(seeded, db_engine):
    with db_engine.connect() as c:
        early = list_features(c, as_of=NOW - timedelta(days=40)).features
        mid = list_features(c, as_of=NOW - timedelta(days=20)).features
        live = list_features(c).features
    assert 0 < len(early) < len(mid) < len(live) == 16


def test_reseeding_is_idempotent(seeded, db_engine):
    with db_engine.begin() as conn:
        again = seed_demo.reset_and_seed(conn, now=NOW)
    assert {k: again[k] for k in ("reports", "hotspots", "tasks", "by_status")} == {
        k: seeded[k] for k in ("reports", "hotspots", "tasks", "by_status")
    }
    ids = q(db_engine, "SELECT min(id), max(id) FROM hotspots")[0]
    assert tuple(ids) == (1, 16), "ids restart so 'Hotspot #1' is the same every demo"

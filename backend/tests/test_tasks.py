"""Stage P1-A: cleanup tasks over verified hotspots, routing with fallback, team view."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.schemas import HotspotStatus, LocationSource
from app.services import pipeline, routing
from app.services.workflow import transition
from tests.conftest import auth_header
from tests.test_reports_e2e import fake_detection, photo

TEAM = "33333333-3333-4333-8333-333333333333"
DEPOT = [73.8560, 18.5200]
SPOTS = [(73.8497, 18.5236), (73.8524, 18.5217), (73.8583, 18.5272)]


# ---------------------------------------------------------------------------
# Routing (no network: the one HTTP call is replaced)
# ---------------------------------------------------------------------------


def test_polyline_decoding_matches_the_reference_example():
    # Google's documented example: (38.5,-120.2), (40.7,-120.95), (43.252,-126.453)
    got = routing.decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
    assert got == [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]


def test_greedy_visits_nearest_first_and_returns_to_depot():
    stops = [(1, (73.8600, 18.5200)), (2, (73.8565, 18.5200)), (3, (73.8700, 18.5200))]
    r = routing.greedy_route((73.8560, 18.5200), stops)
    assert r.order == [2, 1, 3] and r.source == "greedy"
    assert r.coordinates[0] == r.coordinates[-1] == [73.8560, 18.5200]
    leg = routing.haversine_m((73.856, 18.52), (73.87, 18.52))
    assert r.distance_m == pytest.approx(2 * leg, rel=1e-6)


@pytest.fixture
def ors_env(set_env, monkeypatch):
    set_env(ORS_API_KEY="test-key", ORS_DAILY_QUOTA=2)
    monkeypatch.setattr(routing, "_ors_calls", {})
    calls = []

    def fake(payload):
        calls.append(payload)
        ids = [j["id"] for j in payload["jobs"]]
        return {"routes": [{
            "steps": [{"type": "start"}] + [{"type": "job", "id": i} for i in reversed(ids)]
                     + [{"type": "end"}],
            "geometry": "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
            "distance": 1234.0, "duration": 321.0,
        }]}

    monkeypatch.setattr(routing, "_post_ors", fake)
    return calls


def test_ors_route_is_used_when_available(ors_env):
    r = routing.plan_route((73.856, 18.52), [(1, (73.86, 18.52)), (2, (73.87, 18.52))])
    assert (r.source, r.order, r.distance_m, r.duration_s) == ("ors", [2, 1], 1234.0, 321.0)
    assert r.coordinates[0] == [-120.2, 38.5]
    assert len(ors_env) == 1


def test_ors_failure_falls_back_to_greedy(ors_env, monkeypatch):
    def boom(payload):
        raise ConnectionError("ORS is down")

    monkeypatch.setattr(routing, "_post_ors", boom)
    r = routing.plan_route((73.856, 18.52), [(1, (73.86, 18.52))])
    assert r.source == "greedy" and r.order == [1]


def test_ors_quota_is_respected(ors_env):
    for _ in range(2):
        assert routing.plan_route((73.856, 18.52), [(1, (73.86, 18.52))]).source == "ors"
    third = routing.plan_route((73.856, 18.52), [(1, (73.86, 18.52))])
    assert third.source == "greedy" and len(ors_env) == 2, "no call once the quota is used"


def test_no_api_key_means_greedy_without_any_call(set_env, monkeypatch):
    set_env(ORS_API_KEY="")
    monkeypatch.setattr(routing, "_post_ors", lambda p: pytest.fail("must not call ORS"))
    assert routing.plan_route((73.856, 18.52), [(1, (73.86, 18.52))]).source == "greedy"


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest.fixture
def hotspots(api, db_engine, monkeypatch, set_env):
    """Three hotspots from real reports; the first two verified by an authority."""
    set_env(ORS_API_KEY="")
    monkeypatch.setattr(pipeline.detector, "run_detection", lambda path: fake_detection())
    from app.deps import find_demo_user
    from app.schemas import UserRole

    authority = find_demo_user(role=UserRole.authority)
    reporter = uuid.UUID("11111111-1111-4111-8111-111111111111")
    ids = []
    with db_engine.begin() as conn:
        for i, (lon, lat) in enumerate(SPOTS):
            res = pipeline.process_report(
                conn, reporter_id=reporter, image_bytes=photo(700 + i), lat=lat, lon=lon,
                source=LocationSource.browser, created_at=datetime.now(UTC),
            )
            ids.append(res.dedupe.hotspot_id)
        for hid in ids[:2]:
            transition(conn, hid, HotspotStatus.verified, actor=authority)
    return ids


def create(api, ids, role="authority", team=TEAM):
    return api.post("/tasks", headers=auth_header(api, role),
                    json={"hotspot_ids": ids, "team_id": team, "depot": DEPOT})


def status_of(db_engine, hid):
    with db_engine.connect() as c:
        return c.execute(text("SELECT status FROM hotspots WHERE id = :h"), {"h": hid}).scalar()


def test_task_with_a_non_verified_hotspot_is_409_and_changes_nothing(api, hotspots, db_engine):
    res = create(api, hotspots)  # the third is only AI-flagged
    assert res.status_code == 409
    assert f"#{hotspots[2]} (ai_detected)" in res.json()["detail"]
    assert status_of(db_engine, hotspots[0]) == "verified", "nothing changes on a 409"
    with db_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM cleanup_tasks")).scalar() == 0


def test_task_over_verified_hotspots_routes_and_schedules(api, hotspots, db_engine):
    res = create(api, hotspots[:2])
    assert res.status_code == 201, res.text
    t = res.json()
    assert t["route_source"] == "greedy"  # ORS_API_KEY unset
    geo = t["route_geojson"]
    assert geo["type"] == "Feature" and geo["geometry"]["type"] == "LineString"
    assert geo["geometry"]["coordinates"][0] == geo["geometry"]["coordinates"][-1] == DEPOT
    assert [s["seq"] for s in t["stops"]] == [1, 2]
    assert sorted(s["hotspot_id"] for s in t["stops"]) == sorted(hotspots[:2])
    assert t["route_distance_m"] > 0 and t["status"] == "planned"
    for hid in hotspots[:2]:
        assert status_of(db_engine, hid) == "cleanup_scheduled"
    with db_engine.connect() as c:
        actors = c.execute(text(
            "SELECT u.role FROM hotspot_events e JOIN users u ON u.id = e.actor_id"
            " WHERE e.to_status = 'cleanup_scheduled'")).scalars().all()
    assert actors == ["authority", "authority"], "scheduling is audited with the human"


def test_only_an_authority_can_create_tasks(api, hotspots):
    assert create(api, hotspots[:1], role="team").status_code == 403
    assert create(api, hotspots[:1], role="citizen").status_code == 403


def test_team_id_must_be_a_team_and_hotspots_must_exist(api, hotspots):
    citizen = "11111111-1111-4111-8111-111111111111"
    assert create(api, hotspots[:1], team=citizen).status_code == 422
    assert create(api, [999_999]).status_code == 404


def test_teams_see_only_their_own_tasks(api, hotspots, db_engine):
    tid = create(api, hotspots[:1]).json()["id"]
    assert [t["id"] for t in api.get("/tasks", headers=auth_header(api, "team")).json()] == [tid]
    assert api.get(f"/tasks/{tid}", headers=auth_header(api, "team")).status_code == 200
    with db_engine.begin() as c:  # reassign to a different team
        other = uuid.uuid4()
        c.execute(
            text("INSERT INTO users (id, name, role) VALUES (:i, 'Team 2', 'team')"), {"i": other}
        )
        c.execute(text("UPDATE cleanup_tasks SET assigned_team = :o"), {"o": other})
    assert api.get("/tasks", headers=auth_header(api, "team")).json() == []
    assert api.get(f"/tasks/{tid}", headers=auth_header(api, "team")).status_code == 404
    assert api.get(f"/tasks/{tid}", headers=auth_header(api, "authority")).status_code == 200


def test_arrival_only_counts_within_50m(api, hotspots, db_engine):
    t = create(api, hotspots[:1]).json()
    stop = t["stops"][0]
    team = auth_header(api, "team")
    url = f"/tasks/{t['id']}/stops/{stop['id']}/arrive"

    far = api.post(url, headers=team, json={"lat": stop["lat"] + 0.0011, "lon": stop["lon"]}).json()
    assert far["within_range"] is False and far["distance_m"] > 100
    assert far["stop"]["arrived_at"] is None

    near_at = {"lat": stop["lat"] + 0.0001, "lon": stop["lon"]}
    near = api.post(url, headers=team, json=near_at).json()
    assert near["within_range"] is True and near["distance_m"] < 15
    assert near["stop"]["arrived_at"] is not None
    assert api.get(f"/tasks/{t['id']}", headers=team).json()["status"] == "in_progress"
    assert api.post(url, headers=auth_header(api, "authority"),
                    json={"lat": stop["lat"], "lon": stop["lon"]}).status_code == 403

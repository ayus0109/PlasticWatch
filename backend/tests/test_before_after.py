"""Stage P1-B: before/after closure with false-clean protection (SPEC §14).

Photos come from seed/scenes.py: the same seed is the same street, so an after-photo
can be a genuine retake (for the ORB viewpoint check) while the detector's boxes are
set by the test, which makes every verdict band deterministic.
"""

from __future__ import annotations

import importlib.util
import io
import math
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from PIL import ImageFilter
from sqlalchemy import text

from app.deps import find_demo_user
from app.schemas import (
    HotspotStatus,
    LocationSource,
    ReviewDecision,
    ReviewRequest,
    TaskCreateRequest,
    UserRole,
    Verdict,
)
from app.services import before_after, detector, pipeline, tasks, viewpoint
from app.services.tasks import TaskError
from app.services.workflow import WorkflowError, transition
from tests.conftest import auth_header
from tests.test_reports_e2e import fake_detection, photo

_spec = importlib.util.spec_from_file_location(
    "scenes_under_test", Path(__file__).resolve().parents[2] / "seed" / "scenes.py"
)
scenes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(scenes)

SITE_SEED = 4242
SITE = (73.8524, 18.5217)  # lon, lat
DEPOT = [73.8560, 18.5200]
REPORTER = uuid.UUID("11111111-1111-4111-8111-111111111111")


def jpeg(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def after_photos(seed: int = SITE_SEED, blur: float = 0) -> dict[str, bytes]:
    """A wide retake and a close-up of the cleaned spot (one non-plastic item left)."""
    clean, dets = scenes.make_scene(seed, 0, 1)
    wide, _ = scenes.retake(clean, dets, seed)
    close, _ = scenes.close_up(wide, [], seed)
    if blur:
        wide = wide.filter(ImageFilter.GaussianBlur(blur))
    return {"wide": jpeg(wide), "close": jpeg(close)}


def boxes(total_frac: float, n: int) -> list[dict]:
    """n likely-plastic boxes whose areas sum to total_frac of a 1024x768 photo."""
    if n == 0:
        return []
    side = math.sqrt(total_frac / n * scenes.W * scenes.H)
    return [
        {"class_name": "plastic_bottle", "confidence": 0.8,
         "x1": 40 + 30 * i, "y1": 40, "x2": 40 + 30 * i + side, "y2": 40 + side}
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# The verdict rule (pure)
# ---------------------------------------------------------------------------


def verdict(**kw):
    args = {"quality_ok": True, "location_ok": True, "viewpoint_ok": True,
            "reduction": 0.9, "after_count": 0} | kw
    return before_after.decide_verdict(**args)[0]


@pytest.mark.parametrize(
    ("reduction", "count", "expected"),
    [
        (1.0, 0, Verdict.likely_cleaned),
        (0.8, 1, Verdict.likely_cleaned),       # both edges are inclusive
        (0.8 - 1e-12, 1, Verdict.likely_cleaned),  # float noise still counts as 0.8
        (0.95, 2, Verdict.partial),             # >= 80% but more than one detection left
        (0.79, 0, Verdict.partial),
        (0.4, 5, Verdict.partial),
        (0.39, 0, Verdict.not_cleaned),
        (-0.5, 9, Verdict.not_cleaned),         # it got worse
    ],
)
def test_verdict_bands(reduction, count, expected):
    assert verdict(reduction=reduction, after_count=count) == expected


@pytest.mark.parametrize(
    "failed",
    [{"quality_ok": False}, {"location_ok": False}, {"viewpoint_ok": False}, {"reduction": None}],
)
def test_any_failed_check_is_inconclusive_even_when_it_looks_clean(failed):
    assert verdict(**({"reduction": 1.0, "after_count": 0} | failed)) == Verdict.inconclusive


def test_reduction_ratio():
    assert before_after.reduction_ratio(0.2, 0.05) == 0.75
    assert before_after.reduction_ratio(0.0, 0.05) is None
    assert before_after.reduction_ratio(None, 0.0) is None


# ---------------------------------------------------------------------------
# ORB viewpoint
# ---------------------------------------------------------------------------


def test_viewpoint_matches_the_same_place_and_not_another(tmp_path):
    before, _ = scenes.make_scene(SITE_SEED, 8, 2)
    before.save(tmp_path / "before.jpg", quality=90)
    for kind, data in after_photos().items():
        (tmp_path / f"{kind}.jpg").write_bytes(data)
    (tmp_path / "elsewhere.jpg").write_bytes(after_photos(seed=SITE_SEED + 1)["wide"])

    same = viewpoint.match(tmp_path / "before.jpg", tmp_path / "wide.jpg")
    close = viewpoint.match(tmp_path / "before.jpg", tmp_path / "close.jpg")
    other = viewpoint.match(tmp_path / "before.jpg", tmp_path / "elsewhere.jpg")
    assert same.ok and same.inliers > 100, same
    assert close.ok, close
    assert not other.ok and other.score < 0.03, other


# ---------------------------------------------------------------------------
# Service level: one site, each verdict
# ---------------------------------------------------------------------------


@pytest.fixture
def site(api, db_engine, set_env):
    """A verified hotspot from one before photo, on a task, team checked in."""
    set_env(ORS_API_KEY="")
    authority = find_demo_user(role=UserRole.authority)
    team = find_demo_user(role=UserRole.team)
    before, dets = scenes.make_scene(SITE_SEED, 8, 2)
    with db_engine.begin() as conn:
        res = pipeline.process_report(
            conn, reporter_id=REPORTER, image_bytes=jpeg(before), lat=SITE[1], lon=SITE[0],
            source=LocationSource.browser, created_at=datetime.now(UTC), known_detections=dets,
        )
        hid = res.dedupe.hotspot_id
        transition(conn, hid, HotspotStatus.verified, actor=authority)
        task = tasks.create_task(
            conn, TaskCreateRequest(hotspot_ids=[hid], team_id=team.id, depot=DEPOT), authority
        )
        stop = task.stops[0]
        tasks.arrive(conn, task.id, stop.id, team, stop.lon, stop.lat)
    return {
        "hotspot": hid, "task": task.id, "stop": stop.id, "lat": stop.lat, "lon": stop.lon,
        "before_area": res.detection.plastic_area_frac, "team": team, "authority": authority,
    }


def submit(db_engine, site, photos=None, wide=None, close=None, **kw):
    with db_engine.begin() as conn:
        return before_after.submit_after(
            conn, site["task"], site["stop"], photos or after_photos(), site["team"],
            known_detections={"wide": wide or [], "close": close or []}, **kw,
        )


def hotspot_status(db_engine, hid):
    with db_engine.connect() as c:
        return c.execute(text("SELECT status FROM hotspots WHERE id = :h"), {"h": hid}).scalar()


def test_likely_cleaned_still_does_not_resolve(site, db_engine):
    rec = submit(db_engine, site)
    assert rec.verdict == Verdict.likely_cleaned
    assert rec.reduction_ratio == 1.0 and rec.after_count == 0
    assert rec.quality_flags["viewpoint_ok"] and rec.quality_flags["location_source"] == "check_in"
    assert rec.review_decision is None and rec.reviewed_by is None
    assert hotspot_status(db_engine, site["hotspot"]) == "cleanup_completed", "never auto-resolved"
    assert "No detections is not proof" in rec.quality_flags["note"]


def test_one_small_item_left_is_still_likely_cleaned(site, db_engine):
    rec = submit(db_engine, site, wide=boxes(site["before_area"] * 0.1, 1))
    assert rec.verdict == Verdict.likely_cleaned and rec.after_count == 1


def test_partial(site, db_engine):
    rec = submit(db_engine, site, wide=boxes(site["before_area"] * 0.4, 2))
    assert rec.verdict == Verdict.partial
    assert rec.reduction_ratio == pytest.approx(0.6, abs=0.01)


def test_big_reduction_with_several_items_left_is_only_partial(site, db_engine):
    rec = submit(db_engine, site, close=boxes(site["before_area"] * 0.1, 3))
    assert rec.verdict == Verdict.partial and rec.after_count == 3


def test_not_cleaned_uses_the_worse_photo(site, db_engine):
    # The wide shot looks clean; the close-up still shows most of the pile.
    rec = submit(db_engine, site, wide=[], close=boxes(site["before_area"] * 0.8, 5))
    assert rec.verdict == Verdict.not_cleaned
    assert rec.quality_flags["worse_photo"] == "close"
    assert rec.after_count == 5 and rec.reduction_ratio == pytest.approx(0.2, abs=0.01)


def test_blurred_photo_is_inconclusive(site, db_engine):
    rec = submit(db_engine, site, photos=after_photos(blur=8))
    assert rec.verdict == Verdict.inconclusive
    assert rec.quality_flags["blur_ok"] is False
    assert hotspot_status(db_engine, site["hotspot"]) == "cleanup_completed"


def test_photo_from_the_wrong_location_is_inconclusive(site, db_engine):
    # GPS at upload ~300 m north of the hotspot, though the photos themselves look clean.
    rec = submit(db_engine, site, lat=site["lat"] + 0.0027, lon=site["lon"])
    assert rec.verdict == Verdict.inconclusive
    assert rec.quality_flags["location_ok"] is False
    assert rec.quality_flags["location_distance_m"] > 250


def test_photo_of_a_different_place_is_inconclusive(site, db_engine):
    rec = submit(db_engine, site, photos=after_photos(seed=SITE_SEED + 1))
    assert rec.verdict == Verdict.inconclusive
    assert rec.quality_flags["viewpoint_ok"] is False


def test_gps_near_the_hotspot_passes_location(site, db_engine):
    rec = submit(db_engine, site, lat=site["lat"] + 0.0001, lon=site["lon"])
    assert rec.quality_flags["location_ok"] and rec.quality_flags["location_source"] == "gps"
    assert rec.verdict == Verdict.likely_cleaned


def test_upload_needs_a_check_in_first(site, db_engine):
    with db_engine.begin() as c:
        c.execute(text("UPDATE task_stops SET arrived_at = NULL"))
    with pytest.raises(TaskError) as err:
        submit(db_engine, site)
    assert err.value.status_code == 409


def test_retake_replaces_the_record_until_reviewed(site, db_engine):
    first = submit(db_engine, site, photos=after_photos(blur=8))
    second = submit(db_engine, site)
    assert second.id == first.id, "one before/after per stop (SPEC §7)"
    assert (first.verdict, second.verdict) == (Verdict.inconclusive, Verdict.likely_cleaned)
    with db_engine.connect() as c:
        n = c.execute(text("SELECT count(*) FROM before_after")).scalar()
        notes = c.execute(text("SELECT note FROM hotspot_events ORDER BY id")).scalars().all()
    assert n == 1 and "retaken" in notes[-1]


# ---------------------------------------------------------------------------
# The human gate, over HTTP
# ---------------------------------------------------------------------------


def upload(api, site, role="team", photos=None, **form):
    files = {k: (f"{k}.jpg", v, "image/jpeg") for k, v in (photos or after_photos()).items()}
    return api.post(
        f"/tasks/{site['task']}/stops/{site['stop']}/after",
        headers=auth_header(api, role), files=files, data=form,
    )


def review(api, ba_id, decision, role="authority", note=None):
    return api.post(
        f"/before-after/{ba_id}/review", headers=auth_header(api, role),
        json={"decision": decision, "note": note},
    )


@pytest.fixture
def clean_detector(monkeypatch):
    """After-photos: the detector finds no likely plastic."""
    monkeypatch.setattr(detector, "run_detection", lambda p: detector.summarise([], None))


def test_only_the_team_uploads_and_only_an_authority_reviews(api, site, clean_detector):
    assert upload(api, site, role="authority").status_code == 403
    assert upload(api, site, role="citizen").status_code == 403
    res = upload(api, site)
    assert res.status_code == 201, res.text
    ba = res.json()
    assert ba["verdict"] == "likely_cleaned" and ba["hotspot_status"] == "cleanup_completed"
    assert review(api, ba["id"], "confirm_resolved", role="team").status_code == 403
    assert review(api, ba["id"], "confirm_resolved", role="citizen").status_code == 403


def test_confirm_is_the_only_way_to_resolve(api, site, db_engine, clean_detector):
    ba = upload(api, site).json()
    pending = api.get("/before-after?pending=true", headers=auth_header(api, "authority")).json()
    assert [r["id"] for r in pending] == [ba["id"]]
    assert hotspot_status(db_engine, site["hotspot"]) == "cleanup_completed"

    res = review(api, ba["id"], "confirm_resolved", note="Photos match; site is clear.")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["hotspot_status"] == "resolved"
    assert body["before_after"]["review_decision"] == "confirm_resolved"
    assert body["before_after"]["reviewed_by_name"] == "Demo Ward Authority"
    assert body["event"]["to_status"] == "resolved"
    assert review(api, ba["id"], "confirm_resolved").status_code == 409, "reviewed once"

    detail = api.get(f"/hotspots/{site['hotspot']}", headers=auth_header(api, "authority")).json()
    ledger = detail["events"]
    assert ledger[-1]["to_status"] == "resolved"
    assert ledger[-1]["actor_name"] == "Demo Ward Authority"
    assert detail["before_after"]["id"] == ba["id"]
    assert api.get("/before-after?pending=true", headers=auth_header(api, "authority")).json() == []


def test_confirming_against_the_verdict_needs_a_note(api, site, monkeypatch):
    monkeypatch.setattr(detector, "run_detection", lambda p: fake_detection(5, 0.9))
    ba = upload(api, site).json()
    assert ba["verdict"] == "not_cleaned"
    assert review(api, ba["id"], "confirm_resolved").status_code == 422
    ok = review(api, ba["id"], "confirm_resolved", note="Crew removed the rest by hand.")
    assert ok.status_code == 200 and ok.json()["hotspot_status"] == "resolved"


def test_reject_sends_the_team_back(api, site, db_engine, clean_detector):
    ba = upload(api, site).json()
    res = review(api, ba["id"], "reject", note="Close-up still shows bags by the grate.")
    assert res.status_code == 200 and res.json()["hotspot_status"] == "cleanup_scheduled"
    task = api.get(f"/tasks/{site['task']}", headers=auth_header(api, "team")).json()
    stop = task["stops"][0]
    assert stop["arrived_at"] is None and stop["completed_at"] is None
    assert stop["review_decision"] == "reject" and task["status"] == "in_progress"

    assert upload(api, site).status_code == 409, "must check in again first"
    api.post(f"/tasks/{site['task']}/stops/{site['stop']}/arrive", headers=auth_header(api, "team"),
             json={"lat": site["lat"], "lon": site["lon"]})
    again = upload(api, site)
    assert again.status_code == 201 and again.json()["id"] == ba["id"]
    assert again.json()["review_decision"] is None, "a fresh claim awaits a fresh review"
    assert hotspot_status(db_engine, site["hotspot"]) == "cleanup_completed"


def test_resolved_hotspot_stays_on_the_map_and_reopens_on_a_new_report(
    api, site, db_engine, monkeypatch
):
    state = {"out": detector.summarise([], None)}
    monkeypatch.setattr(detector, "run_detection", lambda p: state["out"])
    ba = upload(api, site).json()
    review(api, ba["id"], "confirm_resolved")

    fc = api.get("/hotspots", headers=auth_header(api, "authority")).json()
    props = {f["properties"]["id"]: f["properties"] for f in fc["features"]}
    assert props[site["hotspot"]]["status"] == "resolved", "resolved stays on the map"
    before_returns = props[site["hotspot"]]["recurrence_returns"]

    state["out"] = fake_detection()
    res = api.post(
        "/reports", headers=auth_header(api, "citizen"),
        files={"image": ("again.jpg", photo(901), "image/jpeg")},
        data={"lat": site["lat"] + 0.00005, "lon": site["lon"], "source": "browser"},
    )
    assert res.status_code == 201, res.text
    detail = api.get(f"/hotspots/{site['hotspot']}", headers=auth_header(api, "authority")).json()
    assert detail["status"] == "ai_detected", "waste reported again: reopened"
    assert detail["recurrence_returns"] == before_returns + 1


def test_nothing_is_ever_resolved_without_a_confirm_review(api, site, db_engine, clean_detector):
    """Walk the whole flow and check the invariant on the audit log itself."""
    ba = upload(api, site).json()
    review(api, ba["id"], "reject")
    api.post(f"/tasks/{site['task']}/stops/{site['stop']}/arrive", headers=auth_header(api, "team"),
             json={"lat": site["lat"], "lon": site["lon"]})
    upload(api, site)
    with db_engine.connect() as c:
        resolved = c.execute(text(
            "SELECT count(*) FROM hotspot_events WHERE to_status = 'resolved'")).scalar()
    assert resolved == 0, "likely_cleaned twice, yet nothing resolved without a human"

    with db_engine.begin() as c:
        confirm = ReviewRequest(decision=ReviewDecision.confirm_resolved)
        with pytest.raises(WorkflowError):  # the status machine refuses the team
            before_after.review(c, ba["id"], confirm, site["team"])
    review(api, ba["id"], "confirm_resolved")
    with db_engine.connect() as c:
        rows = c.execute(text(
            """
            SELECT u.role, b.review_decision FROM hotspot_events e
            JOIN users u ON u.id = e.actor_id
            JOIN task_stops s ON s.hotspot_id = e.hotspot_id
            JOIN before_after b ON b.task_stop_id = s.id
            WHERE e.to_status = 'resolved'
            """)).all()
    assert rows == [("authority", "confirm_resolved")]

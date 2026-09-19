"""Stage 6: POST /reports end-to-end + DB-backed read endpoints, on real PostGIS.

Most tests pin the detector with a fake (monkeypatched run_detection) so scores are
exact; one test runs the real stub detector end to end.
"""

from __future__ import annotations

import io
import random
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from PIL import ExifTags, Image, ImageDraw, ImageFilter
from sqlalchemy import text

from app.schemas import AiStatus, Detection, DetectorOutput, LocationSource
from app.services import detector as detector_module
from app.services import pipeline
from app.services.hotspot_state import gather_score_inputs
from app.services.media import to_fs
from tests.conftest import auth_header

P = (73.8517, 18.5239)  # lon, lat — inside sample Ward A
CITIZEN_A = uuid.UUID("11111111-1111-4111-8111-111111111111")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def photo(seed: int, gps: tuple[float, float] | None = None, blur: float = 0) -> bytes:
    """A sharp synthetic JPEG; distinct seeds give distinct perceptual hashes."""
    rng = random.Random(seed)
    img = Image.new("RGB", (800, 600), (120, 130, 110))
    draw = ImageDraw.Draw(img)
    for _ in range(300):
        x, y = rng.randrange(800), rng.randrange(600)
        colour = tuple(rng.randrange(40, 220) for _ in range(3))
        draw.rectangle([x, y, x + rng.randrange(4, 40), y + rng.randrange(4, 40)], fill=colour)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    exif = img.getexif()
    if gps is not None:
        lat, lon = gps
        g = exif.get_ifd(ExifTags.IFD.GPSInfo)

        def dms(v):
            d = int(abs(v))
            m = int((abs(v) - d) * 60)
            return (float(d), float(m), (abs(v) - d - m / 60) * 3600)

        g.update({1: "N" if lat >= 0 else "S", 2: dms(lat),
                  3: "E" if lon >= 0 else "W", 4: dms(lon)})
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92, exif=exif)
    return buf.getvalue()


def fake_detection(n: int = 11, a: float = 0.12, conf: float = 0.71) -> DetectorOutput:
    if n == 0:
        return detector_module.summarise([], None)
    each = a / n
    dets = [
        Detection(class_name="plastic_bottle", confidence=conf, x1=0, y1=0, x2=10, y2=10,
                  area_frac=each)
        for _ in range(n)
    ]
    return DetectorOutput(
        plastic_count=n, plastic_area_frac=a, report_confidence=conf, detections=dets,
        annotated_jpg_path=None, ai_status=AiStatus.detected,
    )


@pytest.fixture
def fixed_detector(monkeypatch):
    """Pin the detector output: fixed_detector(n, a, conf) for subsequent reports."""
    state = {"out": fake_detection()}
    monkeypatch.setattr(detector_module, "run_detection", lambda path: state["out"])

    def _set(n=11, a=0.12, conf=0.71):
        state["out"] = fake_detection(n, a, conf)

    return _set


def offset(db_engine, point, metres, azimuth=0.0):
    with db_engine.connect() as c:
        x, y = c.execute(
            text(
                "SELECT ST_X(g), ST_Y(g) FROM (SELECT ST_Project(ST_SetSRID("
                "ST_MakePoint(:lon, :lat), 4326)::geography, :m, radians(:az))::geometry g) s"
            ),
            {"lon": point[0], "lat": point[1], "m": metres, "az": azimuth},
        ).one()
    return float(x), float(y)


def submit(api, headers, img: bytes, point=P, **form):
    """point=None submits no location at all (the EXIF / pin fallback path)."""
    data = dict(form)
    if point is not None:
        data.update({"lat": point[1], "lon": point[0], "source": "browser"})
    return api.post(
        "/reports", headers=headers, data=data,
        files={"image": ("photo.jpg", img, "image/jpeg")},
    )


def count(db_engine, table):
    with db_engine.connect() as c:
        return c.execute(text(f"SELECT count(*) FROM {table}")).scalar()


# ---------------------------------------------------------------------------
# Create + merge
# ---------------------------------------------------------------------------


def test_first_report_creates_a_hotspot(api, fixed_detector):
    res = submit(api, auth_header(api, "citizen"), photo(1))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["merged"] is False and body["hotspot"]["id"] > 0
    assert body["report"]["confidence_tier"] == "medium"
    assert body["message"].startswith("Likely plastic detected (11 items, medium confidence).")
    assert "Demo mode" in body["message"]  # stub mode is announced

    detail = api.get(f"/hotspots/{body['hotspot']['id']}", headers=auth_header(api, "authority"))
    assert detail.status_code == 200
    assert detail.json()["report_count"] == 1


def test_second_report_within_25m_merges(api, fixed_detector, db_engine):
    first = submit(api, auth_header(api, "citizen"), photo(1)).json()
    near = offset(db_engine, P, 25, 45)
    second = submit(api, auth_header(api, "citizen"), photo(2), point=near)
    assert second.status_code == 201, second.text
    assert second.json()["merged"] is True
    hid = first["hotspot"]["id"]
    assert second.json()["hotspot"]["id"] == hid
    detail = api.get(f"/hotspots/{hid}", headers=auth_header(api, "authority")).json()
    assert detail["report_count"] == 2
    assert [e["to_status"] for e in detail["events"]][:1] == ["ai_detected"]


def test_same_photo_twice_is_a_pHash_duplicate(api, fixed_detector):
    headers = auth_header(api, "citizen")
    first = submit(api, headers, photo(5)).json()
    again = submit(api, headers, photo(5)).json()
    assert again["duplicate_of"] == first["report"]["id"]
    assert "not counted as new evidence" in again["message"]


# ---------------------------------------------------------------------------
# The golden case through the whole pipeline
# ---------------------------------------------------------------------------


@pytest.fixture
def golden_geo(db_engine):
    """A drain exactly 25 m and a market exactly 120 m from P; nothing else near."""
    drain_pt = offset(db_engine, P, 25, 0)
    market_pt = offset(db_engine, P, 120, 90)
    with db_engine.begin() as c:
        c.execute(text("TRUNCATE geo_features RESTART IDENTITY"))
        c.execute(
            text(
                "INSERT INTO geo_features (kind, name, source, geom) VALUES "
                "('drain', 'golden drain', 'manual', ST_SetSRID(ST_MakeLine("
                "ST_MakePoint(:x - 0.002, :y), ST_MakePoint(:x + 0.002, :y)), 4326)),"
                "('market', 'golden market', 'manual', ST_SetSRID(ST_MakePoint(:mx, :my), 4326))"
            ),
            {"x": drain_pt[0], "y": drain_pt[1], "mx": market_pt[0], "my": market_pt[1]},
        )


def _users(db_engine, n):
    ids = [uuid.uuid4() for _ in range(n)]
    with db_engine.begin() as c:
        for i, uid in enumerate(ids):
            c.execute(
                text("INSERT INTO users (id, name, role) VALUES (:id, :n, 'citizen')"),
                {"id": uid, "n": f"golden reporter {i}"},
            )
    return ids


def test_pipeline_reproduces_the_golden_impact_73_1(api, db_engine, fixed_detector, golden_geo):
    """n=11 a=0.12 (S=0.632), D=4 C=1 (R=0.75), drain 25 m + market 120 m (Se=0.93),
    6 days open (P=0.4286), conf 0.71, 3 reporters, reliability 0.5."""
    a, b, c = _users(db_engine, 3)
    t0 = datetime(2026, 8, 1, 8, 0, tzinfo=UTC)
    img = iter(photo(s) for s in range(100, 110))

    def report(reporter, at):
        with db_engine.begin() as conn:
            return pipeline.process_report(
                conn, reporter_id=reporter, image_bytes=next(img), lat=P[1], lon=P[0],
                source=LocationSource.browser, created_at=at,
            )

    first = report(a, t0)  # day 1: creates the hotspot
    hid = first.dedupe.hotspot_id
    with db_engine.begin() as conn:  # an authority resolved it on day 3
        conn.execute(text("UPDATE hotspots SET status = 'resolved' WHERE id = :h"), {"h": hid})
        conn.execute(
            text(
                "INSERT INTO hotspot_events (hotspot_id, from_status, to_status, created_at)"
                " VALUES (:h, 'cleanup_completed', 'resolved', :at)"
            ),
            {"h": hid, "at": t0 + timedelta(days=2)},
        )
    reopen = report(b, datetime(2026, 8, 9, 8, 0, tzinfo=UTC))  # C = 1
    report(c, datetime(2026, 8, 14, 20, 0, tzinfo=UTC))
    last = report(c, datetime(2026, 8, 15, 8, 0, tzinfo=UTC))  # same reporter, <24 h
    assert reopen.dedupe.reopened and last.dedupe.hotspot_id == hid

    detail = api.get(f"/hotspots/{hid}", headers=auth_header(api, "authority")).json()
    sb = detail["score_breakdown"]
    assert round(sb["impact_score"], 1) == 73.1 and sb["priority_band"] == "critical"
    assert round(sb["evidence_score"], 3) == 0.755 and sb["evidence_band"] == "strong"
    assert detail["geo_context"]["d_drain_m"] == pytest.approx(25, abs=0.5)
    assert detail["geo_context"]["d_market_m"] == pytest.approx(120, abs=0.5)
    assert detail["unique_reporters"] == 3 and detail["recurrence_returns"] == 1

    # dedupe's SQL and the scorer's Python must count reporters identically.
    with db_engine.connect() as conn:
        snap = gather_score_inputs(conn, hid, datetime(2026, 8, 15, 8, 0, tzinfo=UTC))
    assert snap.inputs.unique_reporters == detail["unique_reporters"]
    assert snap.inputs.distinct_days == 4 and snap.inputs.days_open == pytest.approx(6)


# ---------------------------------------------------------------------------
# Rejections and location handling
# ---------------------------------------------------------------------------


def test_not_detected_report_is_recorded_but_joins_no_hotspot(api, fixed_detector, db_engine):
    fixed_detector(n=0)
    headers = auth_header(api, "citizen")
    res = submit(api, headers, photo(7))
    assert res.status_code == 201
    body = res.json()
    assert body["hotspot"] is None and body["merged"] is False
    assert body["message"].startswith("No likely plastic was found")
    assert count(db_engine, "hotspots") == 0
    mine = api.get("/reports/mine", headers=headers).json()
    assert mine[0]["ai_status"] == "not_detected" and mine[0]["hotspot_id"] is None


def test_blurry_photo_is_rejected_before_anything_is_stored(api, fixed_detector, db_engine):
    res = submit(api, auth_header(api, "citizen"), photo(8, blur=12))
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "low_quality"
    assert "retake" in res.json()["detail"]["message"]
    assert count(db_engine, "reports") == 0


def test_exif_gps_is_used_when_the_form_has_no_location(api, fixed_detector):
    res = submit(api, auth_header(api, "citizen"), photo(9, gps=(P[1], P[0])), point=None)
    assert res.status_code == 201, res.text
    rep = res.json()["report"]
    assert rep["location_source"] == "exif"
    assert (rep["lat"], rep["lon"]) == pytest.approx((P[1], P[0]), abs=1e-5)


def test_no_location_anywhere_asks_for_a_pin(api, fixed_detector):
    res = submit(api, auth_header(api, "citizen"), photo(10), point=None)
    assert res.status_code == 422 and res.json()["detail"]["code"] == "no_location"


def test_stored_photo_has_exif_gps_stripped(api, fixed_detector):
    res = submit(api, auth_header(api, "citizen"), photo(11, gps=(P[1], P[0])), point=None)
    stored = to_fs(res.json()["report"]["image_path"])
    with Image.open(stored) as img:
        assert not img.getexif().get_ifd(ExifTags.IFD.GPSInfo)


def test_low_accuracy_is_flagged(api, fixed_detector):
    res = submit(api, auth_header(api, "citizen"), photo(12), accuracy=60).json()
    assert res["low_accuracy"] is True and res["report"]["low_accuracy"] is True
    assert "Location accuracy was low" in res["message"]


def test_not_an_image_is_422(api):
    res = api.post(
        "/reports", headers=auth_header(api, "citizen"),
        data={"lat": P[1], "lon": P[0], "source": "browser"},
        files={"image": ("x.jpg", b"definitely not a jpeg", "image/jpeg")},
    )
    assert res.status_code == 422 and res.json()["detail"]["code"] == "not_an_image"


# ---------------------------------------------------------------------------
# Real stub detector, end to end
# ---------------------------------------------------------------------------


def test_stub_detector_end_to_end_is_consistent_and_simulated(api):
    res = submit(api, auth_header(api, "citizen"), photo(21))
    assert res.status_code == 201, res.text
    body = res.json()
    rep = body["report"]
    assert rep["is_simulated"] is True  # stub output is fabricated (CLAUDE.md §2.2)
    assert len(body["detections"]) >= rep["plastic_count"]
    if rep["ai_status"] == "detected":
        assert body["hotspot"]["is_simulated"] is True
        assert rep["annotated_jpg_path"].startswith("uploads/annotated/")
        assert api.get("/" + rep["annotated_jpg_path"]).status_code == 200


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------


def test_hotspots_geojson_shape_and_band_filter(api, fixed_detector, db_engine):
    headers = auth_header(api, "citizen")
    submit(api, headers, photo(30))
    fixed_detector(n=1, a=0.01, conf=0.4)
    submit(api, headers, photo(31), point=offset(db_engine, P, 400, 90))
    auth = auth_header(api, "authority")

    body = api.get("/hotspots", headers=auth).json()
    assert body["type"] == "FeatureCollection" and len(body["features"]) == 2
    for f in body["features"]:
        assert f["geometry"]["type"] == "Point"
        for key in ("priority_band", "evidence_score", "is_simulated"):
            assert key in f["properties"]
    bands = {f["properties"]["priority_band"] for f in body["features"]}
    for band in bands:
        got = api.get(f"/hotspots?band={band}", headers=auth).json()["features"]
        assert got and all(f["properties"]["priority_band"] == band for f in got)


def test_as_of_recomputes_without_mutating_stored_rows(api, db_engine, fixed_detector):
    a, b = _users(db_engine, 2)
    t0 = datetime(2026, 7, 1, 9, 0, tzinfo=UTC)
    for i, (who, at) in enumerate([(a, t0), (b, t0 + timedelta(days=10))]):
        with db_engine.begin() as conn:
            pipeline.process_report(
                conn, reporter_id=who, image_bytes=photo(40 + i), lat=P[1], lon=P[0],
                source=LocationSource.browser, created_at=at,
            )
    auth = auth_header(api, "authority")
    stored = api.get("/hotspots", headers=auth).json()["features"][0]["properties"]

    before = api.get(
        "/hotspots", params={"as_of": (t0 - timedelta(days=1)).isoformat()}, headers=auth
    )
    assert before.json()["features"] == []  # did not exist yet

    early = api.get(
        "/hotspots", params={"as_of": (t0 + timedelta(days=1)).isoformat()}, headers=auth
    ).json()["features"][0]["properties"]
    assert early["report_count"] == 1 and early["status"] == "ai_detected"
    assert early["impact_score"] < stored["impact_score"]

    again = api.get("/hotspots", headers=auth).json()["features"][0]["properties"]
    assert again == stored, "as_of must never write to stored rows"


def test_report_detail_ownership(api, fixed_detector):
    mine = submit(api, auth_header(api, "citizen"), photo(50)).json()["report"]["id"]
    assert api.get(f"/reports/{mine}", headers=auth_header(api, "citizen")).status_code == 200
    assert api.get(f"/reports/{mine}", headers=auth_header(api, "authority")).status_code == 200
    assert api.get(f"/reports/{mine}", headers=auth_header(api, "team")).status_code == 403
    other = api.post("/auth/demo-login", json={
        "user_id": "11111111-1111-4111-8111-111111111112"}).json()["token"]
    res = api.get(f"/reports/{mine}", headers={"Authorization": f"Bearer {other}"})
    assert res.status_code == 404


def test_geo_layers_and_wards_from_the_database(api, db_engine):
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "load_geo", Path(__file__).resolve().parents[2] / "gis" / "load_geo.py"
    )
    load_geo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(load_geo)
    with db_engine.begin() as conn:
        load_geo.load_all(conn)

    headers = auth_header(api, "citizen")
    drains = api.get("/geo/layers?kind=drain", headers=headers).json()
    assert len(drains["features"]) == 2
    assert all(f["properties"]["kind"] == "drain" for f in drains["features"])
    assert drains["features"][0]["geometry"]["type"] == "LineString"
    wards = api.get("/wards", headers=headers).json()
    assert [w["properties"]["name"] for w in wards["features"]] == ["Ward A", "Ward B", "Ward C"]


def test_media_route_rejects_path_traversal(api):
    assert api.get("/uploads/../app/main.py").status_code == 404
    assert api.get("/uploads/reports/nope.jpg").status_code == 404

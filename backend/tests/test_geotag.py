"""Geotag stamp: what a photo says about where and when it was taken.

Runs without a database. The capture time is only ever trusted when the photo also
records its timezone — a naive EXIF time stored in a timestamptz column would shift
silently by the server's offset and state a moment the photo never had.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.services.pipeline import exif_captured_at, exif_gps

PUNE_GPS = ("N", (18.0, 31.0, 13.44), "E", (73.0, 51.0, 24.12))  # 18.5204, 73.8567


def photo_bytes(taken: str | None = None, offset: str | None = None, gps=None) -> bytes:
    img = Image.new("RGB", (96, 72), (90, 110, 90))
    exif = Image.Exif()
    if taken or offset:
        ifd = exif.get_ifd(0x8769)
        if taken:
            ifd[0x9003] = taken
        if offset:
            ifd[0x9011] = offset
    if gps:
        g = exif.get_ifd(0x8825)
        g[1], g[2], g[3], g[4] = gps
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()


def as_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


# --------------------------------------------------------------------------
# exif_captured_at
# --------------------------------------------------------------------------


def test_capture_time_with_an_offset_is_an_exact_moment():
    taken = exif_captured_at(as_image(photo_bytes("2026:09:20 14:03:11", "+05:30")))
    assert taken == datetime(2026, 9, 20, 8, 33, 11, tzinfo=UTC)
    assert taken.utcoffset() is not None


def test_capture_time_without_an_offset_is_refused_not_guessed():
    """No zone in the photo means we do not know the moment; never assume one."""
    assert exif_captured_at(as_image(photo_bytes("2026:09:20 14:03:11"))) is None


@pytest.mark.parametrize(
    "taken",
    ["2000:01:01 00:00:00", "1970:01:01 00:00:00"],  # clocks that were never set
)
def test_an_unset_camera_clock_is_not_evidence(taken):
    assert exif_captured_at(as_image(photo_bytes(taken, "+00:00"))) is None


def test_a_capture_time_in_the_future_is_not_evidence():
    future = (datetime.now(UTC) + timedelta(days=30)).strftime("%Y:%m:%d %H:%M:%S")
    assert exif_captured_at(as_image(photo_bytes(future, "+00:00"))) is None


def test_no_exif_at_all_gives_no_capture_time():
    assert exif_captured_at(as_image(photo_bytes())) is None


def test_gps_is_read_from_exif():
    lat, lon = exif_gps(as_image(photo_bytes(gps=PUNE_GPS)))
    assert lat == pytest.approx(18.5204, abs=1e-4)
    assert lon == pytest.approx(73.8567, abs=1e-4)


# --------------------------------------------------------------------------
# POST /detect carries what the photo says, before anything is stored
# --------------------------------------------------------------------------


@pytest.fixture
def client(set_env, tmp_path):
    set_env(DETECTOR_MODE="stub", UPLOAD_DIR=tmp_path / "uploads")
    return TestClient(app)


def test_detect_returns_the_photos_own_location_and_time(client):
    data = photo_bytes("2026:09:20 14:03:11", "+05:30", PUNE_GPS)
    body = client.post("/detect", files={"image": ("p.jpg", data, "image/jpeg")}).json()
    assert body["exif_lat"] == pytest.approx(18.5204, abs=1e-4)
    assert body["exif_lon"] == pytest.approx(73.8567, abs=1e-4)
    assert datetime.fromisoformat(body["captured_at"]) == datetime(
        2026, 9, 20, 8, 33, 11, tzinfo=UTC
    )


def test_detect_reports_nothing_rather_than_inventing_a_geotag(client):
    body = client.post(
        "/detect", files={"image": ("p.jpg", photo_bytes(), "image/jpeg")}
    ).json()
    assert body["exif_lat"] is None and body["exif_lon"] is None
    assert body["captured_at"] is None


def test_detect_gives_every_box_a_tier_in_the_same_order(client):
    """§2.7: the preview labels each box, so each box needs its own tier."""
    body = client.post(
        "/detect", files={"image": ("p.jpg", photo_bytes(), "image/jpeg")}
    ).json()
    boxes, tiers = body["result"]["detections"], body["detection_tiers"]
    assert len(tiers) == len(boxes)
    assert set(tiers) <= {"low", "medium", "high"}

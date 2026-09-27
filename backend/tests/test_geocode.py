"""Reverse geocoding and the photo's own GPS in /detect. No network: urlopen is mocked."""

from __future__ import annotations

import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.services import geocode
from app.services.geocode import format_address, reverse_geocode

# A trimmed real Nominatim jsonv2 response for Navle Bridge, Pune.
NAVLE = {
    "display_name": "Navle Bridge, Vadgaon Budruk, Pune City, Pune, Maharashtra, 411041, India",
    "address": {
        "road": "Navle Bridge",
        "suburb": "Vadgaon Budruk",
        "city": "Pune",
        "state": "Maharashtra",
        "postcode": "411041",
        "country": "India",
    },
}


@pytest.fixture(autouse=True)
def _fresh_cache():
    geocode._cached.cache_clear()
    geocode._last_call = 0.0
    yield
    geocode._cached.cache_clear()


def _fake_urlopen(payload, calls):
    def fake(req, timeout=None):
        calls.append(req.full_url)
        return io.BytesIO(json.dumps(payload).encode())
    return fake


def test_address_is_place_area_city_not_the_whole_display_name():
    assert format_address(NAVLE) == "Navle Bridge, Vadgaon Budruk, Pune"


def test_no_structured_address_falls_back_to_leading_display_parts():
    assert format_address({"display_name": "Mula River, Pune, Maharashtra, India"}) == (
        "Mula River, Pune, Maharashtra"
    )
    assert format_address({}) is None


def test_duplicate_parts_are_not_repeated():
    got = format_address({"address": {"road": "Pune", "suburb": "Pune", "city": "Pune"}})
    assert got == "Pune"


def test_lookup_is_cached_per_spot(monkeypatch, set_env):
    set_env(GEOCODE_ENABLED="true")
    calls: list[str] = []
    monkeypatch.setattr(geocode.urllib.request, "urlopen", _fake_urlopen(NAVLE, calls))
    monkeypatch.setattr(geocode.time, "sleep", lambda s: None)
    assert reverse_geocode(18.491234, 73.820111) == "Navle Bridge, Vadgaon Budruk, Pune"
    assert reverse_geocode(18.491234, 73.820111) == "Navle Bridge, Vadgaon Budruk, Pune"
    assert len(calls) == 1, "the same spot must be looked up once"
    assert "format=jsonv2" in calls[0]


def test_network_failure_is_no_address_not_an_error(monkeypatch, set_env):
    set_env(GEOCODE_ENABLED="true")

    def boom(req, timeout=None):
        raise TimeoutError("nominatim slow")

    monkeypatch.setattr(geocode.urllib.request, "urlopen", boom)
    assert reverse_geocode(18.49, 73.82) is None


def test_disabled_never_touches_the_network(monkeypatch, set_env):
    set_env(GEOCODE_ENABLED="false")
    monkeypatch.setattr(geocode.urllib.request, "urlopen", lambda *a, **k: pytest.fail("called"))
    assert reverse_geocode(18.49, 73.82) is None


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------


@pytest.fixture
def client(set_env, tmp_path):
    set_env(DETECTOR_MODE="stub", UPLOAD_DIR=tmp_path / "uploads", GEOCODE_ENABLED="false")
    c = TestClient(app)
    token = c.post("/auth/demo-login", json={"role": "citizen"}).json()["token"]
    c.headers["Authorization"] = f"Bearer {token}"
    return c


def test_reverse_endpoint_returns_the_address(client, monkeypatch):
    monkeypatch.setattr("app.routers.geo.reverse_geocode", lambda lat, lon: "Navle Bridge, Pune")
    body = client.get("/geo/reverse", params={"lat": 18.49, "lon": 73.82}).json()
    assert body["address"] == "Navle Bridge, Pune"
    assert "OpenStreetMap" in body["attribution"]


def test_reverse_endpoint_rejects_impossible_coordinates(client):
    assert client.get("/geo/reverse", params={"lat": 123, "lon": 73.82}).status_code == 422


def _photo(gps=None) -> bytes:
    img = Image.new("RGB", (96, 72), (90, 110, 90))
    exif = Image.Exif()
    if gps:
        g = exif.get_ifd(0x8825)
        g[1], g[2], g[3], g[4] = gps
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()


def test_detect_returns_the_photos_own_gps(client):
    pune = ("N", (18.0, 31.0, 13.44), "E", (73.0, 51.0, 24.12))  # 18.5204, 73.8567
    body = client.post("/detect", files={"image": ("p.jpg", _photo(pune), "image/jpeg")}).json()
    assert body["exif_lat"] == pytest.approx(18.5204, abs=1e-4)
    assert body["exif_lon"] == pytest.approx(73.8567, abs=1e-4)


def test_detect_without_gps_says_so_instead_of_guessing(client):
    body = client.post("/detect", files={"image": ("p.jpg", _photo(), "image/jpeg")}).json()
    assert body["exif_lat"] is None and body["exif_lon"] is None

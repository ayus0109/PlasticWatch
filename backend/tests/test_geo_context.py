"""Geo-context distances vs an INDEPENDENT geodesic computation, ±5 m (SPEC §10/§17).

The expected values are not produced by PostGIS. The sample drains and lake are
axis-aligned, so the nearest point on each is known analytically (clamp the test
point onto the segment / rectangle), and the distance to it is computed with the
Vincenty inverse formula on the WGS84 ellipsoid, implemented here in pure Python.

SPEC §17 also asks for a manual check of 5 points against QGIS; that remains a team
step once real OSM data is loaded.
"""

from __future__ import annotations

import importlib.util
import math
from pathlib import Path

import pytest
from sqlalchemy import text

from app.services.geo_context import nearest_distances, ward_for

TOLERANCE_M = 5.0

GIS_DIR = Path(__file__).resolve().parents[2] / "gis"


def _load_geo_module():
    spec = importlib.util.spec_from_file_location("load_geo", GIS_DIR / "load_geo.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


load_geo = _load_geo_module()


# ---------------------------------------------------------------------------
# Independent geodesic oracle: Vincenty inverse on WGS84
# ---------------------------------------------------------------------------


def vincenty_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    a = 6378137.0
    f = 1 / 298.257223563
    b = (1 - f) * a
    L = math.radians(lon2 - lon1)
    U1 = math.atan((1 - f) * math.tan(math.radians(lat1)))
    U2 = math.atan((1 - f) * math.tan(math.radians(lat2)))
    sinU1, cosU1, sinU2, cosU2 = math.sin(U1), math.cos(U1), math.sin(U2), math.cos(U2)

    lam = L
    for _ in range(200):
        sin_lam, cos_lam = math.sin(lam), math.cos(lam)
        sin_sigma = math.hypot(cosU2 * sin_lam, cosU1 * sinU2 - sinU1 * cosU2 * cos_lam)
        if sin_sigma == 0:
            return 0.0
        cos_sigma = sinU1 * sinU2 + cosU1 * cosU2 * cos_lam
        sigma = math.atan2(sin_sigma, cos_sigma)
        sin_alpha = cosU1 * cosU2 * sin_lam / sin_sigma
        cos2_alpha = 1 - sin_alpha**2
        cos_2sm = cos_sigma - 2 * sinU1 * sinU2 / cos2_alpha if cos2_alpha else 0.0
        C = f / 16 * cos2_alpha * (4 + f * (4 - 3 * cos2_alpha))
        lam_prev = lam
        lam = L + (1 - C) * f * sin_alpha * (
            sigma + C * sin_sigma * (cos_2sm + C * cos_sigma * (-1 + 2 * cos_2sm**2))
        )
        if abs(lam - lam_prev) < 1e-12:
            break

    u2 = cos2_alpha * (a * a - b * b) / (b * b)
    A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
    d_sigma = B * sin_sigma * (
        cos_2sm
        + B / 4 * (
            cos_sigma * (-1 + 2 * cos_2sm**2)
            - B / 6 * cos_2sm * (-3 + 4 * sin_sigma**2) * (-3 + 4 * cos_2sm**2)
        )
    )
    return b * A * (sigma - d_sigma)


def test_oracle_sanity():
    """0.001° of latitude near 18.5°N is ~110.7 m on WGS84."""
    assert vincenty_m(73.85, 18.52, 73.85, 18.521) == pytest.approx(110.7, abs=0.2)


# ---------------------------------------------------------------------------
# Analytic nearest points on the axis-aligned sample geometry
# (must mirror gis/processed/*.geojson)
# ---------------------------------------------------------------------------


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def to_ew_segment(p, lat0, lon_a, lon_b):
    return vincenty_m(p[0], p[1], _clamp(p[0], lon_a, lon_b), lat0)


def to_ns_segment(p, lon0, lat_a, lat_b):
    return vincenty_m(p[0], p[1], lon0, _clamp(p[1], lat_a, lat_b))


def to_rect(p, lon_a, lon_b, lat_a, lat_b):
    if lon_a <= p[0] <= lon_b and lat_a <= p[1] <= lat_b:
        return 0.0
    return vincenty_m(p[0], p[1], _clamp(p[0], lon_a, lon_b), _clamp(p[1], lat_a, lat_b))


SCHOOL = (73.8507, 18.5284)
HOSPITAL = (73.8527, 18.5144)
MARKET = (73.8522, 18.5214)


def expected(p):
    return {
        "d_drain_m": min(
            to_ew_segment(p, 18.5234, 73.8467, 73.8557),  # Sample Nala 1
            to_ns_segment(p, 73.8627, 18.5104, 18.5224),  # Sample Nala 2
        ),
        "d_water_m": to_rect(p, 73.8587, 73.8612, 18.5264, 18.5294),
        "d_school_m": vincenty_m(*p, *SCHOOL),
        "d_hospital_m": vincenty_m(*p, *HOSPITAL),
        "d_market_m": vincenty_m(*p, *MARKET),
    }


# (label, (lon, lat), expected ward id)
POINTS = [
    ("north of drain 1, ward A", (73.8517, 18.5239), 1),
    ("east of drain 2, ward B", (73.8635, 18.5154), 2),
    ("west of the lake, past both drain ends", (73.8577, 18.5279), 2),
    ("inside the lake", (73.8597, 18.5274), 2),
    ("south of drain 1, ward C", (73.8487, 18.5174), 3),
]


@pytest.fixture
def loaded(conn):
    counts = load_geo.load_all(conn)
    assert counts["wards"] == 3
    assert counts["geo_features"] == {
        "drain": 2, "water": 1, "school": 1, "hospital": 1, "market": 1
    }
    return conn


@pytest.mark.parametrize(("label", "point", "ward"), POINTS, ids=[p[0] for p in POINTS])
def test_distances_match_independent_geodesic_within_5m(loaded, label, point, ward):
    got = nearest_distances(loaded, point)
    want = expected(point)
    for key, value in want.items():
        assert got[key] is not None, key
        assert abs(got[key] - value) <= TOLERANCE_M, (
            f"{label}: {key} PostGIS={got[key]:.2f} m vs oracle={value:.2f} m"
        )


@pytest.mark.parametrize(("label", "point", "ward"), POINTS, ids=[p[0] for p in POINTS])
def test_ward_lookup(loaded, label, point, ward):
    assert ward_for(loaded, point) == ward


def test_point_inside_lake_is_zero_metres(loaded):
    assert nearest_distances(loaded, (73.8597, 18.5274))["d_water_m"] == 0.0


def test_point_outside_all_wards_is_none(loaded):
    assert ward_for(loaded, (73.90, 18.56)) is None


def test_missing_kind_is_none_not_zero(loaded):
    loaded.execute(text("DELETE FROM geo_features WHERE kind = 'market'"))
    got = nearest_distances(loaded, (73.8517, 18.5239))
    assert got["d_market_m"] is None
    assert got["d_drain_m"] is not None


def test_loader_is_idempotent(loaded):
    again = load_geo.load_all(loaded)
    assert again["geo_features"]["drain"] == 2
    total = loaded.execute(text("SELECT count(*) FROM geo_features")).scalar()
    wards = loaded.execute(text("SELECT count(*) FROM wards")).scalar()
    assert (total, wards) == (6, 3)


def test_loader_respects_demo_area_bbox(conn):
    # Box around ward A only: drain 2, the lake and the hospital fall outside it.
    ward_a_box = (73.8447, 18.5204, 73.8566, 18.5324)
    counts = load_geo.load_all(conn, bbox=ward_a_box)
    assert counts["geo_features"] == {"drain": 1, "school": 1, "market": 1}


def test_parse_bbox_treats_zero_as_unset():
    assert load_geo.parse_bbox("0,0,0,0") is None
    assert load_geo.parse_bbox(None) is None
    assert load_geo.parse_bbox("73.8,18.5,73.9,18.6") == (73.8, 18.5, 73.9, 18.6)

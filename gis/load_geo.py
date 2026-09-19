"""Load geo features + wards into PostGIS (SPEC §5, §10).

Reads gis/processed/*.geojson (features with properties kind, name, source) and
gis/wards.geojson (properties id, name). Pulled from Overpass ONCE and stored — this
script never calls Overpass or any network service.

Idempotent:
  * geo_features is truncated and reloaded (nothing references it).
  * wards are UPSERTED by id. Truncating wards would cascade into users/hotspots
    through their foreign keys, so it is never done here.

Reads DATABASE_URL and DEMO_AREA_BBOX from the environment. When DEMO_AREA_BBOX is
set, features entirely outside it are skipped with a warning; when it is unset
("0,0,0,0", OPEN ITEM SPEC §20.1) everything is loaded.

NOTE: hotspot distances are computed once at hotspot create/update. After reloading
geo features, existing hotspots keep their old distances until they are rescored.

Usage:  python gis/load_geo.py            (from the repo root or the api container)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection

GIS_DIR = Path(__file__).resolve().parent
PROCESSED_DIR = GIS_DIR / "processed"
WARDS_PATH = GIS_DIR / "wards.geojson"

VALID_KINDS = {"drain", "water", "school", "hospital", "market"}
VALID_SOURCES = {"osm", "manual"}


def parse_bbox(raw: str | None) -> tuple[float, float, float, float] | None:
    """'min_lon,min_lat,max_lon,max_lat' -> tuple, or None when unset/zero."""
    if not raw:
        return None
    parts = [float(p) for p in raw.split(",")]
    if len(parts) != 4:
        raise ValueError(f"DEMO_AREA_BBOX must have 4 numbers, got {raw!r}")
    if all(p == 0 for p in parts):
        return None
    return parts[0], parts[1], parts[2], parts[3]


def read_features(paths: list[Path]) -> list[dict]:
    features = []
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        for feat in data.get("features", []):
            feat.setdefault("properties", {})
            feat["_file"] = path.name
            features.append(feat)
    return features


def load_geo_features(
    conn: Connection, features: list[dict], bbox: tuple[float, float, float, float] | None
) -> dict[str, int]:
    conn.execute(text("TRUNCATE geo_features RESTART IDENTITY"))
    counts: dict[str, int] = {}
    for feat in features:
        props = feat["properties"]
        kind = props.get("kind")
        source = props.get("source", "osm")
        if kind not in VALID_KINDS:
            print(f"  skip {feat['_file']}: unknown kind {kind!r}", file=sys.stderr)
            continue
        if source not in VALID_SOURCES:
            print(f"  skip {feat['_file']}: unknown source {source!r}", file=sys.stderr)
            continue

        geom = json.dumps(feat["geometry"])
        if bbox is not None:
            inside = conn.execute(
                text(
                    "SELECT ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326),"
                    " ST_MakeEnvelope(:x1, :y1, :x2, :y2, 4326))"
                ),
                {"g": geom, "x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]},
            ).scalar()
            if not inside:
                print(f"  skip {props.get('name')!r}: outside DEMO_AREA_BBOX", file=sys.stderr)
                continue

        conn.execute(
            text(
                "INSERT INTO geo_features (kind, name, source, geom)"
                " VALUES (:kind, :name, :source, ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326))"
            ),
            {"kind": kind, "name": props.get("name"), "source": source, "g": geom},
        )
        counts[kind] = counts.get(kind, 0) + 1
    return counts


def load_wards(conn: Connection, wards: list[dict]) -> int:
    loaded = 0
    for feat in wards:
        props = feat["properties"]
        if "id" not in props or "name" not in props:
            print("  skip ward: needs integer 'id' and 'name' properties", file=sys.stderr)
            continue
        conn.execute(
            text(
                "INSERT INTO wards (id, name, geom)"
                " VALUES (:id, :name, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326)))"
                " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom"
            ),
            {"id": int(props["id"]), "name": props["name"], "g": json.dumps(feat["geometry"])},
        )
        loaded += 1
    # Explicit ids bypass the serial; move it past them so later inserts don't collide.
    conn.execute(
        text(
            "SELECT setval(pg_get_serial_sequence('wards', 'id'), COALESCE(MAX(id), 1))"
            " FROM wards"
        )
    )
    return loaded


def load_all(conn: Connection, bbox: tuple[float, float, float, float] | None = None) -> dict:
    """Load everything in one transaction-bound connection. Returns counts."""
    features = read_features(sorted(PROCESSED_DIR.glob("*.geojson")))
    wards = read_features([WARDS_PATH]) if WARDS_PATH.exists() else []
    return {
        "wards": load_wards(conn, wards),
        "geo_features": load_geo_features(conn, features, bbox),
    }


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 2
    bbox = parse_bbox(os.environ.get("DEMO_AREA_BBOX"))
    if bbox is None:
        print("DEMO_AREA_BBOX unset (OPEN ITEM SPEC 20.1) - loading all features.")

    engine = create_engine(url, future=True)
    with engine.begin() as conn:
        counts = load_all(conn, bbox)

    print(f"wards loaded: {counts['wards']}")
    for kind in sorted(VALID_KINDS):
        print(f"geo_features {kind:>8}: {counts['geo_features'].get(kind, 0)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

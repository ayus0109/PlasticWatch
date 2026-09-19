"""Read models for geo layers and wards (GET /geo/layers, GET /wards).

Layers are served from PostGIS (loaded once by gis/load_geo.py) — never fetched
from Overpass at request time (SPEC §5).
"""

from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.schemas import (
    GeoFeature,
    GeoFeatureCollection,
    GeoFeatureKind,
    WardFeature,
    WardFeatureCollection,
)


def layers(conn: Connection, kind: GeoFeatureKind | None) -> GeoFeatureCollection:
    sql = "SELECT id, kind, name, source, ST_AsGeoJSON(geom, 6) AS g FROM geo_features"
    params = {}
    if kind is not None:
        sql += " WHERE kind = :kind"
        params["kind"] = kind.value
    rows = conn.execute(text(sql + " ORDER BY id"), params).all()
    return GeoFeatureCollection(
        features=[
            GeoFeature(
                id=r.id,
                geometry=json.loads(r.g),
                properties={"id": r.id, "kind": r.kind, "name": r.name, "source": r.source},
            )
            for r in rows
        ]
    )


_WARDS = text(
    """
    SELECT w.id, w.name, ST_AsGeoJSON(w.geom, 6) AS g,
           count(h.id) AS hotspot_count,
           count(h.id) FILTER (WHERE h.status NOT IN ('resolved', 'false_positive'))
               AS open_count,
           count(h.id) FILTER (WHERE h.status = 'resolved') AS resolved_count,
           avg(h.impact_score) FILTER (WHERE h.status NOT IN ('resolved', 'false_positive'))
               AS avg_impact,
           COALESCE(bool_or(EXISTS (
               SELECT 1 FROM reports r WHERE r.hotspot_id = h.id AND r.is_simulated
           )), false) AS is_simulated
    FROM wards w LEFT JOIN hotspots h ON h.ward_id = w.id
    GROUP BY w.id ORDER BY w.id
    """
)


def wards(conn: Connection) -> WardFeatureCollection:
    return WardFeatureCollection(
        features=[
            WardFeature(
                id=r.id,
                geometry=json.loads(r.g),
                properties={
                    "id": r.id,
                    "name": r.name,
                    "hotspot_count": r.hotspot_count,
                    "open_count": r.open_count,
                    "resolved_count": r.resolved_count,
                    "avg_impact": r.avg_impact,
                    "is_simulated": r.is_simulated,
                },
            )
            for r in conn.execute(_WARDS).all()
        ]
    )

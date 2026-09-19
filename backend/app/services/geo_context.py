"""Geo-context: nearest distance per feature kind + ward lookup (SPEC §10, F4).

Called ONLY at hotspot create/update; results are stored on the hotspot row
(d_drain_m ... d_market_m, ward_id). Never call this per GET request (CLAUDE.md §5).

Distances are geodesic metres via ST_Distance(::geography). Candidates come from the
planar KNN operator `<->` so the GiST index on geo_features.geom is used — but planar
distance in SRID 4326 is measured in degrees, and a degree of longitude is shorter
than a degree of latitude away from the equator. The planar-nearest feature is
therefore not always the metre-nearest, so we take the top KNN_CANDIDATES by `<->`
and pick the true minimum by geodesic distance.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

# (lon, lat) in EPSG:4326 — GeoJSON coordinate order.
Point = tuple[float, float]

KINDS = ("drain", "water", "school", "hospital", "market")
KNN_CANDIDATES = 10

_NEAREST_SQL = text(
    """
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS g)
    SELECT MIN(ST_Distance(c.geom::geography, p.g::geography))
    FROM p,
         LATERAL (
             SELECT f.geom FROM geo_features f
             WHERE f.kind = :kind
             ORDER BY f.geom <-> p.g
             LIMIT :k
         ) c
    """
)

_WARD_SQL = text(
    """
    SELECT id FROM wards
    WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
    ORDER BY id
    LIMIT 1
    """
)


def nearest_distances(conn: Connection, point: Point) -> dict[str, float | None]:
    """Metres to the nearest feature of each kind; None where no feature is loaded.

    Keys match the hotspots columns: d_drain_m, d_water_m, d_school_m,
    d_hospital_m, d_market_m.
    """
    lon, lat = point
    out: dict[str, float | None] = {}
    for kind in KINDS:
        d = conn.execute(
            _NEAREST_SQL, {"lon": lon, "lat": lat, "kind": kind, "k": KNN_CANDIDATES}
        ).scalar()
        out[f"d_{kind}_m"] = float(d) if d is not None else None
    return out


def ward_for(conn: Connection, point: Point) -> int | None:
    """Id of the ward containing the point, or None if it falls outside all wards."""
    lon, lat = point
    return conn.execute(_WARD_SQL, {"lon": lon, "lat": lat}).scalar()

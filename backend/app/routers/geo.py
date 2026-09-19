"""Geo layers and wards (SPEC §8/§10, F4).

====================================================================================
FROZEN CONTRACT — do not change without a stage
------------------------------------------------------------------------------------
GET /geo/layers?kind=<kind>  -> GeoJSON FeatureCollection

{
  "type": "FeatureCollection",
  "attribution": "© OpenStreetMap contributors",
  "features": [{
    "type": "Feature",
    "id": 12,
    "geometry": <any GeoJSON geometry>,   # drain: LineString, water: Polygon,
                                          # school/hospital/market: Point
    "properties": {
      "id": int,
      "kind": "drain" | "water" | "school" | "hospital" | "market",
      "name": str | null,
      "source": "osm" | "manual"          # manual = digitised by the team (SPEC §20.5)
    }
  }]
}

GET /wards  -> GeoJSON FeatureCollection of MultiPolygon

{
  "type": "FeatureCollection",
  "attribution": "© OpenStreetMap contributors",
  "features": [{
    "type": "Feature",
    "id": 1,
    "geometry": {"type": "MultiPolygon", "coordinates": [...]},
    "properties": {
      "id": int, "name": str,
      "hotspot_count": int, "open_count": int, "resolved_count": int,
      "avg_impact": float | null,
      "is_simulated": bool
    }
  }]
}

Layers are pulled from Overpass ONCE and stored — never fetched at runtime (SPEC §5).
====================================================================================

STAGE 1 STUB: returns fixtures. PostGIS-backed layers land in Stage 2.
"""

from fastapi import APIRouter, Depends, Query

from app.deps import any_role, load_fixture
from app.schemas import DemoUser, GeoFeatureCollection, GeoFeatureKind, WardFeatureCollection

router = APIRouter(tags=["geo"])


@router.get("/geo/layers", response_model=GeoFeatureCollection)
def geo_layers(
    kind: GeoFeatureKind | None = Query(None, description="Omit for all kinds."),
    _user: DemoUser = Depends(any_role),
) -> GeoFeatureCollection:
    collection = GeoFeatureCollection.model_validate(load_fixture("geo_layers"))
    if kind is None:
        return collection
    return collection.model_copy(
        update={"features": [f for f in collection.features if f.properties.kind == kind]}
    )


@router.get("/wards", response_model=WardFeatureCollection)
def wards(_user: DemoUser = Depends(any_role)) -> WardFeatureCollection:
    """Ward boundaries with per-ward hotspot stats, for the choropleth."""
    return WardFeatureCollection.model_validate(load_fixture("wards"))

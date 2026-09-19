"""Cleanup routing (SPEC §4, §10).

greedy_route() is the nearest-neighbour fallback: depot -> nearest unvisited stop ->
... -> back to the depot, straight lines between points. It needs no network, so a
route always exists even when OpenRouteService is down or over ORS_DAILY_QUOTA.
The ORS /optimization path is added in Stage P1-A and falls back to this.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.config import get_settings

LonLat = tuple[float, float]


def haversine_m(a: LonLat, b: LonLat) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


@dataclass(frozen=True)
class Route:
    order: list[int]  # stop ids in visiting order
    coordinates: list[list[float]]  # GeoJSON LineString [lon, lat], depot -> ... -> depot
    distance_m: float
    duration_s: float
    source: str  # "greedy" | "ors"

    def geojson(self) -> dict:
        return {"type": "LineString", "coordinates": self.coordinates}


def greedy_route(depot: LonLat, stops: list[tuple[int, LonLat]]) -> Route:
    remaining = dict(stops)
    here = depot
    order: list[int] = []
    coords = [list(depot)]
    total = 0.0
    while remaining:
        sid, pt = min(remaining.items(), key=lambda kv: haversine_m(here, kv[1]))
        total += haversine_m(here, pt)
        order.append(sid)
        coords.append(list(pt))
        here = pt
        del remaining[sid]
    total += haversine_m(here, depot)
    coords.append(list(depot))
    speed = get_settings().ROUTE_SPEED_KMH * 1000 / 3600
    return Route(order, coords, total, total / speed if speed else 0.0, "greedy")

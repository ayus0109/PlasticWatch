"""Cleanup routing (SPEC §4, §10; Stage P1-A).

plan_route() asks OpenRouteService /optimization for the best visiting order and road
geometry — but only when ORS_API_KEY is set and today's call count is under
ORS_DAILY_QUOTA (OPEN ITEM SPEC §20.4). On any error, timeout, missing key or
exhausted quota it falls back to greedy_route(): depot -> nearest unvisited stop ->
... -> depot, straight lines, no network. So a route ALWAYS exists, even offline.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import UTC, date, datetime

import httpx

from app.config import get_settings

logger = logging.getLogger("plasticwatch.routing")

LonLat = tuple[float, float]

# In-process count of ORS calls per UTC day, checked against ORS_DAILY_QUOTA.
_ors_calls: dict[date, int] = {}


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
    coordinates: list[list[float]]  # [lon, lat], depot -> ... -> depot
    distance_m: float
    duration_s: float
    source: str  # "greedy" | "ors"

    def geojson(self) -> dict:
        """Stored in cleanup_tasks.route_geojson. §7 has no route-source column, so
        the source rides in the Feature's properties."""
        return {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": self.coordinates},
            "properties": {"source": self.source},
        }


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


def decode_polyline(encoded: str, precision: int = 5) -> list[list[float]]:
    """Google encoded polyline -> [[lon, lat], ...] (ORS returns lat,lon pairs)."""
    coords, index, lat, lon = [], 0, 0, 0
    factor = 10**precision
    while index < len(encoded):
        for is_lon in (False, True):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lon:
                lon += delta
            else:
                lat += delta
        coords.append([lon / factor, lat / factor])
    return coords


def ors_calls_today() -> int:
    return _ors_calls.get(datetime.now(UTC).date(), 0)


def _post_ors(payload: dict) -> dict:
    """The only network call. Tests replace this."""
    s = get_settings()
    resp = httpx.post(
        s.ORS_OPTIMIZATION_URL,
        json=payload,
        headers={"Authorization": s.ORS_API_KEY},
        timeout=s.ORS_TIMEOUT_S,
    )
    resp.raise_for_status()
    return resp.json()


def ors_route(depot: LonLat, stops: list[tuple[int, LonLat]]) -> Route | None:
    s = get_settings()
    if not s.ORS_API_KEY:
        return None
    today = datetime.now(UTC).date()
    if _ors_calls.get(today, 0) >= s.ORS_DAILY_QUOTA:
        logger.warning("ORS daily quota (%s) reached; using the greedy route.", s.ORS_DAILY_QUOTA)
        return None
    payload = {
        "jobs": [{"id": sid, "location": list(pt)} for sid, pt in stops],
        "vehicles": [
            {"id": 1, "profile": "driving-car", "start": list(depot), "end": list(depot)}
        ],
        "options": {"g": True},
    }
    _ors_calls[today] = _ors_calls.get(today, 0) + 1
    try:
        route = _post_ors(payload)["routes"][0]
        order = [step["id"] for step in route["steps"] if step.get("type") == "job"]
        if sorted(order) != sorted(sid for sid, _ in stops):
            raise ValueError("ORS did not visit every stop")
        return Route(
            order=order,
            coordinates=decode_polyline(route["geometry"]),
            distance_m=float(route.get("distance", 0.0)),
            duration_s=float(route.get("duration", 0.0)),
            source="ors",
        )
    except Exception:
        logger.exception("ORS optimization failed; using the greedy route.")
        return None


def plan_route(depot: LonLat, stops: list[tuple[int, LonLat]]) -> Route:
    """ORS when available and under quota, otherwise the greedy fallback."""
    return ors_route(depot, stops) or greedy_route(depot, stops)

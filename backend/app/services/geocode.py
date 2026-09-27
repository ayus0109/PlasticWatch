"""Coordinates -> a short, human address ("Navle Bridge, Vadgaon Budruk, Pune").

Uses OpenStreetMap Nominatim's reverse endpoint over the stdlib (no new dependency,
CLAUDE.md §3). OSM is already the basemap, so this is the same provider, the same
attribution and the same data the citizen sees on the map.

PRIVACY: this sends a report's coordinates to a third party (OSM). Only the
coordinates go — never the photo, the reporter or any identifier.

Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/):
at most 1 request per second, an identifying User-Agent, and caching of results.
All three are enforced here. The address is a convenience label; a failure or a
timeout returns None and nothing downstream depends on it.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.parse
import urllib.request
from functools import lru_cache

from app.config import get_settings

logger = logging.getLogger(__name__)

# Nominatim allows 1 request/second. One lock + a timestamp serialises every call.
_lock = threading.Lock()
_last_call = 0.0

# Most specific first. The first present key of each group becomes one part.
_PLACE_KEYS = ("amenity", "building", "road", "pedestrian", "footway", "path")
_AREA_KEYS = ("neighbourhood", "quarter", "suburb", "hamlet", "village", "city_district")
_CITY_KEYS = ("city", "town", "municipality", "county", "state_district")


def format_address(payload: dict) -> str | None:
    """Short address from a Nominatim reverse response: place, area, city.

    Nominatim's display_name is often ten comma-separated parts ending in the postcode
    and country; three parts is what fits under a photo and what a person reads.
    """
    addr = payload.get("address") or {}
    parts: list[str] = []
    for group in (_PLACE_KEYS, _AREA_KEYS, _CITY_KEYS):
        for key in group:
            value = (addr.get(key) or "").strip()
            if value and value not in parts:
                parts.append(value)
                break
    if parts:
        return ", ".join(parts)
    # No structured address (open water, a field): fall back to the leading parts
    # of display_name, which is still better than coordinates alone.
    display = [p.strip() for p in (payload.get("display_name") or "").split(",") if p.strip()]
    return ", ".join(display[:3]) or None


def _fetch(lat: float, lon: float) -> dict | None:
    global _last_call
    s = get_settings()
    query = urllib.parse.urlencode(
        {"lat": f"{lat:.6f}", "lon": f"{lon:.6f}", "format": "jsonv2",
         "zoom": 18, "addressdetails": 1}
    )
    req = urllib.request.Request(
        f"{s.GEOCODE_URL}?{query}",
        headers={"User-Agent": s.GEOCODE_USER_AGENT, "Accept-Language": "en"},
    )
    with _lock:
        wait = 1.0 - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(req, timeout=s.GEOCODE_TIMEOUT_S) as resp:
                return json.load(resp)
        finally:
            _last_call = time.monotonic()


@lru_cache(maxsize=2048)
def _cached(lat5: float, lon5: float) -> str | None:
    payload = _fetch(lat5, lon5)
    if not payload or payload.get("error"):
        return None
    return format_address(payload)


def reverse_geocode(lat: float, lon: float) -> str | None:
    """Short address for a point, or None if disabled, unreachable or unknown.

    Rounded to 5 decimals (~1 m) before caching, so the same spot is looked up once.
    Never raises: the address is a label, and a missing label must not break a report.
    """
    if not get_settings().GEOCODE_ENABLED:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    try:
        return _cached(round(lat, 5), round(lon, 5))
    except Exception as exc:  # network, timeout, bad JSON: all just "no address"
        logger.warning("Reverse geocoding failed for %.5f,%.5f: %s", lat, lon, exc)
        return None

/** Small context map for one hotspot: its extent circle, member reports, drains/water. */
import type { Map as LMap } from "leaflet";
import { useEffect, useRef } from "react";
import type { GeoFeatureCollection, HotspotDetail } from "../../api/client";
import L, { OSM_ATTRIBUTION, OSM_TILES } from "../../lib/leaflet";
import { HUMAN_VERIFIED } from "../../lib/status";
import { band, currentTheme, palette } from "../../lib/theme";

function draw(m: LMap, h: HotspotDetail, geo?: GeoFeatureCollection): void {
  const radius = Math.max(h.radius_m ?? 0, 12);
  // Set the view FIRST: Leaflet only attaches layers once the map has a view, and
  // bounds are computed geometrically so no layer needs to be attached yet.
  m.fitBounds(L.latLng(h.lat, h.lon).toBounds(radius * 2 * 3.2), { maxZoom: 18 });
  m.eachLayer((l) => {
    if (!(l instanceof L.TileLayer)) m.removeLayer(l);
  });
  const pal = palette[currentTheme()];
  const c = band[h.score_breakdown.priority_band];

  for (const f of geo?.features ?? []) {
    if (f.properties.kind !== "drain" && f.properties.kind !== "water") continue;
    L.geoJSON(f as never, {
      style: () =>
        f.properties.kind === "water"
          ? { color: pal.mapWater, weight: 1, fillColor: pal.mapWater, fillOpacity: 0.22 }
          : { color: pal.mapDrain, weight: 3, dashArray: f.properties.source === "manual" ? "6 5" : undefined },
      interactive: false,
    }).addTo(m);
  }
  L.circle([h.lat, h.lon], {
    radius,
    color: c,
    weight: 2,
    fillColor: c,
    fillOpacity: 0.12,
    dashArray: HUMAN_VERIFIED.has(h.status) ? undefined : "5 5",
  }).addTo(m);
  for (const r of h.reports) {
    L.circleMarker([r.lat, r.lon], {
      radius: 5,
      color: pal.surface,
      weight: 2,
      fillColor: r.is_duplicate ? pal.muted : pal.text,
      fillOpacity: 0.9,
    })
      .bindTooltip(r.is_duplicate ? "Duplicate photo" : "Citizen report")
      .addTo(m);
  }
}

export function MiniMap({ h, geo }: { h: HotspotDetail; geo?: GeoFeatureCollection }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    // A map problem must never take the whole page down with it.
    try {
      draw(m, h, geo);
    } catch (err) {
      console.warn("Mini map could not render", err);
    }
  }, [h, geo]);

  return <div ref={el} className="h-56 w-full overflow-hidden rounded-xl" aria-label="Hotspot location map" role="img" />;
}

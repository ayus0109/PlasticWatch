/**
 * A cleanup route: depot, numbered stops (priority colour + number, never colour
 * alone) and the route line. A greedy-fallback route is straight lines, so it is drawn
 * DASHED — nobody should mistake it for a road route.
 */
import type { Map as LMap } from "leaflet";
import { useEffect, useRef } from "react";
import type { TaskDetail } from "../../api/client";
import L, { OSM_ATTRIBUTION, OSM_TILES } from "../../lib/leaflet";
import { band, currentTheme, palette } from "../../lib/theme";

function stopIcon(seq: number, color: string, done: boolean) {
  return L.divIcon({
    className: "pw-marker",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `<div style="position:relative;width:30px;height:30px;margin:3px">
      <div class="pw-marker__dot" style="--c:${color};${done ? "background:var(--pw-surface);color:" + color + ";border:2.5px solid " + color : ""}">${seq}</div></div>`,
  });
}

function depotIcon() {
  return L.divIcon({
    className: "pw-pin",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="width:26px;height:26px;margin:2px;border-radius:7px;background:var(--pw-text);color:var(--pw-surface);display:grid;place-items:center;font:700 11px var(--font-sans);border:2.5px solid var(--pw-surface);box-shadow:0 2px 6px rgba(0,0,0,.35)">D</div>`,
  });
}

export function RouteMap({ task, height = "h-80" }: { task: TaskDetail; height?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, scrollWheelZoom: false }).setView([20, 0], 2);
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
    try {
      m.eachLayer((l) => {
        if (!(l instanceof L.TileLayer)) m.removeLayer(l);
      });
      const pal = palette[currentTheme()];
      const pts: [number, number][] = [];
      const geo = task.route_geojson as
        | { type: string; geometry?: { coordinates: number[][] }; coordinates?: number[][] }
        | null
        | undefined;
      const coords = geo?.geometry?.coordinates ?? geo?.coordinates ?? [];
      if (coords.length) {
        const line = coords.map(([x, y]) => [y, x] as [number, number]);
        L.polyline(line, {
          color: pal.accent,
          weight: 4,
          opacity: 0.85,
          dashArray: task.route_source === "ors" ? undefined : "8 7",
        }).addTo(m);
        pts.push(...line);
      }
      if (task.depot) {
        L.marker([task.depot[1], task.depot[0]], { icon: depotIcon(), title: "Depot" }).addTo(m);
        pts.push([task.depot[1], task.depot[0]]);
      }
      for (const s of task.stops) {
        L.marker([s.lat, s.lon], {
          icon: stopIcon(s.seq, band[s.priority_band ?? "low"], Boolean(s.completed_at)),
          title: `Stop ${s.seq}: hotspot #${s.hotspot_id}`,
        }).addTo(m);
        pts.push([s.lat, s.lon]);
      }
      if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 17 });
    } catch (err) {
      console.warn("Route map could not render", err);
    }
  }, [task]);

  return <div ref={el} className={`${height} w-full overflow-hidden rounded-xl`} role="img" aria-label="Cleanup route map" />;
}

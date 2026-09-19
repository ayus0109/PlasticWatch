/**
 * The authority map (SPEC §10, CLAUDE.md §9): priority markers with evidence styling,
 * hotspot extents (circles — never polygons), a heatmap weighted by Impact, drain /
 * water / sensitive-place layers and a ward choropleth. Plain Leaflet, no wrapper lib.
 */
import type { LayerGroup, Map as LMap } from "leaflet";
import { useEffect, useRef, useState } from "react";
import type {
  GeoFeatureCollection,
  HotspotFeatureCollection,
  WardFeatureCollection,
} from "../../api/client";
import L from "../../lib/heat";
import { OSM_ATTRIBUTION, OSM_TILES } from "../../lib/leaflet";
import { BAND, HUMAN_VERIFIED } from "../../lib/status";
import { band as bandColour, currentTheme, palette } from "../../lib/theme";
import { hotspotIcon } from "./markers";

export interface LayerToggles {
  heat: boolean;
  drains: boolean;
  water: boolean;
  places: boolean;
  wards: boolean;
  extents: boolean;
}

interface Props {
  hotspots?: HotspotFeatureCollection;
  geo?: GeoFeatureCollection;
  wards?: WardFeatureCollection;
  layers: LayerToggles;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onTileError?: () => void;
}

const HEAT_GRADIENT = {
  0.25: bandColour.low,
  0.5: bandColour.medium,
  0.72: bandColour.high,
  1: bandColour.critical,
};

function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener("pw-theme", on);
    return () => window.removeEventListener("pw-theme", on);
  }, []);
  return tick;
}

export default function HotspotMap({
  hotspots,
  geo,
  wards,
  layers,
  selectedId,
  onSelect,
  onTileError,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const g = useRef<Record<string, LayerGroup> | null>(null);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onTileErrorRef = useRef(onTileError);
  onTileErrorRef.current = onTileError;
  const themeTick = useThemeTick();

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, preferCanvas: false }).setView([20, 0], 2);
    L.control.zoom({ position: "topright" }).addTo(m);
    L.control.scale({ position: "bottomright", imperial: false }).addTo(m);
    const tiles = L.tileLayer(OSM_TILES, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
      subdomains: "abc",
    });
    let errors = 0;
    tiles.on("tileerror", () => {
      errors += 1;
      if (errors === 4) onTileErrorRef.current?.();
    });
    tiles.addTo(m);
    g.current = {
      wards: L.layerGroup().addTo(m),
      water: L.layerGroup().addTo(m),
      drains: L.layerGroup().addTo(m),
      places: L.layerGroup().addTo(m),
      heat: L.layerGroup().addTo(m),
      extents: L.layerGroup().addTo(m),
      hotspots: L.layerGroup().addTo(m),
    };
    m.on("click", () => onSelectRef.current(null));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      g.current = null;
      fitted.current = false;
    };
  }, []);

  // Fit to the data once: hotspots if any, else the ward boundaries.
  useEffect(() => {
    const m = map.current;
    if (!m || fitted.current) return;
    const pts = (hotspots?.features ?? []).map(
      (f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number],
    );
    if (pts.length) {
      m.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 16 });
      fitted.current = true;
    } else if (wards?.features.length) {
      m.fitBounds(L.geoJSON(wards as never).getBounds(), { maxZoom: 15 });
      fitted.current = true;
    }
  }, [hotspots, wards]);

  // Markers + extents.
  useEffect(() => {
    const groups = g.current;
    if (!groups) return;
    groups.hotspots.clearLayers();
    groups.extents.clearLayers();
    for (const f of hotspots?.features ?? []) {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      const marker = L.marker([lat, lon], {
        icon: hotspotIcon(p, p.id === selectedId),
        keyboard: true,
        title: `${BAND[p.priority_band ?? "low"].label} priority hotspot #${p.id}`,
        riseOnHover: true,
        zIndexOffset: p.id === selectedId ? 1000 : Math.round(p.impact_score ?? 0),
      });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectRef.current(p.id);
      });
      marker.addTo(groups.hotspots);

      if (layers.extents) {
        const c = bandColour[p.priority_band ?? "low"];
        L.circle([lat, lon], {
          radius: Math.max(p.radius_m ?? 0, 10),
          color: c,
          weight: 1.5,
          opacity: 0.8,
          fillColor: c,
          fillOpacity: 0.07,
          dashArray: HUMAN_VERIFIED.has(p.status) ? undefined : "4 4",
          interactive: false,
        }).addTo(groups.extents);
      }
    }
  }, [hotspots, selectedId, layers.extents]);

  // Heatmap weighted by Impact.
  useEffect(() => {
    const groups = g.current;
    if (!groups) return;
    groups.heat.clearLayers();
    if (!layers.heat) return;
    const pts = (hotspots?.features ?? [])
      .filter((f) => f.properties.impact_score !== null && f.properties.impact_score !== undefined)
      .map(
        (f) =>
          [
            f.geometry.coordinates[1],
            f.geometry.coordinates[0],
            Math.max(0.05, (f.properties.impact_score ?? 0) / 100),
          ] as [number, number, number],
      );
    if (pts.length) {
      L.heatLayer(pts, { radius: 32, blur: 24, maxZoom: 17, max: 1, gradient: HEAT_GRADIENT }).addTo(
        groups.heat,
      );
    }
  }, [hotspots, layers.heat]);

  // Drains, water bodies, sensitive places.
  useEffect(() => {
    const groups = g.current;
    if (!groups) return;
    const pal = palette[currentTheme()];
    groups.drains.clearLayers();
    groups.water.clearLayers();
    groups.places.clearLayers();
    for (const f of geo?.features ?? []) {
      const p = f.properties;
      const layer = L.geoJSON(f as never, {
        style: () =>
          p.kind === "water"
            ? { color: pal.mapWater, weight: 1, fillColor: pal.mapWater, fillOpacity: 0.22 }
            : {
                color: pal.mapDrain,
                weight: 3,
                opacity: 0.85,
                dashArray: p.source === "manual" ? "6 5" : undefined,
              },
        pointToLayer: (_pt, latlng) =>
          L.circleMarker(latlng, {
            radius: 6,
            color: pal.surface,
            weight: 2,
            fillColor: pal.muted,
            fillOpacity: 1,
          }),
      }).bindTooltip(
        `<strong>${p.name ?? p.kind}</strong><br/><span style="text-transform:capitalize">${p.kind}</span>${
          p.source === "manual" ? " · digitised by the team" : ""
        }`,
        { sticky: true },
      );
      if (p.kind === "drain" && layers.drains) layer.addTo(groups.drains);
      else if (p.kind === "water" && layers.water) layer.addTo(groups.water);
      else if (["school", "hospital", "market"].includes(p.kind) && layers.places)
        layer.addTo(groups.places);
    }
  }, [geo, layers.drains, layers.water, layers.places, themeTick]);

  // Ward choropleth: shade by open hotspots.
  useEffect(() => {
    const groups = g.current;
    if (!groups) return;
    groups.wards.clearLayers();
    if (!layers.wards) return;
    const pal = palette[currentTheme()];
    const max = Math.max(1, ...(wards?.features ?? []).map((w) => w.properties.open_count));
    for (const w of wards?.features ?? []) {
      const p = w.properties;
      L.geoJSON(w as never, {
        style: () => ({
          color: pal.borderStrong,
          weight: 1,
          dashArray: "3 4",
          fillColor: pal.accent,
          // Kept light: the choropleth is context, the markers are the data.
          fillOpacity: 0.02 + 0.13 * (p.open_count / max),
        }),
      })
        .bindTooltip(
          `<strong>${p.name}</strong><br/>${p.open_count} open · ${p.resolved_count} resolved` +
            (p.avg_impact !== null && p.avg_impact !== undefined
              ? `<br/>avg Impact ${p.avg_impact.toFixed(1)}`
              : ""),
          { sticky: true },
        )
        .addTo(groups.wards);
    }
  }, [wards, layers.wards, themeTick]);

  return <div ref={el} className="h-full w-full" role="application" aria-label="Hotspot map" />;
}

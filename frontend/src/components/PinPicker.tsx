/** Tap-to-drop location picker — the last step of browser GPS -> EXIF -> pin (SPEC F1). */
import type { Map as LMap, Marker } from "leaflet";
import { useEffect, useRef } from "react";
import type { WardFeatureCollection } from "../api/client";
import { useApi } from "../api/hooks";
import L, { OSM_ATTRIBUTION, OSM_TILES } from "../lib/leaflet";
import { pinIcon } from "./map/markers";

export interface LatLon {
  lat: number;
  lon: number;
}

export function PinPicker({
  value,
  near,
  onChange,
}: {
  value: LatLon | null;
  near?: LatLon | null;
  onChange: (p: LatLon) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const wards = useApi<WardFeatureCollection>("/wards");

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
    L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(m);
    m.on("click", (e) => onChangeRef.current({ lat: e.latlng.lat, lon: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  // Initial view: near the citizen, else the demo area's wards.
  useEffect(() => {
    const m = map.current;
    if (!m || value) return;
    if (near) m.setView([near.lat, near.lon], 17);
    else if (wards.data?.features.length) m.fitBounds(L.geoJSON(wards.data as never).getBounds());
  }, [near, wards.data, value]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = L.marker([value.lat, value.lon], { icon: pinIcon(), draggable: true })
        .on("dragend", (e) => {
          const ll = (e.target as Marker).getLatLng();
          onChangeRef.current({ lat: ll.lat, lon: ll.lng });
        })
        .addTo(m);
    } else marker.current.setLatLng([value.lat, value.lon]);
  }, [value]);

  return (
    <div className="overflow-hidden rounded-card border border-line">
      <div
        ref={el}
        className="h-[45dvh] max-h-[420px] min-h-[16rem] w-full md:h-64"
        role="application"
        aria-label="Tap the map to drop a pin"
      />
      <p className="border-t border-line bg-surface-2 px-3 py-2 text-xs text-muted">
        {value
          ? `Pin at ${value.lat.toFixed(5)}, ${value.lon.toFixed(5)} — drag it to adjust.`
          : "Tap the map where the waste is."}
      </p>
    </div>
  );
}

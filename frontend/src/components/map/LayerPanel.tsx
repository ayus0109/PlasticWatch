/** GIS layer toggles for the dashboard map (PS-08: drains, water, sensitive places). */
import { Icon, type IconName } from "../Icon";
import type { LayerToggles } from "./HotspotMap";

const LAYER_ITEMS: { key: keyof LayerToggles; label: string; icon: IconName }[] = [
  { key: "heat", label: "Heatmap (by Impact)", icon: "flame" },
  { key: "extents", label: "Hotspot extents", icon: "crosshair" },
  { key: "drains", label: "Drains & nalas", icon: "route" },
  { key: "water", label: "Water bodies", icon: "droplet" },
  { key: "places", label: "Schools, hospitals, markets", icon: "users" },
  { key: "wards", label: "Ward choropleth", icon: "layers" },
];

export function LayerPanel({
  layers,
  onChange,
}: {
  layers: LayerToggles;
  onChange: (l: LayerToggles) => void;
}) {
  return (
    <div className="space-y-1">
      {LAYER_ITEMS.map((item) => (
        <label
          key={item.key}
          className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface-2"
        >
          <Icon name={item.icon} size={16} className="text-muted" />
          <span className="flex-1">{item.label}</span>
          <input
            type="checkbox"
            checked={layers[item.key]}
            onChange={(e) => onChange({ ...layers, [item.key]: e.target.checked })}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="relative h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
          />
        </label>
      ))}
    </div>
  );
}

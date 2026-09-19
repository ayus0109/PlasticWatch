import type { HotspotStatus, PriorityBand, WardFeatureCollection } from "../../api/client";
import { BAND, BAND_ORDER, STATUS } from "../../lib/status";
import { Icon, type IconName } from "../Icon";
import { cx } from "../ui";
import type { LayerToggles } from "./HotspotMap";

export interface Filters {
  status: HotspotStatus | "";
  band: PriorityBand | "";
  ward: number | "";
  minEvidence: number;
}

export const NO_FILTERS: Filters = { status: "", band: "", ward: "", minEvidence: 0 };

const LAYER_ITEMS: { key: keyof LayerToggles; label: string; icon: IconName }[] = [
  { key: "heat", label: "Heatmap (by Impact)", icon: "flame" },
  { key: "extents", label: "Hotspot extents", icon: "crosshair" },
  { key: "drains", label: "Drains & nalas", icon: "route" },
  { key: "water", label: "Water bodies", icon: "droplet" },
  { key: "places", label: "Schools, hospitals, markets", icon: "users" },
  { key: "wards", label: "Ward choropleth", icon: "layers" },
];

const selectCls =
  "min-h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm focus:border-accent";

export function FilterPanel({
  filters,
  onChange,
  wards,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  wards?: WardFeatureCollection;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const active =
    filters.status !== "" || filters.band !== "" || filters.ward !== "" || filters.minEvidence > 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted">Priority band</span>
          {active ? (
            <button
              onClick={() => onChange(NO_FILTERS)}
              className="min-h-8 rounded px-1.5 text-xs font-semibold text-accent hover:underline"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Priority band">
          {BAND_ORDER.map((b) => {
            const on = filters.band === b;
            return (
              <button
                key={b}
                role="radio"
                aria-checked={on}
                onClick={() => set({ band: on ? "" : b })}
                className={cx(
                  "flex min-h-10 flex-col items-center justify-center rounded-lg border text-[11px] font-semibold transition-colors",
                  on ? "border-ink bg-surface-2" : "border-line hover:border-line-strong",
                )}
              >
                <span
                  className="mb-0.5 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: `var(--pw-band-${b})` }}
                  aria-hidden
                >
                  {BAND[b].letter}
                </span>
                {BAND[b].label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-muted">Status</span>
        <select
          className={selectCls}
          value={filters.status}
          onChange={(e) => set({ status: e.target.value as HotspotStatus | "" })}
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS) as HotspotStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-muted">Ward</span>
        <select
          className={selectCls}
          value={filters.ward}
          onChange={(e) => set({ ward: e.target.value ? Number(e.target.value) : "" })}
        >
          <option value="">All wards</option>
          {(wards?.features ?? []).map((w) => (
            <option key={w.properties.id} value={w.properties.id}>
              {w.properties.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 flex items-center justify-between text-xs font-semibold text-muted">
          Minimum evidence
          <span className="tabular text-ink">{filters.minEvidence.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={filters.minEvidence}
          onChange={(e) => set({ minEvidence: Number(e.target.value) })}
          className="h-10 w-full accent-[var(--pw-accent)]"
        />
      </label>
    </div>
  );
}

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

import { useCallback, useMemo, useState } from "react";
import type {
  GeoFeatureCollection,
  HotspotFeatureCollection,
  WardFeatureCollection,
} from "../api/client";
import { useApi, useDebounced } from "../api/hooks";
import { Icon } from "../components/Icon";
import { FilterPanel, LayerPanel, NO_FILTERS, type Filters } from "../components/map/FilterPanel";
import HotspotMap, { type LayerToggles } from "../components/map/HotspotMap";
import { HotspotPreview } from "../components/map/HotspotPreview";
import { Legend } from "../components/map/Legend";
import { asOfIso, TimeSlider } from "../components/map/TimeSlider";
import { Shell, SimulatedBanner } from "../components/Shell";
import { EmptyState, ErrorState, SectionTitle, Skeleton, cx } from "../components/ui";
import { BAND, BAND_ORDER } from "../lib/status";

const DEFAULT_LAYERS: LayerToggles = {
  heat: false,
  extents: true,
  drains: true,
  water: true,
  places: false,
  wards: true,
};

export default function MapPage() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<number | null>(null);
  const [dayOffset, setDayOffset] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tilesDown, setTilesDown] = useState(false);

  // The live, unfiltered set fixes the time slider's range.
  const live = useApi<HotspotFeatureCollection>("/hotspots");
  const earliest = useMemo(() => {
    const times = (live.data?.features ?? [])
      .map((f) => f.properties.first_reported_at)
      .filter(Boolean)
      .map((t) => new Date(t as string).getTime());
    return times.length ? new Date(Math.min(...times)) : null;
  }, [live.data]);

  const debouncedOffset = useDebounced(dayOffset, 220);
  const asOf = earliest && debouncedOffset !== null ? asOfIso(earliest, debouncedOffset) : undefined;
  const hotspots = useApi<HotspotFeatureCollection>("/hotspots", {
    status: filters.status || undefined,
    band: filters.band || undefined,
    ward: filters.ward === "" ? undefined : filters.ward,
    min_evidence: filters.minEvidence > 0 ? filters.minEvidence : undefined,
    as_of: asOf,
  });
  const geo = useApi<GeoFeatureCollection>("/geo/layers");
  const wards = useApi<WardFeatureCollection>("/wards");

  const features = hotspots.data?.features ?? [];
  const selectedFeature = features.find((f) => f.properties.id === selected);
  const simulated = features.some((f) => f.properties.is_simulated);
  const counts = BAND_ORDER.map((b) => ({
    band: b,
    n: features.filter((f) => f.properties.priority_band === b).length,
  }));
  const onSelect = useCallback((id: number | null) => setSelected(id), []);

  const panel = (
    <div className="space-y-6 p-4 sm:p-5">
      <div>
        <SectionTitle hint={asOf ? "time machine" : "live"}>On the map</SectionTitle>
        {hotspots.data ? (
          <>
            <div className="tabular text-3xl font-bold tracking-tight">
              {features.length}
              <span className="ml-1.5 text-sm font-medium text-muted">
                hotspot{features.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              {counts.map((c) =>
                c.n ? (
                  <span
                    key={c.band}
                    className="h-full transition-[width] duration-500"
                    style={{
                      width: `${(c.n / Math.max(1, features.length)) * 100}%`,
                      background: `var(--pw-band-${c.band})`,
                    }}
                  />
                ) : null,
              )}
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted">
              {counts.map((c) => (
                <li key={c.band} className="flex justify-between">
                  <span>{BAND[c.band].label}</span>
                  <span className="tabular font-semibold text-ink">{c.n}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </div>

      <div>
        <SectionTitle>Filter</SectionTitle>
        <FilterPanel filters={filters} onChange={setFilters} wards={wards.data} />
      </div>
      <div>
        <SectionTitle>Layers</SectionTitle>
        <LayerPanel layers={layers} onChange={setLayers} />
      </div>
      <div>
        <SectionTitle>Legend</SectionTitle>
        <Legend />
      </div>
    </div>
  );

  return (
    <Shell fullBleed banner={simulated ? <SimulatedBanner /> : null}>
      <div className="absolute inset-0 flex">
        <aside
          className={cx(
            "z-[950] w-[340px] shrink-0 overflow-y-auto border-r border-line bg-surface",
            "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:w-[min(340px,88vw)] max-md:pb-20 max-md:shadow-pop max-md:transition-transform",
            panelOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
          )}
          aria-label="Map filters and layers"
        >
          {panel}
        </aside>

        <div className="relative min-w-0 flex-1">
          <HotspotMap
            hotspots={hotspots.data}
            geo={geo.data}
            wards={wards.data}
            layers={layers}
            selectedId={selected}
            onSelect={onSelect}
            onTileError={() => setTilesDown(true)}
          />

          <button
            onClick={() => setPanelOpen((o) => !o)}
            className="absolute left-3 top-3 z-[960] flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold shadow-raised md:hidden"
          >
            <Icon name={panelOpen ? "x" : "filter"} size={16} />
            {panelOpen ? "Close" : "Filters & layers"}
          </button>

          {hotspots.error ? (
            <div className="absolute inset-x-4 top-16 z-[940] mx-auto max-w-md">
              <ErrorState message={hotspots.error.message} onRetry={hotspots.refetch} />
            </div>
          ) : hotspots.data && features.length === 0 ? (
            <div className="absolute inset-x-4 top-16 z-[940] mx-auto max-w-sm rounded-2xl border border-line bg-surface shadow-raised">
              <EmptyState icon="map" title={asOf ? "Nothing reported yet by this day" : "No hotspots match"}>
                {asOf
                  ? "Move the time slider forward to see hotspots appear."
                  : "Try clearing the filters, or submit a citizen report to create the first one."}
              </EmptyState>
            </div>
          ) : !hotspots.data ? (
            <div className="absolute left-1/2 top-16 z-[940] -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted shadow-raised">
              Loading hotspots…
            </div>
          ) : null}

          {tilesDown ? (
            <div className="absolute right-16 top-3 z-[940] max-w-xs rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted shadow-raised">
              <strong className="text-ink">Map tiles unavailable</strong> (offline?). Hotspots
              and layers still work; the basemap needs internet.
            </div>
          ) : null}

          {selectedFeature ? (
            <div className="absolute right-3 top-14 z-[960] max-md:bottom-40 max-md:top-auto">
              <HotspotPreview p={selectedFeature.properties} onClose={() => setSelected(null)} />
            </div>
          ) : null}

          <div className="absolute inset-x-3 bottom-20 z-[930] mx-auto max-w-xl md:bottom-4">
            {earliest ? (
              <TimeSlider
                earliest={earliest}
                value={dayOffset}
                onChange={setDayOffset}
                loading={hotspots.loading}
              />
            ) : null}
          </div>

        </div>
      </div>
    </Shell>
  );
}

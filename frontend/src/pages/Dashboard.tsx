/**
 * /dashboard — the whole government portal on one screen (PS-08), laid out as a
 * triage desk: headline figures, then the Impact-ranked registry, then the map.
 *
 * Impact = Severity + Recurrence + Sensitivity + Persistence, computed by the backend
 * (SPEC §11) — the weights are tunable proposals, shown in the drawer's breakdown, not
 * published truth. Nothing on this page resolves a hotspot: only an explicit click in
 * the approval gate does (CLAUDE.md §2.5).
 *
 * Every figure is one the API actually returns. There is deliberately no estimated
 * tonnage, no "% AI verified" and no crew ETA, because nothing here measures those.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  api,
  type AnalyticsSummary,
  type AnalyticsTrend,
  type GeoFeatureCollection,
  type HotspotFeatureCollection,
  type ResetDemoResponse,
  type WardFeatureCollection,
} from "../api/client";
import { useApi } from "../api/hooks";
import { HotspotRegistry } from "../components/dashboard/HotspotRegistry";
import { KpiRow } from "../components/dashboard/KpiRow";
import { HotspotDrawer } from "../components/HotspotDrawer";
import { Icon } from "../components/Icon";
import HotspotMap, { type LayerToggles } from "../components/map/HotspotMap";
import { LayerPanel } from "../components/map/LayerPanel";
import { Legend } from "../components/map/Legend";
import { Shell } from "../components/Shell";
import { useToast } from "../components/Toast";
import { Button, Card, ErrorState, cx } from "../components/ui";
import { NON_ATTRIBUTION_NOTE } from "../lib/status";

const DEFAULT_LAYERS: LayerToggles = {
  heat: false,
  extents: true,
  drains: true,
  water: true,
  places: false,
  wards: true,
};

/** A hotspot this close to a drain or water body is what the KPI row counts as "near". */
const NEAR_WATER_M = 100;

export default function Dashboard() {
  // Phones show one section at a time, switched by the bottom bar (Shell MOBILE_NAV).
  // Desktop ignores this and shows the whole desk at once.
  const [params] = useSearchParams();
  const view = (params.get("view") ?? "map") as "map" | "list" | "kpi";
  const onlyOn = (v: typeof view) => (view === v ? "" : "max-lg:hidden");

  const summary = useApi<AnalyticsSummary>("/analytics/summary");
  const trend = useApi<AnalyticsTrend>("/analytics/trend", { days: 30 });
  const hotspots = useApi<HotspotFeatureCollection>("/hotspots");
  const geo = useApi<GeoFeatureCollection>("/geo/layers");
  const wards = useApi<WardFeatureCollection>("/wards");

  const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<number | null>(null);
  const [showLayers, setShowLayers] = useState(false);
  const [tilesDown, setTilesDown] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());
  const toast = useToast();

  useEffect(() => {
    if (hotspots.data) setLastUpdated(Date.now());
  }, [hotspots.data]);

  const features = useMemo(() => hotspots.data?.features ?? [], [hotspots.data]);
  const properties = useMemo(() => features.map((f) => f.properties), [features]);
  const onSelect = useCallback((id: number | null) => setSelected(id), []);

  const refetchAll = useCallback(() => {
    hotspots.refetch();
    summary.refetch();
    trend.refetch();
  }, [hotspots, summary, trend]);

  const resetDemo = async () => {
    if (!window.confirm("Wipe all demo data and reseed the simulated history? (~30 s)")) return;
    setResetting(true);
    try {
      const res = await api.post<ResetDemoResponse>("/admin/reset-demo");
      toast("ok", res.message);
      setSelected(null);
      refetchAll();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <Shell>
      {/* ------------------------------------------------------------ header ---- */}
      <header className={cx("mb-5 flex flex-wrap items-end justify-between gap-4", onlyOn("kpi"))}>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-eyebrow font-semibold uppercase text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-accent" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Municipal triage desk
          </p>
          <h1 className="font-display mt-1.5 text-title font-bold tracking-tight text-ink sm:text-display">
            Active plastic waste hotspots
          </h1>
          <p className="mt-1.5 max-w-2xl text-body text-muted">
            Citizen reports merged into hotspots and ranked by Impact: how much is visible, how
            often it returns, how close it sits to drains and water, and how long it has stayed
            open.
          </p>
        </div>
        <Button
          variant="secondary"
          icon="refresh"
          loading={resetting}
          onClick={() => {
            setSelected(null);
            refetchAll();
            toast("ok", "Feeds updated.");
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            resetDemo();
          }}
          title="Refresh feeds (right-click to reseed sample data)"
        >
          Refresh
        </Button>
      </header>

      {/* -------------------------------------------------------------- KPIs ---- */}
      <div className={onlyOn("kpi")}>
        {summary.error ? (
          <ErrorState message={summary.error.message} onRetry={summary.refetch} />
        ) : (
          <KpiRow
            summary={summary.data}
            trend={trend.data}
            hotspots={properties}
            nearWaterM={NEAR_WATER_M}
          />
        )}
      </div>

      {/* ---------------------------------------------------------- registry ---- */}
      <div className={cx("mt-5", onlyOn("list"))}>
        {hotspots.error ? (
          <ErrorState message={hotspots.error.message} onRetry={hotspots.refetch} />
        ) : (
          <HotspotRegistry
            data={hotspots.data}
            loading={hotspots.loading}
            selectedId={selected}
            onSelect={setSelected}
            lastUpdated={lastUpdated}
          />
        )}
      </div>

      {/* --------------------------------------------------------------- map ---- */}
      <Card pad="none" className={cx("relative mt-5 overflow-hidden", onlyOn("map"))}>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 font-display text-heading font-bold tracking-tight text-ink">
            <Icon name="map" size={18} className="text-accent" />
            Hotspot map
          </h2>
          <p className="flex items-center gap-1.5 font-mono text-xs text-faint">
            <Icon name="layers" size={12} />
            {features.length} plotted · OpenStreetMap
          </p>
        </header>

        <div className="relative h-[calc(100dvh-18rem)] min-h-[20rem] w-full lg:h-[520px]">
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
            onClick={() => setShowLayers((v) => !v)}
            aria-expanded={showLayers}
            className="absolute left-3 top-3 z-[960] flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-xs font-semibold shadow-raised"
          >
            <Icon name={showLayers ? "x" : "layers"} size={15} />
            {showLayers ? "Close" : "Layers"}
          </button>
          {showLayers ? (
            <div className="absolute left-3 top-16 z-[960] w-[min(300px,80vw)] space-y-3 rounded-card border border-line bg-surface p-3 shadow-pop animate-rise">
              <LayerPanel layers={layers} onChange={setLayers} />
              <div className="border-t border-line pt-3">
                <Legend />
              </div>
            </div>
          ) : null}
          {tilesDown ? (
            <div className="absolute bottom-3 left-3 z-[940] max-w-xs rounded-card border border-line bg-surface px-3 py-2 text-xs text-muted shadow-raised">
              <strong className="text-ink">Map tiles unavailable</strong> (offline?). Hotspots and
              GIS layers still render; the basemap needs internet.
            </div>
          ) : null}
        </div>
      </Card>

      <p className={cx("mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted", onlyOn("kpi"))}>
        <Icon name="info" size={13} className="shrink-0 text-accent" />
        {NON_ATTRIBUTION_NOTE}
      </p>

      {/* ------------------------------------- approval gate (every action) ---- */}
      {selected !== null ? (
        <>
          <div
            className="fixed inset-0 z-[1040] animate-fade bg-[var(--pw-overlay)] backdrop-blur-[2px]"
            onClick={() => setSelected(null)}
            aria-hidden
          />
          <div
            className={cx(
              "fixed z-[1050] animate-sheet-up",
              "inset-x-0 bottom-0 h-[92dvh]",
              "md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[min(560px,100vw)] md:animate-slide-in",
            )}
          >
            <HotspotDrawer
              key={selected}
              hotspotId={selected}
              onClose={() => setSelected(null)}
              onChanged={refetchAll}
            />
          </div>
        </>
      ) : null}
    </Shell>
  );
}

/**
 * /dashboard — the whole government portal on one screen (PS-08):
 *   KPIs + work progress · GIS map · Impact-ranked hotspot list · approval drawer.
 *
 * Impact = Severity + Recurrence + Sensitivity + Persistence, computed by the backend
 * (SPEC §11) — the weights are tunable proposals, shown in the drawer's breakdown, not
 * published truth. Nothing on this page resolves a hotspot: only an explicit click in
 * the approval gate does (CLAUDE.md §2.5).
 */
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  api,
  type AnalyticsSummary,
  type GeoFeatureCollection,
  type HotspotFeatureCollection,
  type HotspotProperties,
  type ResetDemoResponse,
  type WardFeatureCollection,
} from "../api/client";
import { useApi } from "../api/hooks";
import { HotspotDrawer } from "../components/HotspotDrawer";
import { Icon } from "../components/Icon";
import HotspotMap, { type LayerToggles } from "../components/map/HotspotMap";
import { LayerPanel } from "../components/map/LayerPanel";
import { Legend } from "../components/map/Legend";
import { Shell } from "../components/Shell";
import { useToast } from "../components/Toast";
import {
  BandChip,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SimulatedBadge,
  Skeleton,
  StatusChip,
  cx,
} from "../components/ui";
import { impact, timeAgo } from "../lib/format";
import { citizenStage, NON_ATTRIBUTION_NOTE } from "../lib/status";

const DEFAULT_LAYERS: LayerToggles = {
  heat: false,
  extents: true,
  drains: true,
  water: true,
  places: false,
  wards: true,
};

function HotspotRow({
  p,
  selected,
  onSelect,
}: {
  p: HotspotProperties;
  selected: boolean;
  onSelect: () => void;
}) {
  const isPending = citizenStage(p.status) === "pending";
  return (
    <button
      onClick={onSelect}
      aria-current={selected}
      className={cx(
        "flex w-full items-start gap-3 border-l-4 px-3.5 py-3 text-left transition-all",
        selected
          ? "border-accent bg-accent-soft/60"
          : isPending
            ? "border-info/80 bg-surface hover:bg-surface-2"
            : "border-transparent hover:bg-surface-2",
      )}
    >
      <span
        className="tabular mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-field text-label font-bold text-white"
        style={{ background: `var(--pw-band-${p.priority_band ?? "low"})` }}
        aria-hidden
      >
        {impact(p.impact_score)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center justify-between gap-1">
          <span className="flex items-center gap-1.5 font-bold text-sm text-ink">
            Hotspot #{p.id}
            {p.is_simulated ? <SimulatedBadge /> : null}
          </span>
          <BandChip band={p.priority_band} />
        </span>
        <span className="mt-1 flex items-center justify-between text-xs text-muted">
          <span>{p.ward_name ?? "Unmapped area"} · {p.report_count} citizen report(s)</span>
          <span className="text-micro text-faint">{timeAgo(p.last_reported_at)}</span>
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusChip status={p.status} />
          {isPending ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-micro font-semibold text-info">
              <Icon name="clock" size={12} />
              Needs Review
            </span>
          ) : p.status === "verified" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-micro font-semibold text-accent">
              <Icon name="truck" size={12} />
              Ready to Dispatch
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

export default function Dashboard() {
  // Phones show one view at a time, switched by the bottom bar (Shell MOBILE_NAV).
  // Desktop ignores this and keeps KPIs + map + list on screen together.
  const [params] = useSearchParams();
  const view = (params.get("view") ?? "map") as "map" | "list" | "kpi";
  const onlyOn = (v: typeof view) => (view === v ? "" : "max-md:hidden");
  const summary = useApi<AnalyticsSummary>("/analytics/summary");
  const hotspots = useApi<HotspotFeatureCollection>("/hotspots");
  const geo = useApi<GeoFeatureCollection>("/geo/layers");
  const wards = useApi<WardFeatureCollection>("/wards");
  const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<number | null>(null);
  const [showLayers, setShowLayers] = useState(false);
  const [tilesDown, setTilesDown] = useState(false);
  const [resetting, setResetting] = useState(false);
  const toast = useToast();

  const features = hotspots.data?.features ?? [];
  const onSelect = useCallback((id: number | null) => setSelected(id), []);

  const refetchAll = useCallback(() => {
    hotspots.refetch();
    summary.refetch();
  }, [hotspots, summary]);

  // Work progress in the citizen's three words, from the live hotspot statuses.
  const stages = useMemo(() => {
    const counts = { pending: 0, in_progress: 0, completed: 0 } as Record<string, number>;
    for (const f of features) {
      const stage = citizenStage(f.properties.status);
      if (stage !== "closed") counts[stage] += 1;
    }
    return counts;
  }, [features]);

  const ranked = useMemo(
    () => [...features].sort((a, b) => (b.properties.impact_score ?? 0) - (a.properties.impact_score ?? 0)),
    [features],
  );

  type FilterMode = "all" | "pending" | "in_progress" | "resolved";
  const [filter, setFilter] = useState<FilterMode>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return ranked;
    if (filter === "pending") return ranked.filter((f) => citizenStage(f.properties.status) === "pending");
    if (filter === "in_progress") return ranked.filter((f) => citizenStage(f.properties.status) === "in_progress");
    if (filter === "resolved") return ranked.filter((f) => f.properties.status === "resolved" || citizenStage(f.properties.status) === "completed");
    return ranked;
  }, [ranked, filter]);

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

  const k = summary.data?.kpis;
  return (
    <Shell banner={null}>
      <div className={cx("mb-4 flex flex-wrap items-end justify-between gap-3", onlyOn("kpi"))}>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
            Plastic waste hotspots
          </h1>
          <p className="mt-1 text-sm text-muted">
            Ranked by Impact: severity, recurrence, sensitivity to drains and water, and how long
            they have stayed open.
          </p>
        </div>
        <Button
          variant="ghost"
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
          title="Refresh feeds (Right-click to reseed sample data)"
        >
          Refresh feeds
        </Button>
      </div>

      {/* 1. KPIs + work progress */}
      {summary.error ? (
        <ErrorState message={summary.error.message} onRetry={summary.refetch} />
      ) : (
        <div className={cx("grid grid-cols-2 gap-3 lg:grid-cols-4", onlyOn("kpi"))}>
          {!k ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-card" />)
          ) : (
            <>
              {/* Static KPIs: flat by design — you read them, you cannot act on them.
                  Accents come from theme tokens only; warm stays reserved for the ramp. */}
              <Card className="border-l-4 border-l-info">
                <div className="flex items-center gap-2 text-eyebrow font-semibold uppercase text-info">
                  <Icon name="clock" size={15} />
                  Needs Your Review
                </div>
                <div className="font-display tabular mt-1.5 text-display font-bold text-ink">
                  {stages.pending}
                </div>
                <div className="mt-1 text-micro text-muted">Awaiting government verification</div>
              </Card>

              <Card className="border-l-4 border-l-accent">
                <div className="flex items-center gap-2 text-eyebrow font-semibold uppercase text-accent">
                  <Icon name="truck" size={15} />
                  Work In Progress
                </div>
                <div className="font-display tabular mt-1.5 text-display font-bold text-ink">
                  {stages.in_progress}
                </div>
                <div className="mt-1 text-micro text-muted">Cleanup teams dispatched</div>
              </Card>

              <Card className="border-l-4 border-l-ok">
                <div className="flex items-center gap-2 text-eyebrow font-semibold uppercase text-ok">
                  <Icon name="check" size={15} />
                  Cleaned & Resolved
                </div>
                <div className="font-display tabular mt-1.5 text-display font-bold text-ink">
                  {stages.completed}
                </div>
                <div className="mt-1 text-micro text-muted">Verified & approved closed</div>
              </Card>

              <Card className="border-l-4 border-l-line-strong">
                <div className="flex items-center gap-2 text-eyebrow font-semibold uppercase text-muted">
                  <Icon name="pin" size={15} />
                  Total Hotspots
                </div>
                <div className="font-display tabular mt-1.5 text-display font-bold text-ink">
                  {features.length}
                </div>
                <div className="mt-1 text-micro text-muted">From {k.total_reports.toLocaleString()} citizen reports</div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* 2 + 3. Map and the Impact-ranked list */}
      <div className="mt-0 grid gap-4 md:mt-5 lg:grid-cols-[1fr_380px]">
        <Card pad="none" className={cx("relative overflow-hidden", onlyOn("map"))}>
          <div className="h-[calc(100dvh-16rem)] min-h-[20rem] w-full md:h-[460px] lg:h-[560px]">
            <HotspotMap
              hotspots={hotspots.data}
              geo={geo.data}
              wards={wards.data}
              layers={layers}
              selectedId={selected}
              onSelect={onSelect}
              onTileError={() => setTilesDown(true)}
            />
          </div>

          <button
            onClick={() => setShowLayers((v) => !v)}
            aria-expanded={showLayers}
            className="absolute left-3 top-3 z-[960] flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold shadow-raised"
          >
            <Icon name={showLayers ? "x" : "layers"} size={16} />
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
        </Card>

        <Card pad="none" className={cx("flex flex-col overflow-hidden md:max-h-[560px]", onlyOn("list"))}>
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 bg-surface">
            <h2 className="text-label font-bold uppercase tracking-[0.06em] text-ink">
              Hotspot Triage List
            </h2>
            <span className="text-xs text-muted font-medium">{filtered.length} shown</span>
          </div>

          {/* Quick status filter tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-line bg-surface-2/60 p-2">
            {[
              { key: "all", label: "All", icon: "list" as const, count: ranked.length },
              { key: "pending", label: "Needs Action", icon: "alert" as const, count: stages.pending },
              { key: "in_progress", label: "In Progress", icon: "truck" as const, count: stages.in_progress },
              { key: "resolved", label: "Resolved", icon: "check" as const, count: stages.completed },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key as FilterMode)}
                className={cx(
                  "flex items-center gap-1.5 rounded-field px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors",
                  filter === tab.key
                    ? "bg-accent text-accent-fg shadow-card"
                    : "text-muted hover:bg-surface hover:text-ink",
                )}
              >
                <Icon name={tab.icon} size={13} />
                <span>{tab.label}</span>
                <span
                  className={cx(
                    "rounded-full px-1.5 py-0.5 text-micro",
                    filter === tab.key ? "bg-black/20 text-white" : "bg-surface text-muted",
                  )}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto max-md:max-h-[calc(100dvh-16rem)]">
            {hotspots.error ? (
              <div className="p-4">
                <ErrorState message={hotspots.error.message} onRetry={hotspots.refetch} />
              </div>
            ) : !hotspots.data ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-field" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon="map" title="No hotspots in this view">
                {filter === "pending"
                  ? "Great job! No hotspots are currently waiting for your review."
                  : "Select another status tab above to view other hotspots."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {filtered.map((f) => (
                  <li key={f.properties.id}>
                    <HotspotRow
                      p={f.properties}
                      selected={f.properties.id === selected}
                      onSelect={() => setSelected(f.properties.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <p className={cx("mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted", onlyOn("kpi"))}>
        <Icon name="info" size={13} className="shrink-0 text-accent" />
        {NON_ATTRIBUTION_NOTE}
      </p>

      {/* 4. Approval gate + every per-hotspot action */}
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

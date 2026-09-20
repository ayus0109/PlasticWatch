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
import { Icon, type IconName } from "../components/Icon";
import HotspotMap, { type LayerToggles } from "../components/map/HotspotMap";
import { LayerPanel } from "../components/map/LayerPanel";
import { Legend } from "../components/map/Legend";
import { Shell, SimulatedBanner } from "../components/Shell";
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
import { impact, metres, timeAgo } from "../lib/format";
import { citizenStage, NON_ATTRIBUTION_NOTE, type CitizenStage } from "../lib/status";

const DEFAULT_LAYERS: LayerToggles = {
  heat: false,
  extents: true,
  drains: true,
  water: true,
  places: false,
  wards: true,
};

const STAGE_META: { key: Exclude<CitizenStage, "closed">; label: string; icon: IconName; tone: string }[] = [
  { key: "pending", label: "Pending", icon: "clock", tone: "text-warn" },
  { key: "in_progress", label: "Work in progress", icon: "truck", tone: "text-info" },
  { key: "completed", label: "Completed", icon: "check", tone: "text-ok" },
];

function Kpi({ icon, label, value, hint }: { icon: IconName; label: string; value: string | number; hint: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        <Icon name={icon} size={15} />
        {label}
      </div>
      <div className="font-display mt-1.5 text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-faint">{hint}</div>
    </Card>
  );
}

function HotspotRow({
  p,
  selected,
  onSelect,
}: {
  p: HotspotProperties;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-current={selected}
      className={cx(
        "flex w-full items-start gap-3 border-l-2 px-3 py-3 text-left transition-colors",
        selected ? "border-accent bg-accent-soft/50" : "border-transparent hover:bg-surface-2",
      )}
    >
      <span
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
        style={{ background: `var(--pw-band-${p.priority_band ?? "low"})` }}
        aria-hidden
      >
        {impact(p.impact_score)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">Hotspot #{p.id}</span>
          <BandChip band={p.priority_band} />
          {p.is_simulated ? <SimulatedBadge /> : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          {p.ward_name ?? "Outside mapped wards"} · {p.report_count} report(s) ·{" "}
          {metres(p.d_drain_m)} to drain
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusChip status={p.status} />
          <span className="text-[11px] text-faint">{timeAgo(p.last_reported_at)}</span>
        </span>
      </span>
    </button>
  );
}

export default function Dashboard() {
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
  const simulated = features.some((f) => f.properties.is_simulated);
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
    <Shell banner={simulated || summary.data?.simulated_data ? <SimulatedBanner /> : null}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Plastic waste hotspots</h1>
          <p className="mt-1 text-sm text-muted">
            Ranked by Impact: severity, recurrence, sensitivity to drains and water, and how long
            they have stayed open.
          </p>
        </div>
        <Button variant="ghost" icon="refresh" loading={resetting} onClick={resetDemo}>
          {resetting ? "Reseeding demo…" : "Reset demo data"}
        </Button>
      </div>

      {/* 1. KPIs + work progress */}
      {summary.error ? (
        <ErrorState message={summary.error.message} onRetry={summary.refetch} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {!k ? (
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24 rounded-card" />)
          ) : (
            <>
              <Kpi icon="pin" label="Hotspots detected" value={features.length} hint="on the map now" />
              <Kpi
                icon="camera"
                label="Citizen reports merged"
                value={k.total_reports.toLocaleString()}
                hint="grouped into hotspots"
              />
              {STAGE_META.map((s) => (
                <Card key={s.key} className="p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted">
                    <Icon name={s.icon} size={15} className={s.tone} />
                    {s.label}
                  </div>
                  <div className="font-display mt-1.5 text-3xl font-bold tracking-tight">
                    {stages[s.key]}
                  </div>
                  <div className="mt-0.5 text-xs text-faint">
                    {s.key === "pending"
                      ? "awaiting your triage"
                      : s.key === "in_progress"
                        ? "cleanup dispatched"
                        : "approved by you"}
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      {/* 2 + 3. Map and the Impact-ranked list */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="relative overflow-hidden p-0">
          <div className="h-[420px] w-full lg:h-[560px]">
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
            className="absolute left-3 top-3 z-[960] flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold shadow-raised"
          >
            <Icon name={showLayers ? "x" : "layers"} size={16} />
            {showLayers ? "Close" : "Layers"}
          </button>
          {showLayers ? (
            <div className="absolute left-3 top-16 z-[960] w-[min(300px,80vw)] space-y-3 rounded-2xl border border-line bg-surface p-3 shadow-pop animate-rise">
              <LayerPanel layers={layers} onChange={setLayers} />
              <div className="border-t border-line pt-3">
                <Legend />
              </div>
            </div>
          ) : null}
          {tilesDown ? (
            <div className="absolute bottom-3 left-3 z-[940] max-w-xs rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted shadow-raised">
              <strong className="text-ink">Map tiles unavailable</strong> (offline?). Hotspots and
              GIS layers still render; the basemap needs internet.
            </div>
          ) : null}
        </Card>

        <Card className="flex max-h-[560px] flex-col overflow-hidden p-0">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
              Priority list
            </h2>
            <span className="text-xs text-faint">{ranked.length} hotspots · highest Impact first</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {hotspots.error ? (
              <div className="p-4">
                <ErrorState message={hotspots.error.message} onRetry={hotspots.refetch} />
              </div>
            ) : !hotspots.data ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-xl" />
                ))}
              </div>
            ) : ranked.length === 0 ? (
              <EmptyState icon="map" title="No hotspots yet">
                They appear as soon as locals report waste.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {ranked.map((f) => (
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

      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <Icon name="info" size={13} className="shrink-0 text-accent" />
        {NON_ATTRIBUTION_NOTE}
      </p>

      {/* 4. Approval gate + every per-hotspot action */}
      {selected !== null ? (
        <>
          <div
            className="fixed inset-0 z-[1040] bg-black/30 backdrop-blur-[1px]"
            onClick={() => setSelected(null)}
            aria-hidden
          />
          <div className="fixed inset-y-0 right-0 z-[1050] w-[min(560px,100vw)] animate-slide-in">
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

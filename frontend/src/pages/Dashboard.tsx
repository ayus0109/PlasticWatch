/**
 * /dashboard — 6 KPI cards + 4 charts from the real /analytics endpoints (SPEC F8).
 * Nothing here is fabricated: every number is an aggregate the API computed.
 */
import { useState } from "react";
import { Link } from "react-router";
import type { AnalyticsSummary, AnalyticsTrend, AnalyticsWards, HotspotStatus } from "../api/client";
import { useApi } from "../api/hooks";
import { BandBars, OpenedResolved, ReportsTrend, WardBars } from "../components/charts";
import { Icon, type IconName } from "../components/Icon";
import { Shell, SimulatedBanner } from "../components/Shell";
import { Card, ErrorState, Skeleton, cx } from "../components/ui";
import { STATUS } from "../lib/status";

const RANGES = [7, 30, 45, 90] as const;

function Kpi({
  icon,
  label,
  value,
  hint,
  emphasis,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={cx("p-4", emphasis && "ring-1 ring-accent/40")}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        <Icon name={icon} size={15} className={emphasis ? "text-accent" : ""} />
        {label}
      </div>
      <div className="font-display mt-2 text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-faint">{hint}</div>
    </Card>
  );
}

const PIPELINE: HotspotStatus[] = [
  "ai_detected",
  "needs_verification",
  "verified",
  "cleanup_scheduled",
  "cleanup_completed",
  "resolved",
  "false_positive",
];

export default function Dashboard() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const summary = useApi<AnalyticsSummary>("/analytics/summary");
  const trend = useApi<AnalyticsTrend>("/analytics/trend", { days });
  const wards = useApi<AnalyticsWards>("/analytics/wards");
  const k = summary.data?.kpis;
  const counts = new Map(summary.data?.by_status.map((s) => [s.status, s.count]) ?? []);

  return (
    <Shell banner={summary.data?.simulated_data ? <SimulatedBanner /> : null}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Where waste is reported, and how fast it gets cleaned.</p>
        </div>
      </div>

      {summary.error ? (
        <ErrorState message={summary.error.message} onRetry={summary.refetch} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {!k ? (
            Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28 rounded-card" />)
          ) : (
            <>
              <Kpi icon="camera" label="Citizen reports" value={k.total_reports.toLocaleString()} hint="all time, incl. rejected" />
              <Kpi icon="pin" label="Active hotspots" value={k.active_hotspots} hint="not resolved or ruled out" emphasis />
              <Kpi icon="eye" label="Awaiting verification" value={k.awaiting_verification} hint="in the queue" />
              <Kpi icon="shield" label="Verified" value={k.verified_hotspots} hint="awaiting cleanup" />
              <Kpi icon="check" label="Resolved" value={k.resolved_hotspots} hint="confirmed by an authority" />
              <Kpi
                icon="clock"
                label="Median time to resolve"
                value={k.median_days_to_resolve === null || k.median_days_to_resolve === undefined ? "—" : `${k.median_days_to_resolve} d`}
                hint={k.median_days_to_resolve === null || k.median_days_to_resolve === undefined ? "nothing resolved yet" : "from (re)open to confirm"}
              />
            </>
          )}
        </div>
      )}

      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Trends</h2>
        <div className="flex rounded-[10px] border border-line bg-surface p-0.5" role="radiogroup" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={days === r}
              onClick={() => setDays(r)}
              className={cx(
                "min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors",
                days === r ? "bg-accent text-accent-fg" : "text-muted hover:text-ink",
              )}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {trend.error ? (
          <ErrorState message={trend.error.message} onRetry={trend.refetch} />
        ) : trend.data ? (
          <>
            <ReportsTrend trend={trend.data} />
            <OpenedResolved trend={trend.data} />
          </>
        ) : (
          <>
            <Skeleton className="h-72 rounded-card" />
            <Skeleton className="h-72 rounded-card" />
          </>
        )}
        {summary.data ? <BandBars bands={summary.data.by_band} /> : <Skeleton className="h-72 rounded-card" />}
        {wards.error ? (
          <ErrorState message={wards.error.message} onRetry={wards.refetch} />
        ) : wards.data ? (
          <WardBars wards={wards.data.wards} />
        ) : (
          <Skeleton className="h-72 rounded-card" />
        )}
      </div>

      <h2 className="mt-8 mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        Pipeline
      </h2>
      <Card className="p-2">
        <ol className="grid gap-1 sm:grid-cols-2 lg:grid-cols-7">
          {PIPELINE.map((s) => (
            <li key={s}>
              <Link
                to="/map"
                className="flex min-h-16 flex-col justify-center rounded-xl px-3 py-2 transition-colors hover:bg-surface-2"
                title={STATUS[s].hint}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Icon name={STATUS[s].icon} size={13} />
                  {STATUS[s].label}
                </span>
                <span className="font-display text-2xl font-bold">{counts.get(s) ?? "—"}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Card>
    </Shell>
  );
}

/**
 * The four headline cards on the government dashboard.
 *
 * Each card carries a different bottom visual — sparkline, band split, risk strip,
 * progress — so the row reads as four distinct facts rather than four identical tiles.
 *
 * Every number here comes from the API. Nothing is estimated: there is no tonnage,
 * no "% AI verified" and no crew ETA on this page, because the system does not
 * measure any of those and a dashboard that invents them is worse than a plain one.
 */
import type { AnalyticsSummary, AnalyticsTrend, HotspotProperties, PriorityBand } from "../../api/client";
import { BAND, BAND_ORDER } from "../../lib/status";
import { metres, plural } from "../../lib/format";
import { Icon, type IconName } from "../Icon";
import { Skeleton, cx } from "../ui";

/** Tiny inline SVG trend line — a chart library would be heavier than the picture. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="h-8" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const W = 100;
  const H = 30;
  const pts = values.map<[number, number]>((v, i) => [
    (i / (values.length - 1)) * W,
    H - ((v - min) / span) * (H - 3) - 1.5,
  ]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-8 w-full text-accent"
      role="img"
      aria-label={label}
    >
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="currentColor" opacity={0.12} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The priority ramp as one bar. Colour is paired with a written label underneath. */
function BandSplit({ counts }: { counts: Record<PriorityBand, number> }) {
  const total = BAND_ORDER.reduce((sum, b) => sum + counts[b], 0);
  if (!total) return <p className="text-xs text-faint">No hotspots to rank yet.</p>;
  const shown = BAND_ORDER.filter((b) => counts[b] > 0);
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img"
        aria-label={shown.map((b) => `${BAND[b].label} ${counts[b]}`).join(", ")}>
        {shown.map((b) => (
          <span
            key={b}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(counts[b] / total) * 100}%`, background: `var(--pw-band-${b})` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {shown.map((b) => (
          <span key={b} className="text-xs">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: `var(--pw-band-${b})` }} />
            <span className="text-muted">{BAND[b].label}</span>{" "}
            <span className="tabular font-semibold text-ink">{counts[b]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Card({
  label,
  icon,
  tone = "accent",
  value,
  unit,
  facts,
  children,
}: {
  label: string;
  icon: IconName;
  tone?: "accent" | "info" | "danger" | "ok";
  value: string;
  unit?: string;
  facts: { text: string; strong?: boolean; tone?: "accent" | "danger" | "muted" }[];
  children?: React.ReactNode;
}) {
  const TILE = {
    accent: "bg-accent-soft text-accent",
    info: "bg-info-soft text-info",
    danger: "bg-danger-soft text-danger",
    ok: "bg-ok-soft text-ok",
  }[tone];
  const FACT = { accent: "text-accent", danger: "text-danger", muted: "text-muted" };
  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-eyebrow font-semibold uppercase leading-tight text-muted">{label}</h3>
        <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-field", TILE)}>
          <Icon name={icon} size={19} />
        </span>
      </div>

      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display tabular text-[2.25rem] font-bold leading-none tracking-tight text-ink">
            {value}
          </span>
          {unit ? <span className="text-sm font-medium text-muted">{unit}</span> : null}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {facts.map((f, i) => (
            <span key={i} className={cx(f.strong ? "font-semibold" : "", FACT[f.tone ?? "muted"])}>
              {i > 0 ? <span className="mr-2 text-faint">·</span> : null}
              {f.text}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-auto">{children}</div>
    </section>
  );
}

export function KpiRow({
  summary,
  trend,
  hotspots,
  nearWaterM,
}: {
  summary: AnalyticsSummary | undefined;
  trend: AnalyticsTrend | undefined;
  hotspots: HotspotProperties[];
  /** A hotspot within this many metres of a drain or water body counts as "near". */
  nearWaterM: number;
}) {
  if (!summary) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-44 rounded-card" />
        ))}
      </div>
    );
  }

  const k = summary.kpis;
  const counts = Object.fromEntries(BAND_ORDER.map((b) => [b, 0])) as Record<PriorityBand, number>;
  for (const h of hotspots) {
    if (h.priority_band) counts[h.priority_band] += 1;
  }

  const points = trend?.points ?? [];
  const reportsThisPeriod = points.reduce((sum, p) => sum + p.reports, 0);

  // Sensitivity is a scored factor (SPEC §11): waste beside a drain or a water body
  // is what reaches the river. These are the stored distances, not a fresh query.
  const nearWater = hotspots.filter((h) => {
    const d = Math.min(h.d_drain_m ?? Infinity, h.d_water_m ?? Infinity);
    return Number.isFinite(d) && d <= nearWaterM;
  });
  const criticalNearWater = nearWater.filter(
    (h) => h.priority_band === "critical" || h.priority_band === "high",
  ).length;
  const closest = nearWater.reduce(
    (best, h) => Math.min(best, h.d_drain_m ?? Infinity, h.d_water_m ?? Infinity),
    Infinity,
  );

  const closedShare = k.total_reports > 0 && k.active_hotspots + k.resolved_hotspots > 0
    ? k.resolved_hotspots / (k.active_hotspots + k.resolved_hotspots)
    : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        label="Citizen reports"
        icon="camera"
        tone="accent"
        value={k.total_reports.toLocaleString()}
        unit="reports"
        facts={[
          { text: `${reportsThisPeriod.toLocaleString()} in ${plural(trend?.days ?? 0, "day")}`, strong: true, tone: "accent" },
          { text: `${k.active_hotspots} hotspots formed` },
        ]}
      >
        <Sparkline
          values={points.map((p) => p.reports)}
          label={`Reports per day over the last ${trend?.days ?? 0} days`}
        />
      </Card>

      <Card
        label="Active hotspots"
        icon="map"
        tone="info"
        value={String(k.active_hotspots)}
        unit="tracked"
        facts={[
          { text: `${k.awaiting_verification} awaiting review`, strong: true, tone: "muted" },
          { text: `${k.verified_hotspots} verified` },
        ]}
      >
        <BandSplit counts={counts} />
      </Card>

      <Card
        label="Near drains & water"
        icon="droplet"
        tone={criticalNearWater > 0 ? "danger" : "info"}
        value={String(nearWater.length)}
        unit={`within ${metres(nearWaterM)}`}
        facts={[
          {
            text: `${criticalNearWater} critical or high`,
            strong: true,
            tone: criticalNearWater > 0 ? "danger" : "muted",
          },
          { text: Number.isFinite(closest) ? `nearest ${metres(closest)}` : "none mapped" },
        ]}
      >
        <p
          className={cx(
            "flex items-start gap-2 rounded-field px-3 py-2 text-xs leading-snug",
            criticalNearWater > 0 ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted",
          )}
        >
          <Icon name={criticalNearWater > 0 ? "alert" : "info"} size={14} className="mt-px shrink-0" />
          <span>
            {criticalNearWater > 0
              ? "Waste this close to a drain reaches the river first — these rank highest on Sensitivity."
              : "No high-priority hotspot sits close to a drain or water body right now."}
          </span>
        </p>
      </Card>

      <Card
        label="Reviewed & closed"
        icon="shield"
        tone="ok"
        value={String(k.resolved_hotspots)}
        unit="resolved"
        facts={[
          {
            text: k.median_days_to_resolve != null
              ? `${k.median_days_to_resolve.toFixed(1)} days median`
              : "no closures yet",
            strong: true,
            tone: "accent",
          },
          { text: "closed by a person, never by the model" },
        ]}
      >
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="img"
            aria-label={`${Math.round(closedShare * 100)} percent of hotspots closed`}>
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(closedShare * 100, closedShare > 0 ? 3 : 0)}%` }}
            />
          </div>
          <p className="tabular mt-2 text-xs text-muted">
            {Math.round(closedShare * 100)}% of all hotspots closed
          </p>
        </div>
      </Card>
    </div>
  );
}

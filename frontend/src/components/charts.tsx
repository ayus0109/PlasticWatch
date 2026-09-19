/**
 * Dashboard charts (Recharts), built to the dataviz method:
 *  - one axis per chart; thin marks (bars <= 24px, 4px rounded data-ends, 2px lines);
 *  - hairline solid gridlines, recessive axes; area fills are a ~10% wash;
 *  - categorical slots are the validated cool pair from theme.ts, fixed by entity
 *    (series1 = opened/open, series2 = resolved) — never by rank;
 *  - bands use the priority ramp and are always labelled (never colour alone);
 *  - text uses text tokens, never a series colour; tooltips lead with the value;
 *  - every chart has a table view, so no value is gated behind hover.
 */
import { useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsTrend, BandCount, WardStats } from "../api/client";
import { shortDate } from "../lib/format";
import { BAND } from "../lib/status";
import { band as bandColour, chart } from "../lib/theme";
import { useThemeMode } from "../lib/useTheme";
import { Icon } from "./Icon";
import { Card, cx } from "./ui";

function useChart() {
  return chart[useThemeMode()];
}

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  table: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        </div>
        <button
          onClick={() => setAsTable((t) => !t)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink"
          aria-pressed={asTable}
        >
          <Icon name={asTable ? "chart" : "list"} size={14} />
          {asTable ? "Chart" : "Table"}
        </button>
      </div>
      {legend && !asTable ? <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">{legend}</div> : null}
      {asTable ? (
        <div className="max-h-64 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
              <tr>
                {table.head.map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((c, j) => (
                    <td key={j} className={cx("px-3 py-1.5", j > 0 && "text-right")}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56">{children}</div>
      )}
    </Card>
  );
}

export function LegendKey({ color, label, shape = "rect" }: { color: string; label: string; shape?: "rect" | "line" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={shape === "line" ? "h-0.5 w-4 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

interface TipRow {
  color: string;
  name: string;
  value: number | string;
}

function TipBox({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 text-muted">{title}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} aria-hidden />
          <span className="tabular text-sm font-semibold">{r.value}</span>
          <span className="text-muted">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

const axisProps = (c: ReturnType<typeof useChart>) => ({
  stroke: c.axis,
  tick: { fill: c.muted, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: c.axis },
});

/** Reports per day — single series: no legend box, the title names it. */
export function ReportsTrend({ trend }: { trend: AnalyticsTrend }) {
  const c = useChart();
  const data = trend.points.map((p) => ({ ...p, label: shortDate(p.date) }));
  return (
    <ChartCard
      title="Reports per day"
      subtitle={`Last ${trend.days} days (UTC)`}
      table={{ head: ["Date", "Reports"], rows: trend.points.map((p) => [p.date, p.reports]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps(c)} minTickGap={24} />
          <YAxis allowDecimals={false} {...axisProps(c)} axisLine={false} />
          <Tooltip
            cursor={{ stroke: c.axis, strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox title={String(label)} rows={[{ color: c.series1, name: "reports", value: payload[0].value as number }]} />
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="reports"
            stroke={c.series1}
            strokeWidth={2}
            fill={c.series1}
            fillOpacity={0.1}
            activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }}
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Opened vs resolved, cumulative over the window: the gap is the backlog. */
export function OpenedResolved({ trend }: { trend: AnalyticsTrend }) {
  const c = useChart();
  let opened = 0;
  let resolved = 0;
  const data = trend.points.map((p) => {
    opened += p.hotspots_opened;
    resolved += p.hotspots_resolved;
    return { label: shortDate(p.date), date: p.date, opened, resolved };
  });
  return (
    <ChartCard
      title="Hotspots opened vs resolved"
      subtitle="Cumulative over the window — the gap is the growing or shrinking backlog"
      legend={
        <>
          <LegendKey color={c.series1} label="Opened (incl. reopened)" shape="line" />
          <LegendKey color={c.series2} label="Resolved by an authority" shape="line" />
        </>
      }
      table={{ head: ["Date", "Opened (cum.)", "Resolved (cum.)"], rows: data.map((d) => [d.date, d.opened, d.resolved]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps(c)} minTickGap={24} />
          <YAxis allowDecimals={false} {...axisProps(c)} axisLine={false} />
          <Tooltip
            cursor={{ stroke: c.axis, strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox
                  title={String(label)}
                  rows={[
                    { color: c.series1, name: "opened", value: payload[0]?.value as number },
                    { color: c.series2, name: "resolved", value: payload[1]?.value as number },
                  ]}
                />
              ) : null
            }
          />
          <Line type="monotone" dataKey="opened" stroke={c.series1} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
          <Line type="monotone" dataKey="resolved" stroke={c.series2} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Open hotspots by priority band — the ramp, always labelled. */
export function BandBars({ bands }: { bands: BandCount[] }) {
  const c = useChart();
  const data = bands.map((b) => ({ name: BAND[b.band].label, band: b.band, count: b.count }));
  return (
    <ChartCard
      title="Open hotspots by priority"
      subtitle="Resolved and ruled-out hotspots excluded"
      table={{ head: ["Band", "Open hotspots"], rows: data.map((d) => [d.name, d.count]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={c.grid} horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...axisProps(c)} />
          <YAxis type="category" dataKey="name" width={64} {...axisProps(c)} axisLine={false} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TipBox
                  title={`${payload[0].payload.name} priority`}
                  rows={[{ color: bandColour[payload[0].payload.band as keyof typeof bandColour], name: "open hotspots", value: payload[0].value as number }]}
                />
              ) : null
            }
          />
          <Bar dataKey="count" barSize={22} radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.band} fill={bandColour[d.band]} />
            ))}
            <LabelList dataKey="count" position="right" fill={c.ink} fontSize={12} fontWeight={600} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Per-ward open vs resolved — same two slots as the trend chart. */
export function WardBars({ wards }: { wards: WardStats[] }) {
  const c = useChart();
  const data = wards.map((w) => ({ name: w.ward_name, open: w.open_count, resolved: w.resolved_count, reports: w.total_reports }));
  return (
    <ChartCard
      title="Wards: open vs resolved"
      subtitle="Hotspots currently open and resolved, per ward"
      legend={
        <>
          <LegendKey color={c.series1} label="Open" />
          <LegendKey color={c.series2} label="Resolved" />
        </>
      }
      table={{
        head: ["Ward", "Open", "Resolved", "Reports"],
        rows: data.map((d) => [d.name, d.open, d.resolved, d.reports]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="name" {...axisProps(c)} />
          <YAxis allowDecimals={false} {...axisProps(c)} axisLine={false} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox
                  title={String(label)}
                  rows={[
                    { color: c.series1, name: "open", value: payload[0]?.value as number },
                    { color: c.series2, name: "resolved", value: payload[1]?.value as number },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="open" fill={c.series1} barSize={20} radius={[4, 4, 0, 0]} />
          <Bar dataKey="resolved" fill={c.series2} barSize={20} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

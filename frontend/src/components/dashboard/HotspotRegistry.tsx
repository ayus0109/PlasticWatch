/**
 * The Impact-ranked hotspot registry: filter bar + table (desktop) / cards (phone).
 *
 * The table SHOWS; it never decides. Every action button opens the drawer, where the
 * verification gate lives, because nothing may become verified, resolved or ruled out
 * without an explicit human decision (CLAUDE.md §2.5).
 *
 * Wording follows §2.1/§2.3: "likely plastic", "reported", never who is responsible.
 */
import { useMemo, useState } from "react";
import type { HotspotFeatureCollection, HotspotStatus } from "../../api/client";
import { evidence as fmtEvidence, metres, plural, timeAgo } from "../../lib/format";
import { EVIDENCE, STATUS, citizenStage } from "../../lib/status";
import { Icon, type IconName } from "../Icon";
import { BandChip, EmptyState, Skeleton, cx } from "../ui";

type Feature = HotspotFeatureCollection["features"][number];

export type StatusFilter = "all" | "pending" | "in_progress" | "completed";

const TABS: { key: StatusFilter; label: string; icon: IconName }[] = [
  { key: "all", label: "All", icon: "list" },
  { key: "pending", label: "Needs review", icon: "eye" },
  { key: "in_progress", label: "In progress", icon: "truck" },
  { key: "completed", label: "Resolved", icon: "check" },
];

/** The one thing to do next for this status. The drawer is where it actually happens. */
function nextAction(status: HotspotStatus): { label: string; icon: IconName; kind: "primary" | "quiet" } {
  switch (status) {
    case "ai_detected":
    case "needs_verification":
      return { label: "Review", icon: "eye", kind: "primary" };
    case "verified":
      return { label: "Dispatch", icon: "truck", kind: "primary" };
    case "cleanup_scheduled":
      return { label: "Track", icon: "route", kind: "quiet" };
    case "cleanup_completed":
      return { label: "Approve", icon: "clipboard", kind: "primary" };
    default:
      return { label: "Open", icon: "arrowRight", kind: "quiet" };
  }
}

function coords(f: Feature): string {
  const c = (f.geometry as { coordinates?: number[] }).coordinates ?? [];
  const [lon, lat] = c;
  if (lat == null || lon == null) return "—";
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
}

/** "24 m to drain · 140 m to water" — the stored Sensitivity distances (SPEC §11). */
function WaterLine({ f }: { f: Feature }) {
  const p = f.properties;
  const drain = p.d_drain_m;
  const water = p.d_water_m;
  if (drain == null && water == null) return null;
  const nearest = Math.min(drain ?? Infinity, water ?? Infinity);
  const urgent = nearest <= 50;
  return (
    <p
      className={cx(
        "mt-1 flex items-center gap-1.5 font-mono text-xs",
        urgent ? "text-danger" : "text-muted",
      )}
    >
      <Icon name="droplet" size={12} className="shrink-0" />
      {drain != null ? `${metres(drain)} to drain` : null}
      {drain != null && water != null ? <span className="text-faint">·</span> : null}
      {water != null ? `${metres(water)} to water` : null}
    </p>
  );
}

function ActionButton({ status, onClick }: { status: HotspotStatus; onClick: () => void }) {
  const a = nextAction(status);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-field px-3.5 text-xs font-semibold",
        "transition-all duration-150 active:scale-95",
        a.kind === "primary"
          ? "bg-accent text-accent-fg shadow-card hover:bg-accent-hover"
          : "border border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      <Icon name={a.icon} size={14} />
      {a.label}
    </button>
  );
}

function EvidenceCell({ f }: { f: Feature }) {
  const p = f.properties;
  if (!p.evidence_band) return <span className="text-xs text-faint">No evidence yet</span>;
  const m = EVIDENCE[p.evidence_band];
  return (
    <span
      className="font-mono text-xs text-muted"
      title={`${m.label} — ${m.hint}. Weights are tunable proposals, not published truth.`}
    >
      Evidence: {fmtEvidence(p.evidence_score)} · {m.label.replace(" evidence", "")}
    </span>
  );
}

function Row({ f, selected, onOpen }: { f: Feature; selected: boolean; onOpen: () => void }) {
  const p = f.properties;
  const band = p.priority_band ?? "low";
  const closed = p.status === "resolved" || p.status === "false_positive";
  return (
    <tr
      className={cx(
        "border-t border-line align-top transition-colors",
        selected ? "bg-accent-soft/50" : "hover:bg-surface-2/60",
        closed && "opacity-70",
      )}
    >
      <td className="px-4 py-4">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: `var(--pw-band-${band})` }}
            aria-hidden
          />
          <div className="min-w-0">
            <button
              type="button"
              onClick={onOpen}
              className="text-left text-sm font-bold text-ink hover:text-accent hover:underline"
            >
              Hotspot #{p.id}
            </button>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
              <span className="rounded-field bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink">
                {p.ward_name ?? "Unmapped"}
              </span>
              <span className="text-faint">·</span>
              <span>{STATUS[p.status].label}</span>
              {p.recurrence_returns > 0 ? (
                <>
                  <span className="text-faint">·</span>
                  <span>came back {p.recurrence_returns}×</span>
                </>
              ) : null}
            </p>
            <WaterLine f={f} />
          </div>
        </div>
      </td>

      <td className="px-4 py-4">
        <div className="text-sm font-bold text-ink">{plural(p.report_count, "report")}</div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <Icon name="users" size={12} className="shrink-0" />
          {plural(p.unique_reporters, "independent reporter")}
        </p>
        <div className="mt-1">
          <EvidenceCell f={f} />
        </div>
      </td>

      <td className="px-4 py-4">
        <BandChip band={p.priority_band} score={p.impact_score} />
        <p className="mt-1.5 text-xs text-faint">reported {timeAgo(p.last_reported_at)}</p>
      </td>

      <td className="px-4 py-4">
        <p className="font-mono text-xs text-ink">{coords(f)}</p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"
        >
          <Icon name="pin" size={12} />
          Show on map
        </button>
      </td>

      <td className="px-4 py-4 text-right">
        <ActionButton status={p.status} onClick={onOpen} />
      </td>
    </tr>
  );
}

/** Phones get the same facts stacked — a five-column table is unusable at 375 px. */
function MobileCard({ f, selected, onOpen }: { f: Feature; selected: boolean; onOpen: () => void }) {
  const p = f.properties;
  const band = p.priority_band ?? "low";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "flex w-full flex-col gap-2 border-l-4 px-4 py-3.5 text-left transition-colors",
        selected ? "bg-accent-soft/50" : "hover:bg-surface-2/60",
      )}
      style={{ borderLeftColor: `var(--pw-band-${band})` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-bold text-ink">Hotspot #{p.id}</span>
          <p className="mt-0.5 text-xs text-muted">
            {p.ward_name ?? "Unmapped"} · {plural(p.report_count, "report")} · {STATUS[p.status].label}
          </p>
        </div>
        <BandChip band={p.priority_band} score={p.impact_score} />
      </div>
      <WaterLine f={f} />
      <div className="flex items-center justify-between gap-2">
        <EvidenceCell f={f} />
        <span className="text-xs text-faint">{timeAgo(p.last_reported_at)}</span>
      </div>
    </button>
  );
}

export function HotspotRegistry({
  data,
  loading,
  selectedId,
  onSelect,
  lastUpdated,
  pageSize = 8,
}: {
  data: HotspotFeatureCollection | undefined;
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  lastUpdated: number;
  pageSize?: number;
}) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [ward, setWard] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const features = useMemo(() => data?.features ?? [], [data]);

  const wards = useMemo(() => {
    const names = new Set<string>();
    for (const f of features) if (f.properties.ward_name) names.add(f.properties.ward_name);
    return [...names].sort();
  }, [features]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: features.length, pending: 0, in_progress: 0, completed: 0 };
    for (const f of features) {
      const stage = citizenStage(f.properties.status);
      if (stage !== "closed") c[stage] += 1;
    }
    return c;
  }, [features]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return features
      .filter((f) => {
        const p = f.properties;
        if (filter !== "all" && citizenStage(p.status) !== filter) return false;
        if (ward !== "all" && p.ward_name !== ward) return false;
        if (q && !`hotspot #${p.id} ${p.ward_name ?? ""} ${STATUS[p.status].label}`.toLowerCase().includes(q))
          return false;
        return true;
      })
      .sort((a, b) => (b.properties.impact_score ?? 0) - (a.properties.impact_score ?? 0));
  }, [features, filter, ward, query]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * pageSize, current * pageSize + pageSize);
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------- filter bar ---- */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-card lg:flex-row lg:items-center">
        {/* Bleeds to the card edge on phones so a clipped tab reads as "scroll for more". */}
        <div
          className="-mx-3 flex gap-1 overflow-x-auto px-3 snap-row lg:mx-0 lg:px-0"
          role="tablist"
          aria-label="Filter hotspots by stage"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={filter === t.key}
              onClick={() => reset(setFilter)(t.key)}
              className={cx(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-field px-3 text-xs font-semibold transition-colors",
                filter === t.key
                  ? "bg-accent text-accent-fg shadow-card"
                  : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
              <span
                className={cx(
                  "tabular rounded-full px-1.5 text-[11px]",
                  filter === t.key ? "bg-black/20 text-accent-fg" : "bg-surface-2 text-muted",
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
          <label className="sr-only" htmlFor="ward-filter">Ward</label>
          <select
            id="ward-filter"
            value={ward}
            onChange={(e) => reset(setWard)(e.target.value)}
            className="min-h-10 rounded-field border border-line bg-surface-2 px-3 text-sm text-ink focus:border-accent focus:outline-none"
          >
            <option value="all">All wards</option>
            {wards.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>

          <div className="relative flex-1 lg:max-w-xs">
            <Icon name="filter" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => reset(setQuery)(e.target.value)}
              placeholder="Search hotspot or ward…"
              aria-label="Search hotspots"
              className="min-h-10 w-full rounded-field border border-line bg-surface-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- registry ---- */}
      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-heading font-bold tracking-tight text-ink">
              Impact-ranked registry
            </h2>
            <span className="rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[11px] font-semibold text-accent">
              {rows.length} shown
            </span>
          </div>
          <p className="flex items-center gap-1.5 font-mono text-xs text-faint">
            <Icon name="refresh" size={12} />
            Updated {timeAgo(new Date(lastUpdated).toISOString())}
          </p>
        </header>

        {loading && !data ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-field" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="map"
            title={filter === "pending" ? "Nothing waiting for review" : "No hotspots match"}
          >
            {filter === "pending"
              ? "Every open hotspot has already had a human look at it."
              : "Try another stage, ward or search term."}
          </EmptyState>
        ) : (
          <>
            {/* desktop table */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-2">
                    {["Hotspot & location", "Reports & evidence", "Priority", "Coordinates", ""].map((h, i) => (
                      <th
                        key={h || i}
                        scope="col"
                        className={cx(
                          "px-4 py-2.5 text-eyebrow font-semibold uppercase text-muted",
                          i === 4 && "text-right",
                        )}
                      >
                        {h || <span className="sr-only">Action</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((f) => (
                    <Row
                      key={f.properties.id}
                      f={f}
                      selected={f.properties.id === selectedId}
                      onOpen={() => onSelect(f.properties.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* phone list */}
            <ul className="divide-y divide-line lg:hidden">
              {visible.map((f) => (
                <li key={f.properties.id}>
                  <MobileCard
                    f={f}
                    selected={f.properties.id === selectedId}
                    onOpen={() => onSelect(f.properties.id)}
                  />
                </li>
              ))}
            </ul>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2/50 px-4 py-3">
              <p className="text-xs text-muted">
                Showing {current * pageSize + 1}–{Math.min((current + 1) * pageSize, rows.length)} of{" "}
                {rows.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={current === 0}
                  className="min-h-10 rounded-field border border-line bg-surface px-3 text-xs font-semibold text-ink disabled:opacity-40 hover:border-line-strong"
                >
                  Prev
                </button>
                <span className="font-mono text-xs font-semibold text-accent">
                  Page {current + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={current >= pageCount - 1}
                  className="min-h-10 rounded-field border border-line bg-surface px-3 text-xs font-semibold text-ink disabled:opacity-40 hover:border-line-strong"
                >
                  Next
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

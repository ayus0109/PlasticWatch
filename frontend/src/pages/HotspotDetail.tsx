/**
 * /hotspots/:id — score explanation (two axes), the human gate, and the evidence
 * ledger (SPEC §9, §11, §13).
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { GeoFeatureCollection, HotspotDetail as Detail, VerifyResponse } from "../api/client";
import { useApi } from "../api/hooks";
import { EvidenceLedger } from "../components/EvidenceLedger";
import { Icon } from "../components/Icon";
import { MiniMap } from "../components/map/MiniMap";
import { ScoreBars } from "../components/ScoreBars";
import { Shell, SimulatedBanner } from "../components/Shell";
import { VerifyPanel } from "../components/VerifyPanel";
import {
  Card,
  EmptyState,
  ErrorState,
  SectionTitle,
  SimulatedBadge,
  Skeleton,
  StatusChip,
  Stat,
} from "../components/ui";
import { dateTime, metres, plural, timeAgo } from "../lib/format";

const PLACES: { key: keyof Detail["geo_context"]; label: string; water?: boolean }[] = [
  { key: "d_drain_m", label: "Drain / nala", water: true },
  { key: "d_water_m", label: "Water body", water: true },
  { key: "d_school_m", label: "School" },
  { key: "d_hospital_m", label: "Hospital" },
  { key: "d_market_m", label: "Market" },
];

function proximityNote(d: number | null | undefined): string {
  if (d === null || d === undefined) return "not mapped";
  if (d <= 50) return "counts fully";
  if (d >= 300) return "too far to count";
  return "counts partly";
}

export default function HotspotDetail() {
  const { id } = useParams();
  const detail = useApi<Detail>(id ? `/hotspots/${id}` : null);
  const geo = useApi<GeoFeatureCollection>("/geo/layers");
  const [freshEvent, setFreshEvent] = useState<number | null>(null);

  const onDecision = (res: VerifyResponse) => {
    // Reflect the decision immediately, then refetch for the new scores.
    detail.setData((prev) =>
      prev ? { ...prev, status: res.to_status, events: [...prev.events, res.event] } : prev,
    );
    setFreshEvent(res.event.id);
    detail.refetch();
  };

  const h = detail.data;
  return (
    <Shell banner={h?.is_simulated ? <SimulatedBanner /> : null}>
      <Link to="/map" className="mb-4 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <Icon name="chevronLeft" size={16} /> Map
      </Link>

      {detail.error ? (
        detail.error.status === 404 ? (
          <Card>
            <EmptyState icon="map" title="Hotspot not found">
              It may have been removed when the demo was reset.
            </EmptyState>
          </Card>
        ) : (
          <ErrorState message={detail.error.message} onRetry={detail.refetch} />
        )
      ) : !h ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-72" />
          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <Skeleton className="h-80 rounded-card" />
            <Skeleton className="h-80 rounded-card" />
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-fade">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-3xl font-bold tracking-tight">Hotspot #{h.id}</h1>
                <StatusChip status={h.status} />
                {h.is_simulated ? <SimulatedBadge /> : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                {h.ward_name ?? "Outside mapped wards"} · first reported{" "}
                <span title={dateTime(h.first_reported_at)}>{timeAgo(h.first_reported_at)}</span> ·{" "}
                {h.lat.toFixed(5)}, {h.lon.toFixed(5)}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-6">
              <Stat label="Reports" value={h.report_count} hint={plural(h.unique_reporters, "reporter")} />
              <Stat label="Returned" value={`${h.recurrence_returns}×`} hint="after cleanup" />
              <Stat label="Extent" value={metres(h.radius_m ?? 0)} hint="radius" />
            </div>
          </header>

          <ScoreBars key={`${h.status}-${h.score_breakdown.scored_at}`} breakdown={h.score_breakdown} />

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <section>
              <SectionTitle hint={`${h.events.length} decisions · ${h.reports.length} reports`}>
                Evidence ledger
              </SectionTitle>
              <Card className="p-4 sm:p-5">
                <EvidenceLedger events={h.events} reports={h.reports} freshEventId={freshEvent} />
              </Card>
            </section>

            <aside className="space-y-4">
              <VerifyPanel hotspotId={h.id} status={h.status} onDone={onDecision} />
              <Card className="overflow-hidden">
                <MiniMap h={h} geo={geo.data} />
                <div className="p-4">
                  <SectionTitle hint="stored, not recomputed">Nearby</SectionTitle>
                  <ul className="space-y-2 text-sm">
                    {PLACES.map((p) => {
                      const d = h.geo_context[p.key];
                      return (
                        <li key={p.key} className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-2">
                            <Icon name={p.water ? "droplet" : "users"} size={15} className="text-muted" />
                            {p.label}
                          </span>
                          <span className="text-right">
                            <span className="tabular font-semibold">{metres(d)}</span>
                            <span className="ml-2 text-xs text-faint">{proximityNote(d)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 text-xs text-faint">
                    Within 50 m counts fully toward Sensitivity; beyond 300 m doesn't count.
                  </p>
                </div>
              </Card>
            </aside>
          </div>
        </div>
      )}
    </Shell>
  );
}

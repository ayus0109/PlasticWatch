/**
 * /queue — hotspots waiting for a human (needs_verification), highest Impact first.
 * Inline verify / reject with optimistic removal; a refused decision (409/403) puts
 * the card back and explains why. Each card shows the latest photo, because
 * verifying without looking at the evidence would make the human gate a rubber stamp.
 */
import { useState } from "react";
import { Link } from "react-router";
import {
  api,
  mediaUrl,
  type HotspotDetail,
  type HotspotFeature,
  type HotspotFeatureCollection,
  type RejectReason,
  type VerifyResponse,
} from "../api/client";
import { useApi } from "../api/hooks";
import { Icon } from "../components/Icon";
import { Shell, SimulatedBanner } from "../components/Shell";
import { useToast } from "../components/Toast";
import { friendlyError } from "../components/VerifyPanel";
import {
  BandChip,
  Button,
  Card,
  EmptyState,
  ErrorState,
  EvidenceChip,
  SimulatedBadge,
  Skeleton,
  TierChip,
  cx,
} from "../components/ui";
import { impact, plural, timeAgo } from "../lib/format";
import { REJECT_REASONS } from "../lib/status";

function QueueCard({
  f,
  rank,
  onDecided,
}: {
  f: HotspotFeature;
  rank: number;
  onDecided: (id: number, undo: boolean) => void;
}) {
  const p = f.properties;
  const toast = useToast();
  const detail = useApi<HotspotDetail>(`/hotspots/${p.id}`);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason | "">("");
  const latest = detail.data?.reports.find((r) => !r.is_duplicate) ?? detail.data?.reports[0];
  const img = mediaUrl(latest?.annotated_jpg_path ?? latest?.image_path);

  const decide = async (decision: "verify" | "reject") => {
    onDecided(p.id, false); // optimistic: the card leaves the queue now
    try {
      await api.post<VerifyResponse>(`/hotspots/${p.id}/verify`, {
        decision,
        reason: decision === "reject" ? reason : undefined,
      });
      toast("ok", decision === "verify" ? `Hotspot #${p.id} verified.` : `Hotspot #${p.id} rejected.`);
    } catch (e) {
      onDecided(p.id, true); // put it back
      toast("error", friendlyError(e));
    }
  };

  return (
    <Card as="article" className="overflow-hidden animate-rise">
      <div className="flex flex-col md:flex-row">
        <div className="relative h-48 shrink-0 bg-surface-2 md:h-auto md:w-60">
          {img ? (
            <img src={img} alt="Latest report photo, annotated" className="h-full w-full object-cover" loading="lazy" />
          ) : detail.error ? null : (
            <Skeleton className="h-full w-full rounded-none" />
          )}
          <span className="absolute left-2 top-2 grid h-8 min-w-8 place-items-center rounded-full bg-surface px-2 text-sm font-bold shadow-raised">
            {rank}
          </span>
          {p.is_simulated ? <SimulatedBadge className="absolute bottom-2 left-2" /> : null}
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">
                Hotspot #{p.id}{" "}
                <span className="font-normal text-muted">· {p.ward_name ?? "Outside mapped wards"}</span>
              </h3>
              <p className="text-xs text-muted">
                {plural(p.report_count, "report")} from {plural(p.unique_reporters, "reporter")} ·
                first {timeAgo(p.first_reported_at)}
                {p.recurrence_returns ? ` · returned ${p.recurrence_returns}× after cleanup` : ""}
              </p>
            </div>
            <div className="text-right">
              <div className="font-display text-2xl font-bold leading-none tracking-tight">
                {impact(p.impact_score)}
              </div>
              <div className="text-[11px] text-muted">Impact</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <BandChip band={p.priority_band} />
            <EvidenceChip band={p.evidence_band} score={p.evidence_score} />
            {latest?.confidence_tier ? (
              <TierChip tier={latest.confidence_tier} value={latest.report_confidence} label="model conf." />
            ) : null}
          </div>
          {latest?.note ? <p className="text-sm text-muted">“{latest.note}”</p> : null}

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            {rejecting ? (
              <>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as RejectReason)}
                  className="min-h-10 flex-1 rounded-[10px] border border-line bg-surface px-3 text-sm"
                  aria-label="Reason for rejecting"
                  autoFocus
                >
                  <option value="" disabled>
                    Reason…
                  </option>
                  {REJECT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <Button variant="danger" disabled={!reason} onClick={() => decide("reject")}>
                  Reject
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" icon="check" onClick={() => decide("verify")}>
                  Verify
                </Button>
                <Button icon="x" onClick={() => setRejecting(true)}>
                  Reject
                </Button>
                <Link
                  to={`/hotspots/${p.id}`}
                  className="ml-auto inline-flex min-h-10 items-center gap-1 px-2 text-sm font-semibold text-accent hover:underline"
                >
                  Full evidence <Icon name="chevronRight" size={15} />
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function Queue() {
  const q = useApi<HotspotFeatureCollection>("/hotspots", { status: "needs_verification" });
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const onDecided = (id: number, undo: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (undo) next.delete(id);
      else next.add(id);
      return next;
    });

  const items = (q.data?.features ?? []).filter((f) => !hidden.has(f.properties.id));
  const simulated = items.some((f) => f.properties.is_simulated);

  return (
    <Shell banner={simulated ? <SimulatedBanner /> : null}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Verification queue</h1>
            <p className="mt-1 text-sm text-muted">
              Hotspots with enough evidence to deserve a human look, ranked by Impact.
            </p>
          </div>
          <Button variant="ghost" icon="refresh" onClick={() => { setHidden(new Set()); q.refetch(); }}>
            Refresh
          </Button>
        </div>

        {q.error ? (
          <ErrorState message={q.error.message} onRetry={q.refetch} />
        ) : !q.data ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-card" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon="check"
              title="Queue is clear"
              action={
                <Link to="/map" className="inline-flex min-h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-semibold text-accent-fg">
                  Open the map
                </Link>
              }
            >
              Nothing is waiting for verification. AI-flagged hotspots join the queue once a
              second person reports them or their evidence is strong enough.
            </EmptyState>
          </Card>
        ) : (
          <div className={cx("space-y-3")}>
            {items.map((f, i) => (
              <QueueCard key={f.properties.id} f={f} rank={i + 1} onDecided={onDecided} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

/**
 * Everything an authority does to one hotspot, in one drawer (PS-08 government flow):
 * triage (verify / rule out) -> dispatch cleanup -> upload the crew's after-photos ->
 * approve or send back. The status machine is the backend's; this only offers the
 * action that applies right now, and NOTHING here closes a hotspot on its own: only
 * the explicit approval click does (CLAUDE.md §2.5).
 */
import { useEffect, useState } from "react";
import {
  api,
  type DemoUser,
  type HotspotDetail,
  type ReviewResponse,
  type VerifyResponse,
  type WardFeatureCollection,
} from "../api/client";
import { useApi } from "../api/hooks";
import { AfterPhotos } from "./AfterPhotos";
import { BeforeAfterCompare, BeforeAfterFacts, ReviewPanel, VerdictChip } from "./BeforeAfter";
import { EvidenceLedger } from "./EvidenceLedger";
import { Icon } from "./Icon";
import { ScoreBars } from "./ScoreBars";
import { useToast } from "./Toast";
import { allowedDecisions, friendlyError, VerifyPanel } from "./VerifyPanel";
import {
  Button,
  Card,
  ErrorState,
  SectionTitle,
  SimulatedBadge,
  Skeleton,
  StatusChip,
  cx,
} from "./ui";
import { citizenStage, CITIZEN_STAGES } from "../lib/status";
import { dateTime, metres, plural, timeAgo } from "../lib/format";

const PLACES: { key: keyof HotspotDetail["geo_context"]; label: string; water?: boolean }[] = [
  { key: "d_drain_m", label: "Drain / nala", water: true },
  { key: "d_water_m", label: "Water body", water: true },
  { key: "d_school_m", label: "School" },
  { key: "d_hospital_m", label: "Hospital" },
  { key: "d_market_m", label: "Market" },
];

/** Centre of the mapped wards — the depot a dispatched route starts from. */
function wardsCentre(w?: WardFeatureCollection): [number, number] | null {
  const coords = (w?.features ?? []).flatMap((f) =>
    ((f.geometry as { coordinates: number[][][][] }).coordinates ?? []).flat(2),
  );
  if (!coords.length) return null;
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function Stage({ status }: { status: HotspotDetail["status"] }) {
  const stage = citizenStage(status);
  if (stage === "closed") {
    return <p className="text-xs text-muted">Ruled out — citizens see this report as closed.</p>;
  }
  const at = CITIZEN_STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress as citizens see it">
      {CITIZEN_STAGES.map((s, i) => (
        <li key={s.key} className="flex flex-1 items-center gap-1.5">
          <span
            className={cx(
              "flex h-6 flex-1 items-center justify-center rounded-full px-2 text-[11px] font-semibold",
              i < at && "bg-ok-soft text-ok",
              i === at && "bg-accent text-accent-fg",
              i > at && "bg-surface-2 text-muted",
            )}
          >
            {i < at ? <Icon name="check" size={12} /> : null}
            <span className={i < at ? "ml-1" : ""}>{s.label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Dispatch({ hotspot, onDone }: { hotspot: HotspotDetail; onDone: () => void }) {
  const toast = useToast();
  const users = useApi<DemoUser[]>("/auth/demo-users");
  const wards = useApi<WardFeatureCollection>("/wards");
  const [busy, setBusy] = useState(false);
  const crew = (users.data ?? []).find((u) => u.role === "team");
  const depot = wardsCentre(wards.data);

  const dispatch = async () => {
    if (!crew || !depot) return;
    setBusy(true);
    try {
      await api.post("/tasks", { hotspot_ids: [hotspot.id], team_id: crew.id, depot });
      toast("ok", `Hotspot #${hotspot.id} dispatched for cleanup.`);
      onDone();
    } catch (e) {
      toast("error", friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Icon name="truck" size={18} className="text-accent" />
        <h2 className="font-semibold">Dispatch cleanup</h2>
      </div>
      <p className="mt-1 text-sm text-muted">
        Sends this verified hotspot out for cleanup. Citizens following it will see{" "}
        <strong className="text-ink">Work in progress</strong>.
      </p>
      <Button
        variant="primary"
        icon="truck"
        className="mt-4 w-full"
        loading={busy}
        disabled={!crew || !depot}
        onClick={dispatch}
      >
        Dispatch cleanup
      </Button>
    </Card>
  );
}

export function HotspotDrawer({
  hotspotId,
  onClose,
  onChanged,
}: {
  hotspotId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useApi<HotspotDetail>(`/hotspots/${hotspotId}`);
  const h = detail.data;
  const [freshEvent, setFreshEvent] = useState<number | null>(null);
  const [showLedger, setShowLedger] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const afterDecision = (res: VerifyResponse | ReviewResponse) => {
    setFreshEvent(res.event.id);
    detail.refetch();
    onChanged();
  };

  const ba = h?.before_after;
  const awaitingApproval = h?.status === "cleanup_completed" && ba;

  return (
    <aside
      className="flex h-full w-full flex-col overflow-y-auto border-l border-line bg-surface shadow-pop"
      role="dialog"
      aria-label={`Hotspot ${hotspotId} details`}
    >
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight">Hotspot #{hotspotId}</h2>
            {h ? <StatusChip status={h.status} /> : null}
            {h?.is_simulated ? <SimulatedBadge /> : null}
          </div>
          {h ? (
            <p className="mt-0.5 text-xs text-muted">
              {h.ward_name ?? "Outside mapped wards"} · {h.lat.toFixed(5)}, {h.lon.toFixed(5)} ·
              first reported <span title={dateTime(h.first_reported_at)}>{timeAgo(h.first_reported_at)}</span>
            </p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          aria-label="Close hotspot details"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="x" size={18} />
        </button>
      </header>

      <div className="space-y-5 p-4">
        {detail.error ? (
          <ErrorState message={detail.error.message} onRetry={detail.refetch} />
        ) : !h ? (
          <>
            <Skeleton className="h-24 rounded-card" />
            <Skeleton className="h-64 rounded-card" />
          </>
        ) : (
          <>
            <Stage status={h.status} />

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-surface-2 p-2.5">
                <div className="tabular text-xl font-bold">{h.report_count}</div>
                <div className="text-[11px] text-muted">{plural(h.unique_reporters, "reporter")}</div>
              </div>
              <div className="rounded-xl bg-surface-2 p-2.5">
                <div className="tabular text-xl font-bold">{metres(h.geo_context.d_drain_m)}</div>
                <div className="text-[11px] text-muted">to nearest drain</div>
              </div>
              <div className="rounded-xl bg-surface-2 p-2.5">
                <div className="tabular text-xl font-bold">{h.recurrence_returns}×</div>
                <div className="text-[11px] text-muted">came back</div>
              </div>
            </div>

            <ScoreBars key={`${h.status}-${h.score_breakdown.scored_at}`} breakdown={h.score_breakdown} />

            {/* The action that applies right now — never more than one. */}
            {h.status === "verified" ? (
              <Dispatch hotspot={h} onDone={() => { detail.refetch(); onChanged(); }} />
            ) : null}

            {h.status === "cleanup_scheduled" && h.cleanup_task_id && h.cleanup_stop_id ? (
              <Card className="p-5">
                <div className="flex items-center gap-2">
                  <Icon name="camera" size={18} className="text-accent" />
                  <h2 className="font-semibold">Cleanup photos</h2>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Upload the crew's two after-photos (one wide, one close). They are checked
                  against the before photo — the result is a suggestion for you to review.
                </p>
                <AfterPhotos
                  taskId={h.cleanup_task_id}
                  stopId={h.cleanup_stop_id}
                  onDone={() => { detail.refetch(); onChanged(); }}
                />
              </Card>
            ) : null}

            {ba ? (
              <section>
                <SectionTitle hint={`photos ${timeAgo(ba.created_at)}`}>
                  <span className="inline-flex items-center gap-2">
                    Before / after <VerdictChip verdict={ba.verdict} />
                  </span>
                </SectionTitle>
                <Card className="space-y-4 p-4">
                  <BeforeAfterCompare record={ba} />
                  <BeforeAfterFacts record={ba} />
                  {awaitingApproval ? (
                    <ReviewPanel record={{ ...ba, hotspot_status: h.status }} onDone={afterDecision} />
                  ) : null}
                </Card>
              </section>
            ) : null}

            {allowedDecisions(h.status).length ? (
              <VerifyPanel hotspotId={h.id} status={h.status} onDone={afterDecision} />
            ) : null}

            <Card className="p-4">
              <SectionTitle hint="stored at capture, never recomputed">Nearby</SectionTitle>
              <ul className="space-y-1.5 text-sm">
                {PLACES.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-muted">
                      <Icon name={p.water ? "droplet" : "users"} size={15} />
                      {p.label}
                    </span>
                    <span className="tabular font-semibold">{metres(h.geo_context[p.key])}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-faint">
                Within 50 m counts fully toward Sensitivity; beyond 300 m doesn't count.
              </p>
            </Card>

            <div>
              <button
                onClick={() => setShowLedger((v) => !v)}
                aria-expanded={showLedger}
                className="flex min-h-10 w-full items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted hover:text-ink"
              >
                <Icon name="clipboard" size={14} />
                Evidence ledger
                <span className="ml-auto flex items-center gap-1 text-xs font-medium normal-case tracking-normal">
                  {h.events.length} decisions · {h.reports.length} reports
                  <Icon name="chevronRight" size={14} className={cx("transition-transform", showLedger && "rotate-90")} />
                </span>
              </button>
              {showLedger ? (
                <Card className="mt-2 p-4">
                  <EvidenceLedger events={h.events} reports={h.reports} freshEventId={freshEvent} />
                </Card>
              ) : null}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

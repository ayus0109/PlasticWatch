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
  mediaUrl,
  type DemoUser,
  type HotspotDetail,
  type ReportSummary,
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
              "flex h-6 flex-1 items-center justify-center rounded-full px-2 text-micro font-semibold",
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
    <Card pad="roomy">
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

function CitizenProofCard({ reports }: { reports: ReportSummary[] }) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const current = reports[selectedIdx] ?? reports[0];
  if (!current) {
    return (
      <Card className="text-center text-body text-muted">
        No citizen photo attached yet.
      </Card>
    );
  }

  const img = mediaUrl(current.annotated_jpg_path ?? current.image_path);

  return (
    <Card pad="none" className="overflow-hidden border-accent/40 shadow-raised">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/20 text-accent font-bold">
            <Icon name="camera" size={13} />
          </span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-accent">
            Citizen Proof & Evidence
          </h3>
        </div>
        {reports.length > 1 ? (
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <button
              disabled={selectedIdx <= 0}
              onClick={() => setSelectedIdx((i) => Math.max(0, i - 1))}
              className="rounded-field p-1 hover:bg-surface disabled:opacity-30"
              title="Previous report"
            >
              <Icon name="chevronLeft" size={14} />
            </button>
            <span className="font-semibold text-ink">
              {selectedIdx + 1} / {reports.length}
            </span>
            <button
              disabled={selectedIdx >= reports.length - 1}
              onClick={() => setSelectedIdx((i) => Math.min(reports.length - 1, i + 1))}
              className="rounded-field p-1 hover:bg-surface disabled:opacity-30"
              title="Next report"
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
        ) : null}
      </div>

      {img ? (
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-black/40">
          <img
            src={img}
            alt="Reported waste"
            className="h-full w-full object-cover"
          />
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-black/75 px-2 py-0.5 text-micro font-semibold text-white backdrop-blur-sm">
              {current.plastic_count ?? 0} likely-plastic items
            </span>
            {current.is_simulated ? <SimulatedBadge /> : null}
          </div>
          <a
            href={img}
            target="_blank"
            rel="noreferrer"
            className="absolute top-2 right-2 rounded-field bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/80"
          >
            Full photo ↗
          </a>
        </div>
      ) : null}

      <div className="space-y-3 p-3">
        {/* Reporter contact & proof box */}
        <div className="rounded-field border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-micro font-semibold uppercase tracking-wider text-muted">
                Reported by Citizen
              </div>
              <div className="font-display text-base font-bold text-ink">
                {current.reporter_name || "Local Resident"}
              </div>
            </div>
            {current.reporter_phone ? (
              <a
                href={`tel:${current.reporter_phone}`}
                className="inline-flex items-center gap-1.5 rounded-field bg-accent px-3 py-1.5 text-xs font-bold text-accent-fg shadow-card transition hover:opacity-90 active:scale-95"
              >
                <Icon name="phone" size={13} />
                <span>Call {current.reporter_phone}</span>
              </a>
            ) : (
              <span className="rounded-full bg-surface px-2 py-1 text-micro text-muted">
                No phone recorded
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} /> {timeAgo(current.created_at)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Icon name="pin" size={12} /> via {current.location_source === "browser" ? "Phone GPS" : current.location_source === "exif" ? "Photo EXIF" : "Map Pin"}</span>
          </div>
        </div>

        {current.note ? (
          <div className="rounded-field border border-line bg-surface px-3 py-2 text-xs">
            <strong className="text-muted">Landmark / Note: </strong>
            <span className="italic text-ink font-medium">“{current.note}”</span>
          </div>
        ) : null}
      </div>
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
  const [showGis, setShowGis] = useState(false);

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
      className="flex h-full w-full flex-col overflow-y-auto rounded-t-2xl border-line bg-surface shadow-pop md:rounded-none md:border-l"
      role="dialog"
      aria-label={`Hotspot ${hotspotId} details`}
    >
      {/* Grab handle: tells a thumb this sheet can be dismissed. */}
      <div className="sticky top-0 z-20 flex justify-center bg-surface pt-2 md:hidden" aria-hidden>
        <span className="h-1.5 w-10 rounded-full bg-line-strong" />
      </div>
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur-md max-md:top-4">
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
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink active:scale-95"
        >
          <Icon name="x" size={18} />
        </button>
      </header>

      <div className="pb-safe space-y-5 p-4">
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

            {/* 1. CITIZEN PROOF & PHOTO (FIRST THING AN OFFICIAL SEES) */}
            <CitizenProofCard reports={h.reports} />

            {/* 2. ACTIONS FOR GOVERNMENT — THE ONE THING TO DO NEXT */}
            {allowedDecisions(h.status).length ? (
              <VerifyPanel hotspotId={h.id} status={h.status} onDone={afterDecision} />
            ) : null}

            {h.status === "verified" ? (
              <Dispatch hotspot={h} onDone={() => { detail.refetch(); onChanged(); }} />
            ) : null}

            {h.status === "cleanup_scheduled" && h.cleanup_task_id && h.cleanup_stop_id ? (
              <Card pad="roomy">
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
                <Card className="space-y-4">
                  <BeforeAfterCompare record={ba} />
                  <BeforeAfterFacts record={ba} />
                  {awaitingApproval ? (
                    <ReviewPanel record={{ ...ba, hotspot_status: h.status }} onDone={afterDecision} />
                  ) : null}
                </Card>
              </section>
            ) : null}

            {/* 3. TECHNICAL GIS, SCORING & AUDIT DETAILS (COLLAPSIBLE FOR CLEAN EASY UI) */}
            <div className="rounded-card border border-line bg-surface-2 overflow-hidden">
              <button
                onClick={() => setShowGis((v) => !v)}
                className="flex w-full items-center justify-between p-3 text-left text-xs font-semibold text-muted hover:text-ink transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Icon name="chart" size={15} className="text-accent" />
                  <span>GIS & Impact Breakdown (Score: {Math.round(h.score_breakdown.impact_score)}/100)</span>
                </span>
                <span className="flex items-center gap-1 text-micro font-medium text-accent">
                  {showGis ? "Hide details" : "View equations & context"}
                  <Icon name="chevronRight" size={14} className={cx("transition-transform", showGis && "rotate-90")} />
                </span>
              </button>

              {showGis ? (
                <div className="border-t border-line p-4 space-y-4 bg-surface animate-rise">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-field bg-surface-2 p-3">
                      <div className="tabular text-xl font-bold">{h.report_count}</div>
                      <div className="text-micro text-muted">{plural(h.unique_reporters, "reporter")}</div>
                    </div>
                    <div className="rounded-field bg-surface-2 p-3">
                      <div className="tabular text-xl font-bold">{metres(h.geo_context.d_drain_m)}</div>
                      <div className="text-micro text-muted">to nearest drain</div>
                    </div>
                    <div className="rounded-field bg-surface-2 p-3">
                      <div className="tabular text-xl font-bold">{h.recurrence_returns}×</div>
                      <div className="text-micro text-muted">came back</div>
                    </div>
                  </div>

                  <ScoreBars key={`${h.status}-${h.score_breakdown.scored_at}`} breakdown={h.score_breakdown} />

                  <Card pad="compact" className="bg-surface-2/60">
                    <SectionTitle hint="spatial proximity">Nearby Amenities</SectionTitle>
                    <ul className="space-y-1 text-xs">
                      {PLACES.map((p) => (
                        <li key={p.key} className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-1.5 text-muted">
                            <Icon name={p.water ? "droplet" : "users"} size={13} />
                            {p.label}
                          </span>
                          <span className="tabular font-semibold">{metres(h.geo_context[p.key])}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              ) : null}
            </div>

            {/* 4. AUDIT & DECISION LEDGER */}
            <div>
              <button
                onClick={() => setShowLedger((v) => !v)}
                aria-expanded={showLedger}
                className="flex min-h-10 w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink"
              >
                <Icon name="clipboard" size={14} />
                Audit History
                <span className="ml-auto flex items-center gap-1 text-xs font-medium normal-case tracking-normal">
                  {h.events.length} decisions · {h.reports.length} reports
                  <Icon name="chevronRight" size={14} className={cx("transition-transform", showLedger && "rotate-90")} />
                </span>
              </button>
              {showLedger ? (
                <Card pad="compact" className="mt-2">
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

/**
 * The evidence ledger: citizen reports and audit events on one timeline, newest
 * first. Every status change names the human who made it — or "System" for the
 * automatic steps (creation, attach, promotion, reopen). Nothing here names who
 * caused the waste (CLAUDE.md §2.3).
 */
import type { HotspotEvent, ReportSummary } from "../api/client";
import { dateTime, timeAgo } from "../lib/format";
import { REASON_LABEL, STATUS } from "../lib/status";
import { Icon } from "./Icon";
import { ReportImage } from "./ReportImage";
import { Chip, TierChip, cx } from "./ui";

type Item =
  | { kind: "report"; at: string; report: ReportSummary }
  | { kind: "event"; at: string; event: HotspotEvent };

function EventRow({ e, fresh }: { e: HotspotEvent; fresh: boolean }) {
  const to = STATUS[e.to_status];
  const statusChanged = e.from_status !== e.to_status;
  const human = Boolean(e.actor_id);
  return (
    <div className={cx("flex gap-3", fresh && "animate-rise")}>
      <span
        className={cx(
          "z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-surface",
          human ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
        )}
      >
        <Icon name={statusChanged ? to.icon : "pin"} size={14} />
      </span>
      <div className={cx("min-w-0 flex-1 rounded-field px-3 py-2", fresh && "bg-accent-soft")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {statusChanged ? (
            <>
              {e.from_status ? (
                <span className="text-muted">{STATUS[e.from_status].label} →</span>
              ) : null}
              <span className="font-semibold">{to.label}</span>
            </>
          ) : (
            <span className="font-medium">Evidence added</span>
          )}
          {e.reason ? <Chip tone="muted">{REASON_LABEL[e.reason]}</Chip> : null}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {human ? (
            <span className="font-semibold text-ink">{e.actor_name ?? "Authority"}</span>
          ) : (
            <span>System</span>
          )}{" "}
          · <span title={dateTime(e.created_at)}>{timeAgo(e.created_at)}</span>
        </div>
        {e.note ? <p className="mt-1 text-sm text-muted">{e.note}</p> : null}
      </div>
    </div>
  );
}

function ReportRow({ r }: { r: ReportSummary }) {
  return (
    <div className="flex gap-3">
      <span className="z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-surface bg-surface-2 text-muted">
        <Icon name="camera" size={14} />
      </span>
      <div className="min-w-0 flex-1 overflow-hidden rounded-field border border-line">
        <div className="flex gap-3 p-3">
          <div className="shrink-0 h-20 w-28 overflow-hidden rounded-field bg-surface-2">
            <ReportImage
              path={r.annotated_jpg_path ?? r.image_path}
              reportId={r.id}
              className="h-full w-full object-cover transition-opacity hover:opacity-90"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
              <span>{r.reporter_name ? `Report by ${r.reporter_name}` : "Citizen report"}</span>
              {r.is_duplicate ? <Chip tone="info">Duplicate photo</Chip> : null}
            </div>
            {r.reporter_phone ? (
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold text-accent">
                  <Icon name="phone" size={13} /> {r.reporter_phone}
                </span>
                <a
                  href={`tel:${r.reporter_phone}`}
                  className="rounded-full bg-accent-soft px-2 py-0.5 text-micro font-semibold text-accent hover:bg-accent hover:text-accent-fg transition-colors"
                >
                  Call Citizen
                </a>
              </div>
            ) : null}
            <div className="mt-1 text-xs text-muted">
              <span title={dateTime(r.created_at)}>{timeAgo(r.created_at)}</span> ·{" "}
              {r.ai_status === "detected"
                ? `${r.plastic_count ?? 0} likely-plastic items`
                : "no likely plastic found"}{" "}
              · via {r.location_source === "browser" ? "GPS" : r.location_source === "exif" ? "photo EXIF" : "map pin"}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {r.confidence_tier ? <TierChip tier={r.confidence_tier} value={r.report_confidence} /> : null}
              {r.low_accuracy ? <Chip tone="warn" icon="crosshair">Low location accuracy</Chip> : null}
            </div>
            {r.note ? <p className="mt-1.5 text-sm text-muted">“{r.note}”</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EvidenceLedger({
  events,
  reports,
  freshEventId,
}: {
  events: HotspotEvent[];
  reports: ReportSummary[];
  freshEventId?: number | null;
}) {
  const items: Item[] = [
    ...events.map((event) => ({ kind: "event" as const, at: event.created_at, event })),
    ...reports.map((report) => ({ kind: "report" as const, at: report.created_at, report })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-0.5 before:bg-line">
      {items.map((it) => (
        <li key={it.kind === "event" ? `e${it.event.id}` : `r${it.report.id}`}>
          {it.kind === "event" ? (
            <EventRow e={it.event} fresh={it.event.id === freshEventId} />
          ) : (
            <ReportRow r={it.report} />
          )}
        </li>
      ))}
    </ol>
  );
}

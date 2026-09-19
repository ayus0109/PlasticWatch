import { Link } from "react-router";
import type { HotspotProperties } from "../../api/client";
import { impact, plural, timeAgo } from "../../lib/format";
import { HUMAN_VERIFIED } from "../../lib/status";
import { Icon } from "../Icon";
import { BandChip, EvidenceChip, SimulatedBadge, StatusChip, Stat } from "../ui";

export function HotspotPreview({
  p,
  onClose,
}: {
  p: HotspotProperties;
  onClose: () => void;
}) {
  return (
    <div className="w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 shadow-pop animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">Hotspot #{p.id}</h3>
            {p.is_simulated ? <SimulatedBadge /> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {p.ward_name ?? "Outside mapped wards"} · last reported {timeAgo(p.last_reported_at)}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close preview"
          className="-mr-1 -mt-1 grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <BandChip band={p.priority_band} />
        <StatusChip status={p.status} />
        {/* Once a human has verified it, the status chip already says so. */}
        {HUMAN_VERIFIED.has(p.status) ? null : (
          <EvidenceChip band={p.evidence_band} score={p.evidence_score} />
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-surface-2 p-3">
        <Stat label="Impact" value={impact(p.impact_score)} hint="of 100" />
        <Stat label="Reports" value={p.report_count} hint={plural(p.unique_reporters, "reporter")} />
        <Stat
          label="Returned"
          value={`${p.recurrence_returns}×`}
          hint="after cleanup"
        />
      </div>

      <Link
        to={`/hotspots/${p.id}`}
        className="mt-4 flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-accent text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
      >
        Open evidence ledger <Icon name="arrowRight" size={16} />
      </Link>
    </div>
  );
}

import { Link } from "react-router";
import { mediaUrl, type ReportSummary } from "../api/client";
import { useApi } from "../api/hooks";
import { Shell } from "../components/Shell";
import { StageTracker } from "../components/StageTracker";
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  SimulatedBadge,
  Skeleton,
  TierChip,
} from "../components/ui";
import { dateTime, plural, timeAgo } from "../lib/format";
import { citizenStage } from "../lib/status";

function ReportCard({ r }: { r: ReportSummary }) {
  const img = mediaUrl(r.annotated_jpg_path ?? r.image_path);
  const detected = r.ai_status === "detected";
  return (
    <Card as="article" interactive pad="none" className="overflow-hidden animate-rise">
      <div className="flex flex-col sm:flex-row">
        <div className="relative h-44 shrink-0 bg-surface-2 sm:h-auto sm:w-48">
          {img ? <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
          {r.is_simulated ? <SimulatedBadge className="absolute bottom-2 left-2" /> : null}
        </div>
        <div className="flex-1 space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">
                {detected
                  ? `Likely plastic · ${plural(r.plastic_count ?? 0, "item")}`
                  : r.ai_status === "error"
                    ? "Couldn't be analysed"
                    : "No likely plastic found"}
              </h3>
              <p className="text-xs text-muted" title={dateTime(r.created_at)}>
                Reported {timeAgo(r.created_at)}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.confidence_tier ? <TierChip tier={r.confidence_tier} value={r.report_confidence} /> : null}
              {r.is_duplicate ? <Chip tone="info">Same photo as an earlier report</Chip> : null}
              {r.low_accuracy ? <Chip tone="warn" icon="crosshair">Low location accuracy</Chip> : null}
            </div>
          </div>
          {r.note ? <p className="text-sm text-muted">“{r.note}”</p> : null}
          {r.hotspot_status ? (
            <StageTracker stage={citizenStage(r.hotspot_status)} status={r.hotspot_status} />
          ) : (
            <p className="text-sm text-muted">
              {detected ? "Waiting to be matched to a hotspot." : "Not added to a hotspot."}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function MyReports() {
  const reports = useApi<ReportSummary[]>("/reports/mine");
  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">My reports</h1>
            <p className="mt-1 text-sm text-muted">Follow each report from pending to completed.</p>
          </div>
          <Link
            to="/report"
            className="inline-flex min-h-11 items-center rounded-field bg-accent px-4 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
          >
            New report
          </Link>
        </div>
        {reports.error ? (
          <ErrorState message={reports.error.message} onRetry={reports.refetch} />
        ) : !reports.data ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44 w-full rounded-card" />
            ))}
          </div>
        ) : reports.data.length === 0 ? (
          <Card pad="none">
            <EmptyState
              icon="camera"
              title="No reports yet"
              action={
                <Link
                  to="/report"
                  className="inline-flex min-h-11 items-center rounded-field bg-accent px-4 text-sm font-semibold text-accent-fg"
                >
                  Report waste
                </Link>
              }
            >
              When you report waste, you'll see here whether it's been verified and cleaned up.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-3">
            {reports.data.map((r) => (
              <ReportCard key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

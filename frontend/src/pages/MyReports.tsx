import { useState } from "react";
import { Link } from "react-router";
import type { ReportSummary } from "../api/client";
import { useApi } from "../api/hooks";
import { Icon } from "../components/Icon";
import { ReportImage } from "../components/ReportImage";
import { ReportProgressModal } from "../components/ReportProgressModal";
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

function ReportCard({
  r,
  onSelect,
}: {
  r: ReportSummary;
  onSelect: () => void;
}) {
  const detected = r.ai_status === "detected";
  const stage = r.hotspot_status ? citizenStage(r.hotspot_status) : "pending";
  const isCompleted =
    stage === "completed" ||
    r.hotspot_status === "resolved" ||
    r.hotspot_status === "cleanup_completed";
  const isInProgress =
    stage === "in_progress" ||
    r.hotspot_status === "cleanup_scheduled";

  return (
    <Card
      as="article"
      interactive
      pad="none"
      className="group overflow-hidden animate-rise cursor-pointer transition-all duration-200 hover:border-accent hover:shadow-raised"
      onClick={onSelect}
    >
      <div className="flex flex-col sm:flex-row">
        <div className="relative h-44 shrink-0 bg-surface-2 sm:h-auto sm:w-52 overflow-hidden">
          <ReportImage
            path={r.annotated_jpg_path ?? r.image_path}
            reportId={r.id}
            alt="Reported waste"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          {r.is_simulated ? <SimulatedBadge className="absolute top-2 right-2" /> : null}
          {isCompleted ? (
            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-ok/90 px-2.5 py-0.5 text-micro font-bold text-white shadow-sm backdrop-blur-sm">
              <Icon name="check" size={11} /> Cleaned
            </span>
          ) : isInProgress ? (
            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-accent/90 px-2.5 py-0.5 text-micro font-bold text-accent-fg shadow-sm backdrop-blur-sm">
              <Icon name="truck" size={11} /> Cleaning
            </span>
          ) : null}
        </div>

        <div className="flex-1 space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-base text-ink group-hover:text-accent transition-colors">
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
            <StageTracker stage={stage} status={r.hotspot_status} />
          ) : (
            <p className="text-sm text-muted">
              {detected ? "Waiting to be matched to a hotspot." : "Not added to a hotspot."}
            </p>
          )}

          {/* Interactive Action Prompt */}
          {isCompleted ? (
            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-ok-soft/80 border border-ok/30 px-3 py-2 text-xs font-semibold text-ok transition-colors group-hover:bg-ok-soft">
              <span className="flex items-center gap-1.5 font-bold">
                <Icon name="check" size={15} />
                <span>Cleanup Confirmed · Before & After Proof Available</span>
              </span>
              <span className="inline-flex items-center gap-1 text-accent font-bold group-hover:translate-x-0.5 transition-transform">
                View Proof →
              </span>
            </div>
          ) : isInProgress ? (
            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-accent-soft/60 border border-accent/25 px-3 py-2 text-xs font-semibold text-accent transition-colors">
              <span className="flex items-center gap-1.5">
                <Icon name="truck" size={15} />
                <span>Sanitation Crew Dispatched · Cleanup in Progress</span>
              </span>
              <span className="inline-flex items-center gap-1 font-bold group-hover:translate-x-0.5 transition-transform">
                Track Progress →
              </span>
            </div>
          ) : (
            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-surface-2/60 border border-line px-3 py-1.5 text-xs text-muted transition-colors">
              <span className="flex items-center gap-1.5">
                <Icon name="route" size={14} />
                <span>Click to view report progress & details</span>
              </span>
              <span className="text-accent font-semibold group-hover:translate-x-0.5 transition-transform">
                Details →
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function MyReports() {
  const reports = useApi<ReportSummary[]>("/reports/mine");
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">My reports</h1>
            <p className="mt-1 text-sm text-muted">Follow each report from pending to completed and verify cleanup proof.</p>
          </div>
          <Link
            to="/report"
            className="inline-flex min-h-11 items-center rounded-field bg-accent px-4 text-sm font-semibold text-accent-fg hover:bg-accent-hover shadow-card transition-all"
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
              <ReportCard key={r.id} r={r} onSelect={() => setSelectedReport(r)} />
            ))}
          </div>
        )}

        {/* Before & After Progress Modal */}
        <ReportProgressModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
        />
      </div>
    </Shell>
  );
}

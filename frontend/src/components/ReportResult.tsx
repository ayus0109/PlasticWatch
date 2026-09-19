import { Link } from "react-router";
import type { ReportCreateResponse } from "../api/client";
import { mediaUrl } from "../api/client";
import { plural } from "../lib/format";
import { citizenStage } from "../lib/status";
import { Icon } from "./Icon";
import { StageTracker } from "./StageTracker";
import { Button, Card, Chip, SimulatedBadge, TierChip } from "./ui";

/** The citizen's result card: what the model thinks, with its tier, and what happens next. */
export function ReportResult({
  result,
  onAnother,
}: {
  result: ReportCreateResponse;
  onAnother: () => void;
}) {
  const r = result.report;
  const detected = r.ai_status === "detected";
  const img = mediaUrl(r.annotated_jpg_path ?? r.image_path);

  return (
    <Card className="overflow-hidden animate-rise">
      {img ? (
        <div className="relative bg-surface-2">
          <img src={img} alt="Your photo, annotated with likely-plastic detections" className="max-h-[420px] w-full object-contain" />
          {r.is_simulated ? <SimulatedBadge className="absolute bottom-3 left-3" /> : null}
        </div>
      ) : null}

      <div className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span
            className={
              detected
                ? "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
                : "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"
            }
          >
            <Icon name={detected ? "check" : "info"} size={20} />
          </span>
          <div>
            <h2 className="text-lg font-semibold leading-snug">
              {detected
                ? `Likely plastic: ${plural(r.plastic_count ?? 0, "item")}`
                : r.ai_status === "error"
                  ? "We couldn't analyse this photo"
                  : "No likely plastic found"}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{result.message}</p>
          </div>
        </div>

        {detected ? (
          <div className="flex flex-wrap gap-2">
            <TierChip tier={r.confidence_tier} value={r.report_confidence} />
            {result.merged ? (
              <Chip tone="info" icon="users">
                {result.duplicate_of ? "Same photo already reported" : "Joined a nearby hotspot"}
              </Chip>
            ) : (
              <Chip tone="neutral" icon="pin">
                New hotspot
              </Chip>
            )}
            {result.low_accuracy ? (
              <Chip tone="warn" icon="crosshair" title="GPS accuracy was poor; nearby reports were matched over a wider radius.">
                Low location accuracy
              </Chip>
            ) : null}
          </div>
        ) : null}

        {result.hotspot ? (
          <div className="rounded-xl bg-surface-2 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              What happens next
            </div>
            <StageTracker stage={citizenStage(result.hotspot.status)} status={result.hotspot.status} />
          </div>
        ) : null}

        <p className="text-xs leading-relaxed text-faint">
          The model's confidence is not a probability — read the tier. An authority checks
          every hotspot before any cleanup is scheduled.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" icon="camera" onClick={onAnother} className="flex-1">
            Report another
          </Button>
          <Link
            to="/my-reports"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
          >
            <Icon name="list" size={17} /> My reports
          </Link>
        </div>
      </div>
    </Card>
  );
}

import type { HotspotStatus } from "../api/client";
import { CITIZEN_STAGES, STATUS, type CitizenStage } from "../lib/status";
import { Icon } from "./Icon";
import { cx } from "./ui";

/** USERFLOW status tracking: Pending -> Work in progress -> Completed. */
export function StageTracker({ stage, status }: { stage: CitizenStage; status: HotspotStatus }) {
  if (stage === "closed") {
    return (
      <p className="flex items-start gap-2 text-sm">
        <Icon name="x" size={16} className="mt-0.5 text-muted" />
        <span>
          <strong className="font-semibold">Not taken forward.</strong>{" "}
          <span className="text-muted">An authority reviewed it and ruled it out.</span>
        </span>
      </p>
    );
  }
  const idx = CITIZEN_STAGES.findIndex((s) => s.key === stage);
  // Verified is still "pending" cleanup, but the verification itself is done:
  // show step 1 as complete, labelled Verified, rather than a contradictory Pending.
  const verified = status === "verified";
  return (
    <div>
      <ol className="flex items-center" aria-label="Report progress">
        {CITIZEN_STAGES.map((s, i) => {
          const done = i < idx || stage === "completed" || (verified && i === 0);
          const current = i === idx && stage !== "completed" && !(verified && i === 0);
          const label = verified && i === 0 ? "Verified" : s.label;
          return (
            <li key={s.key} className="flex flex-1 items-center last:flex-none">
              <span className="flex flex-col items-center gap-1.5">
                <span
                  className={cx(
                    "grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-bold transition-colors",
                    done && "border-accent bg-accent text-accent-fg",
                    current && "border-accent bg-accent-soft text-accent",
                    !done && !current && "border-line-strong text-faint",
                  )}
                  aria-current={current ? "step" : undefined}
                >
                  {done ? <Icon name="check" size={14} /> : i + 1}
                </span>
                <span className={cx("whitespace-nowrap text-[11px] font-semibold", current || done ? "text-ink" : "text-faint")}>
                  {label}
                </span>
              </span>
              {i < CITIZEN_STAGES.length - 1 ? (
                <span
                  className={cx("mx-2 mb-5 h-0.5 flex-1 rounded-full", i < idx ? "bg-accent" : "bg-line-strong")}
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-muted">{STATUS[status].hint}</p>
    </div>
  );
}

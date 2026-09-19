/**
 * Time machine (SPEC §10): drag back through the reporting history. The API
 * recomputes every score from the reports and audit events up to that moment
 * (GET /hotspots?as_of=…) — read-only, nothing stored changes.
 */
import { useEffect, useRef, useState } from "react";
import { shortDate } from "../../lib/format";
import { Icon } from "../Icon";
import { cx } from "../ui";

const DAY = 24 * 3600 * 1000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** End of the chosen day as an ISO timestamp for ?as_of=. */
export function asOfIso(start: Date, dayOffset: number): string {
  return new Date(start.getTime() + (dayOffset + 1) * DAY - 1000).toISOString();
}

export function TimeSlider({
  earliest,
  value,
  onChange,
  loading,
}: {
  /** First report date in the data; the slider spans from there to today. */
  earliest: Date;
  /** Day offset from `earliest`, or null for live. */
  value: number | null;
  onChange: (offset: number | null) => void;
  loading: boolean;
}) {
  const start = startOfDay(earliest);
  const days = Math.max(1, Math.round((startOfDay(new Date()).getTime() - start.getTime()) / DAY));
  const current = value ?? days;
  const [playing, setPlaying] = useState(false);
  const cur = useRef(current);
  cur.current = current;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = cur.current + 1;
      if (next >= days) {
        onChange(null);
        setPlaying(false);
      } else onChange(next);
    }, 450);
    return () => window.clearInterval(id);
  }, [playing, days, onChange]);

  const live = value === null;
  const date = new Date(start.getTime() + current * DAY);

  return (
    <div className="rounded-2xl border border-line bg-surface/95 p-3 shadow-raised backdrop-blur">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (playing) return setPlaying(false);
            if (live) onChange(0);
            setPlaying(true);
          }}
          aria-label={playing ? "Pause replay" : "Replay history"}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-transform active:scale-95"
        >
          {playing ? (
            <span className="flex gap-1" aria-hidden>
              <span className="h-3.5 w-1 rounded-sm bg-current" />
              <span className="h-3.5 w-1 rounded-sm bg-current" />
            </span>
          ) : (
            <Icon name="play" size={16} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 font-semibold">
              <Icon name="clock" size={13} className="text-muted" />
              {live ? "Live" : `As of ${shortDate(date)}`}
              {loading ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-r-transparent" />
              ) : null}
            </span>
            {live ? (
              <span className="text-faint">{shortDate(start)} → today</span>
            ) : (
              <button
                onClick={() => {
                  setPlaying(false);
                  onChange(null);
                }}
                className="min-h-7 rounded px-1.5 font-semibold text-accent hover:underline"
              >
                Back to live
              </button>
            )}
          </div>
          <input
            type="range"
            min={0}
            max={days}
            value={current}
            onChange={(e) => {
              setPlaying(false);
              const v = Number(e.target.value);
              onChange(v >= days ? null : v);
            }}
            aria-label="Show the map as of this day"
            aria-valuetext={live ? "Live" : shortDate(date)}
            className={cx("h-6 w-full accent-[var(--pw-accent)]")}
          />
        </div>
      </div>
      {!live ? (
        <p className="mt-1 text-[11px] leading-snug text-muted">
          Scores recomputed from reports and decisions up to this day. Nothing stored is
          changed.
        </p>
      ) : null}
    </div>
  );
}

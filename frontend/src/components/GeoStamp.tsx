/**
 * The location-and-time bar over a report photo, like a GPS-camera stamp.
 *
 * Deliberately an OVERLAY, never burned into the pixels. A baked-in bar would hide
 * the bottom of the scene from the detector (and its text could itself be detected),
 * and it would give two photos of the same pile different fingerprints, so duplicate
 * reports would stop merging (SPEC §12). The stored photo stays clean.
 *
 * It never claims more than it knows:
 *  - the source is named (phone GPS, the photo's own EXIF, or a pin the citizen placed);
 *  - coordinates carry only as many decimals as the fix supports;
 *  - "Taken" appears only when the photo recorded its time AND timezone — otherwise
 *    the stamp says "Reported", which is the one time we do know.
 */
import type { LocationSource } from "../api/client";
import { metres } from "../lib/format";
import { Icon } from "./Icon";
import { cx } from "./ui";

const SOURCE_LABEL: Record<LocationSource, string> = {
  browser: "Phone GPS",
  exif: "Photo's own GPS",
  pin: "Map pin, placed by you",
};

/** Decimals the fix can honestly support (0.0001° ≈ 11 m at the equator). */
function decimalsFor(source: LocationSource | null, accuracyM: number | null | undefined) {
  if (source === "browser" && accuracyM != null) {
    if (accuracyM <= 10) return 5;
    if (accuracyM <= 100) return 4;
    return 3;
  }
  // EXIF carries no accuracy, and a pin is only as precise as the map's zoom.
  return 4;
}

function coord(value: number, pos: string, neg: string, dp: number) {
  return `${Math.abs(value).toFixed(dp)}° ${value >= 0 ? pos : neg}`;
}

function stampTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function GeoStamp({
  lat,
  lon,
  source,
  accuracyM,
  capturedAt,
  reportedAt,
  className,
}: {
  lat: number | null | undefined;
  lon: number | null | undefined;
  source: LocationSource | null;
  accuracyM?: number | null;
  /** When the photo was taken; only ever set when its EXIF recorded a timezone. */
  capturedAt?: string | null;
  /** When it was reported. Defaults to now, for a photo not yet sent. */
  reportedAt?: string | null;
  className?: string;
}) {
  const located = lat != null && lon != null;
  const dp = decimalsFor(source, accuracyM);
  const reported = reportedAt ?? new Date().toISOString();

  // A photo taken well before it was reported is still valid evidence, but whoever
  // reviews it should know the waste may have changed since.
  const lagDays = capturedAt
    ? Math.floor((new Date(reported).getTime() - new Date(capturedAt).getTime()) / DAY_MS)
    : 0;

  return (
    <div
      role="group"
      aria-label="Where and when this photo was reported"
      className={cx(
        "pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-white",
        "backdrop-blur-[2px]",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-micro">
        <Icon name="pin" size={13} className="opacity-90" />
        {located ? (
          <>
            <span className="tabular font-mono font-medium">
              {coord(lat, "N", "S", dp)}, {coord(lon, "E", "W", dp)}
            </span>
            {source === "browser" && accuracyM != null ? (
              <span className="text-white/70">± {metres(accuracyM)}</span>
            ) : null}
          </>
        ) : (
          <span className="text-white/80">No location in this photo yet</span>
        )}
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro text-white/85">
        <Icon name="clock" size={13} className="opacity-90" />
        <span>
          {capturedAt ? "Taken" : "Reported"} {stampTime(capturedAt ?? reported)}
        </span>
        {source ? <span className="text-white/60">· {SOURCE_LABEL[source]}</span> : null}
        {lagDays >= 1 ? (
          <span className="font-semibold text-white">
            · reported {lagDays} day{lagDays === 1 ? "" : "s"} later
          </span>
        ) : null}
      </div>
    </div>
  );
}

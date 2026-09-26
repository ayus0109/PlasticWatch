/**
 * Where and when a report photo was taken, as a slim strip UNDER the photo.
 *
 * Deliberately not on the image: an overlay covered the bottom of the scene, and the
 * whole point of these screens is to show the waste. Nothing is burned into the pixels
 * either — that would hide litter from the detector and give two photos of the same
 * pile different fingerprints, so duplicate reports would stop merging (SPEC §12).
 *
 * It never claims more than it knows:
 *  - the source is named (phone GPS, the photo's own EXIF, or a pin the citizen placed);
 *  - coordinates carry only as many decimals as the fix supports;
 *  - "Taken" appears only when the photo recorded its time AND timezone — otherwise it
 *    says "Reported", which is the one time we do know.
 */
import type { LocationSource } from "../api/client";
import { metres } from "../lib/format";
import { Icon } from "./Icon";
import { cx } from "./ui";

const SOURCE_LABEL: Record<LocationSource, string> = {
  browser: "Phone GPS",
  exif: "Photo EXIF",
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

function longTime(iso: string) {
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

export function PhotoInfo({
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
      aria-label="Where and when this photo was taken"
      // Padding comes from the caller, so the strip lines up with its card's text column.
      className={cx("space-y-0.5 text-micro text-muted", className)}
    >
      <div className="flex flex-wrap items-center gap-x-1.5">
        <Icon name="pin" size={13} className="text-accent" />
        {located ? (
          <>
            <span className="tabular font-mono font-medium text-ink">
              {coord(lat, "N", "S", dp)}, {coord(lon, "E", "W", dp)}
            </span>
            {source === "browser" && accuracyM != null ? (
              <span className="text-faint">± {metres(accuracyM)}</span>
            ) : null}
            {source ? <span className="text-faint">· {SOURCE_LABEL[source]}</span> : null}
          </>
        ) : (
          <span>No location in this photo's EXIF</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5">
        <Icon name="clock" size={13} className="text-accent" />
        <span>
          {capturedAt ? "Taken" : "Reported"} {longTime(capturedAt ?? reported)}
        </span>
        {lagDays >= 1 ? (
          <span className="font-semibold text-ink">
            · {lagDays} day{lagDays === 1 ? "" : "s"} before reporting
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Where and when a report photo was taken, as a slim strip UNDER the photo — a geotag
 * that never covers the waste the photo is there to show.
 *
 *   📍 Navle Bridge, Vadgaon Budruk, Pune
 *      18.49121° N, 73.82011° E · ±8 m · Phone GPS
 *   🕐 Reported Sat, 27 Sep 2026, 08:40
 *
 * It never claims more than it knows:
 *  - the source is named (phone GPS, the photo's own GPS, or a pin the citizen placed);
 *  - coordinates carry only as many decimals as the fix supports;
 *  - the address is a LABEL from OpenStreetMap for the coordinates; if the lookup
 *    fails the coordinates still show, and nothing depends on the address.
 */
import type { LocationSource, ReverseGeocode } from "../api/client";
import { useApi } from "../api/hooks";
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
  // A photo's GPS carries no accuracy, and a pin is only as precise as the map zoom.
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
  /** When the photo was taken, if the photo recorded it. */
  capturedAt?: string | null;
  /** When it was reported. Defaults to now, for a photo not yet sent. */
  reportedAt?: string | null;
  className?: string;
}) {
  const located = lat != null && lon != null;
  const geo = useApi<ReverseGeocode>(located ? "/geo/reverse" : null, located ? { lat, lon } : undefined);
  const dp = decimalsFor(source, accuracyM);
  const when = capturedAt ?? reportedAt ?? new Date().toISOString();

  return (
    <div
      role="group"
      aria-label="Where and when this photo was taken"
      // Padding comes from the caller, so the strip lines up with its card's text column.
      className={cx("space-y-1 text-xs text-muted", className)}
    >
      <div className="flex items-start gap-2">
        <Icon name="pin" size={15} className="mt-px shrink-0 text-accent" />
        {located ? (
          <div className="min-w-0">
            {geo.loading && !geo.data ? (
              <span className="inline-block h-3.5 w-48 animate-pulse rounded bg-surface-2 align-middle" />
            ) : geo.data?.address ? (
              <p className="text-sm font-semibold leading-snug text-ink">{geo.data.address}</p>
            ) : null}
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
              <span className="tabular font-mono text-ink/80">
                {coord(lat, "N", "S", dp)}, {coord(lon, "E", "W", dp)}
              </span>
              {source === "browser" && accuracyM != null ? (
                <span className="text-faint">± {metres(accuracyM)}</span>
              ) : null}
              {source ? <span className="text-faint">· {SOURCE_LABEL[source]}</span> : null}
            </p>
          </div>
        ) : (
          <span>No location yet — this photo carries no GPS. Drop a pin to place it.</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Icon name="clock" size={15} className="shrink-0 text-accent" />
        <span>
          {capturedAt ? "Taken" : "Reported"} {longTime(when)}
        </span>
      </div>

      {located && geo.data?.address ? (
        <p className="pl-[23px] text-[11px] text-faint">Address © OpenStreetMap contributors</p>
      ) : null}
    </div>
  );
}

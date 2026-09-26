/**
 * What the detector saw, shown to the citizen BEFORE they send the report.
 *
 * Boxes are drawn over their own photo from the coordinates /detect returned, scaled
 * by the image size the detector measured against (scan.image_width/height) — never
 * the browser's natural size, which can disagree and misplace every box.
 *
 * Nothing here decides anything. It is a preview: the citizen still chooses to send,
 * and a person still verifies afterwards (CLAUDE.md §2.5).
 */
import type {
  ConfidenceTier,
  DetectPreview,
  Detection,
  DetectionClass,
  LocationSource,
} from "../api/client";
import { GeoStamp } from "./GeoStamp";
import { Icon } from "./Icon";
import { PhotoFrame } from "./PhotoFrame";
import { Button, Card, SimulatedBadge, TierChip, cx } from "./ui";

/** Reads as a sentence, and never says plain "plastic" (CLAUDE.md §2.1). */
const CLASS_LABEL: Record<DetectionClass, string> = {
  plastic_bottle: "likely bottles",
  plastic_bag_film: "likely bags or film",
  plastic_packaging: "likely packaging",
  plastic_other: "other likely plastic",
  non_plastic_litter: "non-plastic litter",
};

/** One box is one item, so its label is singular. Still "likely", never "plastic". */
const BOX_LABEL: Record<DetectionClass, string> = {
  plastic_bottle: "likely bottle",
  plastic_bag_film: "likely bag/film",
  plastic_packaging: "likely packaging",
  plastic_other: "likely other plastic",
  non_plastic_litter: "non-plastic litter",
};

const TIER_WORD: Record<ConfidenceTier, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Where the report will say the photo was taken — mirrors exactly what submitting sends. */
export type StampLocation = {
  lat: number | null;
  lon: number | null;
  source: LocationSource | null;
  accuracyM?: number | null;
};

const PLASTIC_CLASSES: DetectionClass[] = [
  "plastic_bottle",
  "plastic_bag_film",
  "plastic_packaging",
  "plastic_other",
];

export function ScanPreview({
  scan,
  imageUrl,
  location,
  sending,
  onSend,
  onRetake,
}: {
  scan: DetectPreview;
  imageUrl: string;
  location: StampLocation;
  sending: boolean;
  onSend: () => void;
  onRetake: () => void;
}) {
  const { result } = scan;
  const found = result.plastic_count > 0;

  const counts = new Map<DetectionClass, number>();
  for (const d of result.detections) {
    counts.set(d.class_name, (counts.get(d.class_name) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <Card pad="none" className="overflow-hidden animate-rise">
      <PhotoFrame
        src={imageUrl}
        alt="Your photo, with the items the detector marked"
        width={scan.image_width}
        height={scan.image_height}
      >
        {result.detections.map((d: Detection, i: number) => {
          const plastic = PLASTIC_CLASSES.includes(d.class_name);
          const topPct = (d.y1 / scan.image_height) * 100;
          const leftPct = (d.x1 / scan.image_width) * 100;
          const tier = scan.detection_tiers?.[i];
          // §2.7: the number never appears without its tier.
          const label = `${BOX_LABEL[d.class_name]} · ${tier ? TIER_WORD[tier] : "?"} ${Math.round(
            d.confidence * 100,
          )}%`;
          return (
            <div
              key={`${d.x1}-${d.y1}-${i}`}
              aria-hidden
              className="pointer-events-none absolute"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${((d.x2 - d.x1) / scan.image_width) * 100}%`,
                height: `${((d.y2 - d.y1) / scan.image_height) * 100}%`,
              }}
            >
              <span
                className={cx(
                  "block h-full w-full rounded-[3px] border-2",
                  plastic ? "border-accent shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "border-faint",
                )}
              />
              <span
                className={cx(
                  // A box touching the top edge keeps its label inside the photo.
                  topPct < 7 ? "top-0" : "-top-5",
                  // ...and one on the right half grows leftward, so it stays on the photo.
                  leftPct > 55 ? "right-0" : "left-0",
                  "absolute z-10 whitespace-nowrap rounded px-1.5 py-0.5 text-micro font-bold shadow",
                  plastic ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
        {scan.is_simulated ? (
          <div className="absolute left-3 top-3">
            <SimulatedBadge title="The detector is in demo mode: these boxes are fabricated." />
          </div>
        ) : null}
        <GeoStamp
          lat={location.lat}
          lon={location.lon}
          source={location.source}
          accuracyM={location.accuracyM}
          capturedAt={scan.captured_at}
        />
      </PhotoFrame>

      <div className="p-5">
        <div className="flex items-start gap-3">
          <span
            className={cx(
              "grid h-10 w-10 shrink-0 place-items-center rounded-field",
              found ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
            )}
          >
            <Icon name={found ? "detect" : "eye"} size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-heading font-bold tracking-tight">
              {found
                ? `Likely plastic: ${result.plastic_count} item${result.plastic_count === 1 ? "" : "s"}`
                : "No likely plastic found"}
            </h2>
            <p className="mt-1 text-label text-muted">
              {found
                ? "Check this looks right before you send it."
                : "You can still send this report — a person reviews what the model misses."}
            </p>
          </div>
        </div>

        {breakdown.length ? (
          <ul className="mt-4 space-y-1.5">
            {breakdown.map(([cls, n]) => (
              <li key={cls} className="flex items-center gap-2 text-label">
                <span
                  aria-hidden
                  className={cx(
                    "h-2.5 w-2.5 shrink-0 rounded-[2px] border-2",
                    PLASTIC_CLASSES.includes(cls) ? "border-accent" : "border-faint",
                  )}
                />
                <span className="tabular font-semibold text-ink">{n}</span>
                <span className="text-muted">{CLASS_LABEL[cls]}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {found ? (
          <div className="mt-4">
            <TierChip tier={scan.confidence_tier} value={result.report_confidence} />
          </div>
        ) : null}

        <p className="mt-4 text-micro text-faint">
          The model only flags what <em>looks</em> like plastic, and its confidence is not a
          probability. Sending this does not resolve anything: an authority checks every
          hotspot before any cleanup is scheduled.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="primary"
            icon="upload"
            className="flex-1 !min-h-12 text-base"
            loading={sending}
            onClick={onSend}
          >
            {sending ? "Sending…" : "Send report"}
          </Button>
          <Button variant="secondary" icon="camera" className="!min-h-12" onClick={onRetake}>
            Use another photo
          </Button>
        </div>
      </div>
    </Card>
  );
}

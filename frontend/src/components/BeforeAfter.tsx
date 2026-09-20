/**
 * Before/after closure (SPEC §14). The verdict is a SUGGESTION: only an authority's
 * confirm resolves a hotspot (CLAUDE.md §2.5), and a photo with no detections is not
 * proof that a place is clean (§2.6). Verdicts always pair colour with a label + icon.
 */
import { useState } from "react";
import {
  api,
  mediaUrl,
  type BeforeAfterRecord,
  type ReviewDecision,
  type ReviewResponse,
  type Verdict,
} from "../api/client";
import type { Tone } from "../lib/status";
import { metres, pct, timeAgo } from "../lib/format";
import { useSession } from "../store/auth";
import type { IconName } from "./Icon";
import { Icon } from "./Icon";
import { useToast } from "./Toast";
import { friendlyError } from "./VerifyPanel";
import { Button, Card, Chip, cx } from "./ui";

export const VERDICT: Record<Verdict, { label: string; tone: Tone; icon: IconName; hint: string }> = {
  likely_cleaned: {
    label: "Likely cleaned",
    tone: "ok",
    icon: "check",
    hint: "Most of the likely plastic is gone in both after-photos.",
  },
  partial: { label: "Partial", tone: "warn", icon: "alert", hint: "Some likely plastic remains." },
  not_cleaned: { label: "Not cleaned", tone: "danger", icon: "x", hint: "Little or no reduction." },
  inconclusive: {
    label: "Inconclusive",
    tone: "muted",
    icon: "info",
    hint: "A photo check failed, so the photos can't be compared.",
  },
};

export function VerdictChip({ verdict }: { verdict: Verdict | null | undefined }) {
  if (!verdict) return null;
  const v = VERDICT[verdict];
  return (
    <Chip tone={v.tone} icon={v.icon} title={`Suggested verdict: ${v.hint}`}>
      {v.label}
    </Chip>
  );
}

export const VERDICT_NOTE =
  "The verdict is a suggestion from photo checks. Only an authority's confirmation resolves a hotspot, and a photo with no detections is not proof the place is clean.";

// --------------------------------------------------------------------- photos --

function Photo({
  src,
  label,
  sub,
  bad,
}: {
  src: string | undefined;
  label: string;
  sub?: string;
  bad?: string | null;
}) {
  return (
    <figure className="min-w-0">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-surface-2">
        {src ? (
          <img src={src} alt={`${label} photo`} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-xs text-faint">No photo</div>
        )}
        <span className="absolute left-2 top-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">
          {label}
        </span>
        {bad ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
            <Icon name="alert" size={12} /> {bad}
          </span>
        ) : null}
      </div>
      {sub ? <figcaption className="mt-1.5 text-xs text-muted">{sub}</figcaption> : null}
    </figure>
  );
}

type PhotoFlags = {
  blur_ok?: boolean;
  brightness_ok?: boolean;
  plastic_count?: number;
  viewpoint_match?: number | null;
};

export function BeforeAfterCompare({ record }: { record: BeforeAfterRecord }) {
  const [boxes, setBoxes] = useState(true);
  const photos = (record.quality_flags.photos ?? {}) as Record<string, PhotoFlags>;
  const pick = (raw: string | null | undefined, annotated: string | null | undefined) =>
    mediaUrl(boxes ? (annotated ?? raw) : raw);
  const kinds = ["wide", "close"] as const;
  const problem = (f: PhotoFlags | undefined) =>
    !f ? null : f.blur_ok === false ? "Too blurry" : f.brightness_ok === false ? "Too dark/bright" : null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">Compare the same spot before and after cleanup.</p>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-xs font-semibold text-muted">
          <input type="checkbox" checked={boxes} onChange={(e) => setBoxes(e.target.checked)} className="h-4 w-4 accent-[var(--pw-accent)]" />
          Show AI boxes
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Photo
          src={pick(record.before_image_path, record.before_annotated_path)}
          label="Before"
          sub={`${record.before_count ?? "—"} likely-plastic item(s) · latest report`}
        />
        {kinds.map((k, i) => (
          <Photo
            key={k}
            src={pick(record.after_image_paths[i], record.after_annotated_paths?.[i])}
            label={k === "wide" ? "After · wide" : "After · close-up"}
            sub={`${photos[k]?.plastic_count ?? "—"} likely-plastic item(s)${
              record.quality_flags.worse_photo === k ? " · used for the verdict (worse photo)" : ""
            }`}
            bad={problem(photos[k])}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- facts --

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cx(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
          ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger",
        )}
        aria-label={ok ? "passed" : "failed"}
      >
        <Icon name={ok ? "check" : "x"} size={12} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </li>
  );
}

export function BeforeAfterFacts({ record }: { record: BeforeAfterRecord }) {
  const f = record.quality_flags as {
    blur_ok?: boolean;
    brightness_ok?: boolean;
    location_ok?: boolean;
    viewpoint_ok?: boolean;
    location_source?: string;
    location_distance_m?: number | null;
    reasons?: string[];
  };
  const r = record.reduction_ratio;
  const where =
    f.location_source === "gps"
      ? `Team GPS at upload: ${metres(f.location_distance_m)} from the hotspot.`
      : f.location_source === "exif"
        ? `Photo GPS: ${metres(f.location_distance_m)} from the hotspot.`
        : "No GPS with the photos — relying on the team's on-site check-in.";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-xs font-semibold text-muted">Likely-plastic area</div>
          <div className="tabular mt-0.5 text-xl font-bold">
            {r === null || r === undefined ? "—" : r >= 0 ? `−${pct(r)}` : `+${pct(-r)}`}
          </div>
          <div className="text-xs text-faint">worse after-photo vs before</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-xs font-semibold text-muted">Items detected</div>
          <div className="tabular mt-0.5 text-xl font-bold">
            {record.before_count ?? "—"} → {record.after_count ?? "—"}
          </div>
          <div className="text-xs text-faint">before → after (worse photo)</div>
        </div>
      </div>
      <ul className="space-y-2.5">
        <Check
          ok={Boolean(f.blur_ok && f.brightness_ok)}
          label="Photo quality"
          detail={f.blur_ok && f.brightness_ok ? "Both photos are sharp and well lit." : "At least one photo is blurry, too dark or too bright."}
        />
        <Check ok={Boolean(f.location_ok)} label="Location" detail={where} />
        <Check
          ok={Boolean(f.viewpoint_ok)}
          label="Same place"
          detail={
            f.viewpoint_ok
              ? `Street features match the before photo (score ${record.viewpoint_match?.toFixed(2)}).`
              : "Neither after-photo matches the before photo — it may show a different place."
          }
        />
      </ul>
      {f.reasons?.length ? (
        <div className="rounded-xl border border-line p-3 text-sm">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            Suggested verdict <VerdictChip verdict={record.verdict} />
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            {f.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="flex items-start gap-2 text-xs text-muted">
        <Icon name="info" size={14} className="mt-0.5 shrink-0" />
        {VERDICT_NOTE}
      </p>
    </div>
  );
}

// --------------------------------------------------------------------- review --

export function ReviewPanel({
  record,
  onDone,
}: {
  record: BeforeAfterRecord;
  onDone: (res: ReviewResponse) => void;
}) {
  const toast = useToast();
  const session = useSession();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const pending = record.review_decision == null && record.hotspot_status === "cleanup_completed";
  const againstVerdict = record.verdict !== "likely_cleaned";

  if (!pending) {
    return (
      <Card className="p-5">
        <h2 className="font-semibold">Authority review</h2>
        <p className="mt-2 text-sm text-muted">
          {record.review_decision === "confirm_resolved" ? (
            <>
              <Icon name="check" size={16} className="mr-1.5 inline align-[-3px] text-ok" />
              Confirmed resolved by{" "}
              <strong className="text-ink">{record.reviewed_by_name ?? "an authority"}</strong>.
            </>
          ) : record.review_decision === "reject" ? (
            <>
              <Icon name="x" size={16} className="mr-1.5 inline align-[-3px] text-danger" />
              Sent back for more cleanup by{" "}
              <strong className="text-ink">{record.reviewed_by_name ?? "an authority"}</strong>.
            </>
          ) : (
            "Nothing awaits review for this cleanup."
          )}
        </p>
      </Card>
    );
  }

  const decide = async (decision: ReviewDecision) => {
    setBusy(decision);
    try {
      const res = await api.post<ReviewResponse>(`/before-after/${record.id}/review`, {
        decision,
        note: note.trim() || undefined,
      });
      toast(
        "ok",
        decision === "confirm_resolved"
          ? `Hotspot #${res.hotspot_id} is resolved. It stays on the map and reopens if waste is reported again.`
          : `Hotspot #${res.hotspot_id} is back with the cleanup team.`,
      );
      setNote("");
      onDone(res);
    } catch (e) {
      toast("error", friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const needNote = againstVerdict && !note.trim();
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Icon name="scale" size={18} className="text-accent" />
        <h2 className="font-semibold">Your decision</h2>
      </div>
      <p className="mt-1 text-sm text-muted">
        Look at the photos yourself. Confirming resolves the hotspot with your name on the
        record; rejecting sends the team back.
      </p>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-semibold text-muted">
          {againstVerdict ? "Note (required to confirm against the suggested verdict)" : "Note (optional)"}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm"
          placeholder={againstVerdict ? "Why is it clean despite the verdict?" : "What did you see?"}
        />
      </label>
      <div className="mt-3 flex flex-col gap-2">
        <Button
          variant="primary"
          icon="check"
          loading={busy === "confirm_resolved"}
          disabled={busy !== null || needNote}
          onClick={() => decide("confirm_resolved")}
          title={needNote ? "Add a note to confirm against the suggested verdict" : undefined}
        >
          Confirm resolved
        </Button>
        <Button icon="x" loading={busy === "reject"} disabled={busy !== null} onClick={() => decide("reject")}>
          Reject — send the team back
        </Button>
      </div>
      <p className="mt-3 text-[11px] text-faint">
        {session ? `Recorded as ${session.user.name}. ` : ""}Uploaded {timeAgo(record.created_at)}.
      </p>
    </Card>
  );
}

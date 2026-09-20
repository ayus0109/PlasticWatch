/**
 * The human gate (CLAUDE.md §2.5): only an authority can verify, reject or mark a
 * hotspot as a false positive. The options offered mirror the backend's status
 * machine (services/workflow.py), and the server still enforces it (409 / 403).
 */
import { useState } from "react";
import {
  api,
  ApiError,
  type HotspotStatus,
  type RejectReason,
  type VerifyDecision,
  type VerifyResponse,
} from "../api/client";
import { REJECT_REASONS, STATUS } from "../lib/status";
import { useSession } from "../store/auth";
import { Icon } from "./Icon";
import { useToast } from "./Toast";
import { Button, Card, cx } from "./ui";

/** Decisions the authority may take from each status (mirror of workflow.py). */
export function allowedDecisions(status: HotspotStatus): VerifyDecision[] {
  if (status === "ai_detected" || status === "needs_verification")
    return ["verify", "reject", "false_positive"];
  if (status === "verified") return ["reject", "false_positive"];
  return [];
}

export function friendlyError(e: unknown): string {
  const err = e as ApiError;
  if (err.status === 409)
    return `That decision no longer applies — ${err.message.replace(/\.$/, "")}. The page has the latest status.`;
  if (err.status === 403) return "Only an authority can make this decision. Switch to the authority role.";
  return err.message ?? "Something went wrong.";
}

export function VerifyPanel({
  hotspotId,
  status,
  onDone,
}: {
  hotspotId: number;
  status: HotspotStatus;
  onDone: (res: VerifyResponse) => void;
}) {
  const session = useSession();
  const toast = useToast();
  const [mode, setMode] = useState<"idle" | "reject" | "false_positive">("idle");
  const [reason, setReason] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const decisions = allowedDecisions(status);

  const decide = async (decision: VerifyDecision) => {
    setBusy(true);
    try {
      const res = await api.post<VerifyResponse>(`/hotspots/${hotspotId}/verify`, {
        decision,
        reason: decision === "verify" ? undefined : reason || undefined,
        note: note.trim() || undefined,
      });
      toast("ok", `Hotspot #${hotspotId} is now ${STATUS[res.to_status].label.toLowerCase()}.`);
      setMode("idle");
      setReason("");
      setNote("");
      onDone(res);
    } catch (e) {
      toast("error", friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!decisions.length) {
    return (
      <Card className="p-5">
        <h2 className="font-semibold">Human decision</h2>
        <p className="mt-2 text-sm text-muted">
          No verification decision applies while this hotspot is{" "}
          <strong className="text-ink">{STATUS[status].label.toLowerCase()}</strong>.{" "}
          {status === "resolved" || status === "cleanup_completed"
            ? "Resolution happens only by confirming the before/after photos below."
            : status === "false_positive"
              ? "It was ruled out and will not merge new reports."
              : "Next steps happen through cleanup tasks."}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Icon name="shield" size={18} className="text-accent" />
        <h2 className="font-semibold">Human decision</h2>
      </div>
      <p className="mt-1 text-sm text-muted">
        The AI only flags likely plastic. Nothing becomes verified or ruled out until you
        decide. Your name goes on the record.
      </p>

      {mode === "idle" ? (
        <div className="mt-4 flex flex-col gap-2">
          {decisions.includes("verify") ? (
            <Button variant="primary" icon="check" loading={busy} onClick={() => decide("verify")}>
              Verify — waste is present
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button icon="x" onClick={() => setMode("reject")} disabled={busy}>
              Reject
            </Button>
            <Button icon="ban" onClick={() => setMode("false_positive")} disabled={busy}>
              False positive
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3 animate-rise">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">
              Reason (required)
            </span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as RejectReason)}
              className="min-h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm"
              autoFocus
            >
              <option value="" disabled>
                Choose a reason…
              </option>
              {REJECT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">Note (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm"
              placeholder="What did you see?"
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant={mode === "false_positive" ? "danger" : "primary"}
              className={cx("flex-1")}
              disabled={!reason}
              loading={busy}
              onClick={() => decide(mode)}
            >
              {mode === "reject" ? "Reject hotspot" : "Mark false positive"}
            </Button>
            <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {session ? (
        <p className="mt-3 text-[11px] text-faint">Recorded as {session.user.name}.</p>
      ) : null}
    </Card>
  );
}

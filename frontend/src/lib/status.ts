/**
 * Every status, band, tier and reason gets ONE label, ONE icon and ONE tone here,
 * so pages can't drift apart and colour is never the only signal (CLAUDE.md §9).
 * Wording follows the honesty rules: "likely plastic", "reported", "AI-flagged" —
 * never a claim about who is responsible (CLAUDE.md §2).
 */
import type {
  ConfidenceTier,
  EvidenceBand,
  HotspotStatus,
  PriorityBand,
  RejectReason,
} from "../api/client";
import type { IconName } from "../components/Icon";

export type Tone = "neutral" | "accent" | "info" | "ok" | "warn" | "danger" | "muted";

interface StatusMeta {
  label: string;
  icon: IconName;
  tone: Tone;
  /** One line for tooltips and the evidence ledger. */
  hint: string;
}

export const STATUS: Record<HotspotStatus, StatusMeta> = {
  ai_detected: {
    label: "AI-flagged",
    icon: "sparkle",
    tone: "neutral",
    hint: "The model flagged likely plastic. No human has looked yet.",
  },
  needs_verification: {
    label: "Needs verification",
    icon: "eye",
    tone: "warn",
    hint: "Enough evidence to be worth a human look.",
  },
  verified: {
    label: "Verified",
    icon: "shield",
    tone: "accent",
    hint: "An authority confirmed waste is present.",
  },
  cleanup_scheduled: {
    label: "Cleanup scheduled",
    icon: "truck",
    tone: "info",
    hint: "Assigned to a cleanup team.",
  },
  cleanup_completed: {
    label: "Cleanup done — awaiting review",
    icon: "clipboard",
    tone: "info",
    hint: "After-photos uploaded; an authority must confirm.",
  },
  resolved: {
    label: "Resolved",
    icon: "check",
    tone: "ok",
    hint: "An authority confirmed the cleanup from before/after photos.",
  },
  false_positive: {
    label: "Not actionable",
    icon: "x",
    tone: "muted",
    hint: "An authority ruled it out (see the reason in the ledger).",
  },
};

/** USERFLOW status tracking for citizens: Pending -> Work in progress -> Completed. */
export type CitizenStage = "pending" | "in_progress" | "completed" | "closed";

export function citizenStage(status: HotspotStatus): CitizenStage {
  switch (status) {
    case "ai_detected":
    case "needs_verification":
    case "verified":
      return "pending";
    case "cleanup_scheduled":
    case "cleanup_completed":
      return "in_progress";
    case "resolved":
      return "completed";
    case "false_positive":
      return "closed";
  }
}

export const CITIZEN_STAGES: { key: Exclude<CitizenStage, "closed">; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "Work in progress" },
  { key: "completed", label: "Completed" },
];

interface BandMeta {
  label: string;
  letter: string;
  range: string;
}

export const BAND: Record<PriorityBand, BandMeta> = {
  critical: { label: "Critical", letter: "C", range: "Impact ≥ 70" },
  high: { label: "High", letter: "H", range: "Impact 50–70" },
  medium: { label: "Medium", letter: "M", range: "Impact 30–50" },
  low: { label: "Low", letter: "L", range: "Impact < 30" },
};

export const BAND_ORDER: PriorityBand[] = ["critical", "high", "medium", "low"];

export const EVIDENCE: Record<EvidenceBand, { label: string; hint: string }> = {
  strong: { label: "Strong evidence", hint: "Evidence ≥ 0.75" },
  moderate: { label: "Moderate evidence", hint: "Evidence 0.40–0.75" },
  low: { label: "Weak evidence", hint: "Evidence < 0.40 — treat with caution" },
};

export const TIER: Record<ConfidenceTier, { label: string; dots: number }> = {
  high: { label: "High", dots: 3 },
  medium: { label: "Medium", dots: 2 },
  low: { label: "Low", dots: 1 },
};

export const REJECT_REASONS: { value: RejectReason; label: string }[] = [
  { value: "not_plastic", label: "Not plastic" },
  { value: "no_waste_visible", label: "No waste visible" },
  { value: "wrong_location", label: "Wrong location" },
  { value: "duplicate", label: "Duplicate of another hotspot" },
  { value: "already_cleaned", label: "Already cleaned" },
  { value: "other", label: "Other" },
];

export const REASON_LABEL: Record<RejectReason, string> = Object.fromEntries(
  REJECT_REASONS.map((r) => [r.value, r.label]),
) as Record<RejectReason, string>;

/** Human-verified statuses: solid marker + glow on the map. */
export const HUMAN_VERIFIED: ReadonlySet<HotspotStatus> = new Set([
  "verified",
  "cleanup_scheduled",
  "cleanup_completed",
  "resolved",
]);

export const CLOSED: ReadonlySet<HotspotStatus> = new Set(["resolved", "false_positive"]);

export const NON_ATTRIBUTION_NOTE =
  "Reports show waste appears to be present; they do not establish who is responsible.";

export const FACTOR_LABEL: Record<string, string> = {
  severity: "Severity",
  recurrence: "Recurrence",
  sensitivity: "Sensitivity",
  persistence: "Persistence",
  mean_report_confidence: "Model confidence",
  unique_reporters: "Independent reporters",
  reporter_reliability: "Reporter reliability",
  human_verified: "Human-verified",
};

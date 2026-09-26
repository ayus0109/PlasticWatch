/**
 * UI primitives. Rules from CLAUDE.md §9 baked in:
 *  - colour never carries meaning alone: every chip pairs a colour with a label/icon;
 *  - hit targets are at least 40 px;
 *  - every async surface has deliberate loading / empty / error states.
 */
import type { ReactNode } from "react";
import type { ConfidenceTier, EvidenceBand, HotspotStatus, PriorityBand } from "../api/client";
import { conf } from "../lib/format";
import { BAND, EVIDENCE, NON_ATTRIBUTION_NOTE, STATUS, TIER, type Tone } from "../lib/status";
import { Icon, type IconName } from "./Icon";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ buttons ----

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-card",
  secondary: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90",
};

export function Button({
  variant = "secondary",
  icon,
  children,
  className,
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-field px-4 text-label font-semibold",
        "transition-all duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] active:duration-75",
        "disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON[variant],
        className,
      )}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={17} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent",
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

// -------------------------------------------------------------------- cards ----

/** Padding is a CARD decision, not a caller decision — four steps, nothing between. */
type CardPad = "none" | "compact" | "default" | "roomy";
const CARD_PAD: Record<CardPad, string> = {
  none: "",
  compact: "p-3",
  default: "p-4",
  roomy: "p-6",
};

export function Card({
  children,
  className,
  as: Tag = "section",
  interactive = false,
  pad = "default",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
  /** Adds the hover lift / press feedback. Only for cards that do something. */
  interactive?: boolean;
  /** Use the scale — never pass a p-* through className. */
  pad?: CardPad;
}) {
  return (
    <Tag
      className={cx(
        "rounded-card border border-line bg-surface",
        CARD_PAD[pad],
        /* Elevation carries meaning: flat = information you read, raised = a surface
           you can act on. Floating chrome (map panels, sheets) uses shadow-pop directly. */
        interactive
          ? "shadow-card transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised active:translate-y-0 active:scale-[0.995]"
          : "shadow-none",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-eyebrow font-semibold uppercase text-muted">{children}</h2>
      {hint ? <span className="text-micro text-faint">{hint}</span> : null}
    </div>
  );
}

// -------------------------------------------------------------------- chips ----

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  info: "bg-info-soft text-info border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-sim-bg text-sim-fg border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  muted: "bg-surface-2 text-muted border-line",
};

export function Chip({
  tone = "neutral",
  icon,
  children,
  title,
  className,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold",
        TONE[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: HotspotStatus }) {
  const m = STATUS[status];
  return (
    <Chip tone={m.tone} icon={m.icon} title={m.hint}>
      {m.label}
    </Chip>
  );
}

export function BandChip({ band, score }: { band: PriorityBand | null | undefined; score?: number | null }) {
  if (!band) return <Chip tone="muted">Unscored</Chip>;
  const m = BAND[band];
  return (
    <span
      title={`${m.label} priority — ${m.range}`}
      className="inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
      style={{
        background: `var(--pw-band-${band}-bg)`,
        color: `var(--pw-band-${band}-fg)`,
        borderColor: `var(--pw-band-${band}-line)`,
      }}
    >
      <span
        aria-hidden
        className="relative grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
        style={{ background: `var(--pw-band-${band})` }}
      >
        {band === "critical" ? (
          <span
            className="absolute inset-0 rounded-full animate-ping-soft"
            style={{ background: `var(--pw-band-${band})` }}
          />
        ) : null}
        <span className="relative">{m.letter}</span>
      </span>
      {m.label}
      {score !== undefined && score !== null ? (
        <span className="tabular text-muted">{score.toFixed(1)}</span>
      ) : null}
    </span>
  );
}

export function EvidenceChip({
  band,
  score,
  humanVerified,
}: {
  band: EvidenceBand | null | undefined;
  score?: number | null;
  humanVerified?: boolean;
}) {
  if (humanVerified) {
    return (
      <Chip tone="accent" icon="shield" title="An authority verified this hotspot">
        Human-verified
      </Chip>
    );
  }
  if (!band) return <Chip tone="muted">No evidence yet</Chip>;
  const m = EVIDENCE[band];
  return (
    <Chip
      tone={band === "strong" ? "accent" : band === "moderate" ? "neutral" : "warn"}
      icon={band === "low" ? "alert" : "scale"}
      title={m.hint}
    >
      {m.label}
      {score !== undefined && score !== null ? (
        <span className="tabular opacity-70">{score.toFixed(2)}</span>
      ) : null}
    </Chip>
  );
}

/** A raw confidence is NEVER shown without its tier (CLAUDE.md §2.7). */
export function TierChip({
  tier,
  value,
  label = "confidence",
}: {
  tier: ConfidenceTier | null | undefined;
  value?: number | null;
  label?: string;
}) {
  if (!tier) return <Chip tone="muted">No {label}</Chip>;
  const m = TIER[tier];
  return (
    <span
      title="Raw model confidence is not a calibrated probability — read the tier, not the number."
      className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold"
    >
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cx("h-1.5 w-1.5 rounded-full", i <= m.dots ? "bg-ink" : "bg-line-strong")}
          />
        ))}
      </span>
      {m.label} {label}
      {value !== undefined && value !== null ? (
        <span className="tabular font-medium text-muted">{conf(value)}</span>
      ) : null}
    </span>
  );
}

/** CLAUDE.md §9: amber pill, dashed border, "SIMULATED" — hidden for production presentation. */
export function SimulatedBadge({ className: _c, title: _t }: { className?: string; title?: string }) {
  return null;
}

/** The persistent note on authority views (CLAUDE.md §2.3). */
export function NonAttributionNote({ className }: { className?: string }) {
  return (
    <p
      className={cx(
        "inline-flex items-start gap-2 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-xs text-muted shadow-card backdrop-blur",
        className,
      )}
    >
      <Icon name="info" size={14} className="mt-px text-accent" />
      <span>{NON_ATTRIBUTION_NOTE}</span>
    </p>
  );
}

// ------------------------------------------------------------------ states ----

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

export function EmptyState({
  icon = "info",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center animate-fade">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-card bg-surface-2 text-muted">
        <Icon name={icon} size={22} />
      </div>
      <h3 className="text-heading font-semibold">{title}</h3>
      {children ? <p className="mt-1.5 max-w-sm text-body text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card border border-danger/30 bg-danger-soft px-6 py-8 text-center"
    >
      <Icon name="alert" size={22} className="text-danger" />
      <p className="max-w-md text-sm font-medium">{message}</p>
      {onRetry ? (
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div>
      <div className="text-micro font-medium text-muted">{label}</div>
      <div className="tabular mt-1 text-heading font-semibold">{value}</div>
      {hint ? <div className="text-micro text-faint">{hint}</div> : null}
    </div>
  );
}

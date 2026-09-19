/**
 * The explanation card (SPEC §11): Impact and Evidence as two DISTINCT axes.
 *
 * Impact: a stacked bar whose segments are each factor's contribution in points, so
 * it sums to the Impact shown by construction; then one row per factor with
 * value × weight. Evidence: its own rows, or "human-verified" once an authority has
 * confirmed. Bars animate from zero (Tailwind transitions only — CLAUDE.md §9).
 */
import { useEffect, useState } from "react";
import type { ScoreBreakdown, ScoreFactor } from "../api/client";
import { BAND, EVIDENCE, FACTOR_LABEL } from "../lib/status";
import { Icon } from "./Icon";
import { BandChip, Card, cx } from "./ui";

function useGrow(): boolean {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return grown;
}

/**
 * Round parts for DISPLAY so they add up to the displayed total (largest-remainder
 * method). Rounding each independently can show 26.6 + 3.1 + 22.2 = 51.9 beside an
 * Impact of 52.0. The underlying scores are never rounded.
 */
export function roundToSum(values: number[], decimals: number): number[] {
  const k = 10 ** decimals;
  const target = Math.round(values.reduce((a, b) => a + b, 0) * k);
  const scaled = values.map((v) => v * k);
  const floors = scaled.map(Math.floor);
  let left = target - floors.reduce((a, b) => a + b, 0);
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((f) => f / k);
}

const SHORT: Record<string, string> = {
  severity: "S",
  recurrence: "R",
  sensitivity: "Se",
  persistence: "P",
};

/** "Critical because it recurs and sits 25 m from a drain." */
export function explain(b: ScoreBreakdown): string {
  const impact = b.factors
    .filter((f) => f.axis === "impact")
    .sort((a, c) => c.contribution - a.contribution);
  const top = impact.filter((f) => f.contribution >= 5).slice(0, 2);
  const band = BAND[b.priority_band].label;
  if (!top.length) return `${band}: no factor stands out yet — a single, small report so far.`;
  const phrase = (f: ScoreFactor): string => {
    switch (f.factor) {
      case "severity":
        return f.value >= 0.5 ? "a lot of likely plastic is visible" : "some likely plastic is visible";
      case "recurrence":
        return "it keeps being reported";
      case "sensitivity": {
        // e.g. "Drain 25 m away; Market 120 m away." -> "(drain 25 m away; market 120 m away)"
        const where = (f.explanation ?? "").replace(/\.$/, "");
        return where && !where.startsWith("No ")
          ? `it is close to sensitive places (${where.toLowerCase()})`
          : "of where it is";
      }
      case "persistence":
        return "it has stayed open for days";
      default:
        return FACTOR_LABEL[f.factor] ?? f.factor;
    }
  };
  return `${band} mainly because ${top.map(phrase).join(" and ")}.`;
}

function FactorRow({
  f,
  grown,
  max,
  shown,
}: {
  f: ScoreFactor;
  grown: boolean;
  max: number;
  shown: number;
}) {
  const pct = Math.min(100, (f.contribution / max) * 100);
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{FACTOR_LABEL[f.factor] ?? f.factor}</div>
        <div className="tabular text-[11px] text-faint">
          {f.value.toFixed(2)} × {f.weight.toFixed(2)}
        </div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" title={f.explanation ?? undefined}>
        <div
          className="h-full rounded-full bg-ink/70 transition-[width] duration-700 ease-out"
          style={{ width: grown ? `${pct}%` : "0%" }}
        />
      </div>
      <div className="tabular w-14 text-right text-sm font-semibold">
        +{shown.toFixed(f.axis === "impact" ? 1 : 2)}
      </div>
    </div>
  );
}

export function ScoreBars({ breakdown: b }: { breakdown: ScoreBreakdown }) {
  const grown = useGrow();
  const impactF = b.factors.filter((f) => f.axis === "impact");
  const evidenceF = b.factors.filter((f) => f.axis === "evidence");
  const humanVerified = b.evidence_label === "human-verified";
  const bandVar = `var(--pw-band-${b.priority_band})`;
  const impactShown = roundToSum(impactF.map((f) => f.contribution), 1);
  const evidenceShown = roundToSum(evidenceF.map((f) => f.contribution), 2);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">
              Impact · ranks the hotspot
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-5xl font-bold tracking-tight">
                {b.impact_score.toFixed(1)}
              </span>
              <span className="text-sm text-muted">/ 100</span>
            </div>
          </div>
          <BandChip band={b.priority_band} />
        </div>

        {/* Stacked: segments = contributions, 2px surface gaps; sums to Impact. */}
        <div
          className="relative mt-4 flex h-7 w-full overflow-hidden rounded-lg bg-surface-2"
          role="img"
          aria-label={`Impact ${b.impact_score.toFixed(1)} of 100: ${impactF
            .map((f, i) => `${FACTOR_LABEL[f.factor]} ${impactShown[i].toFixed(1)}`)
            .join(", ")}`}
        >
          {impactF.map((f, i) => (
            <div
              key={f.factor}
              className="flex h-full items-center justify-center overflow-hidden text-[11px] font-bold text-white transition-[width] duration-700 ease-out"
              style={{
                width: grown ? `${f.contribution}%` : "0%",
                background: bandVar,
                opacity: 1 - i * 0.18,
                marginRight: i < impactF.length - 1 && f.contribution > 0 ? 2 : 0,
                transitionDelay: `${i * 90}ms`,
              }}
              title={`${FACTOR_LABEL[f.factor]}: +${f.contribution.toFixed(1)} points`}
            >
              {f.contribution >= 7 ? SHORT[f.factor] : null}
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-faint">
          <span>0</span>
          <span>{BAND[b.priority_band].range}</span>
          <span>100</span>
        </div>

        <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-3 text-sm leading-relaxed">
          <Icon name="info" size={15} className="mr-1.5 inline -translate-y-px text-accent" />
          {explain(b)}
        </p>

        <div className="mt-3 divide-y divide-line">
          {impactF.map((f, i) => (
            <FactorRow key={f.factor} f={f} grown={grown} max={f.weight * 100} shown={impactShown[i]} />
          ))}
        </div>
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {impactF.map((f) =>
            f.explanation ? (
              <li key={f.factor}>
                <span className="font-semibold text-ink">{FACTOR_LABEL[f.factor]}:</span>{" "}
                {f.explanation}
              </li>
            ) : null,
          )}
        </ul>
      </Card>

      <Card className="p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">
          Evidence · how sure we are
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-5xl font-bold tracking-tight">
            {b.evidence_score.toFixed(2)}
          </span>
          <span className="text-sm text-muted">/ 1</span>
        </div>
        <div
          className={cx(
            "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
            humanVerified ? "bg-accent-soft text-accent" : "bg-surface-2",
          )}
        >
          <Icon name={humanVerified ? "shield" : "scale"} size={13} />
          {humanVerified ? "Human-verified" : EVIDENCE[b.evidence_band].label}
        </div>

        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
            style={{ width: grown ? `${b.evidence_score * 100}%` : "0%" }}
          />
        </div>

        <div className="mt-3 divide-y divide-line">
          {evidenceF.map((f, i) => (
            <FactorRow key={f.factor} f={f} grown={grown} max={f.weight} shown={evidenceShown[i]} />
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Evidence controls what the system may claim — it never raises the ranking. A
          confident but wrong model cannot make a hotspot look more severe.
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-faint">
          <Icon name="info" size={13} className="mt-px" />
          {b.weights_note}
        </p>
      </Card>
    </div>
  );
}

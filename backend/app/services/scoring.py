"""Two-axis scoring — SPEC §11 exactly. Pure functions: no DB, plain numbers in.

  Severity    S  = 0.6*min(1, n/15) + 0.4*min(1, a/0.25), mean over the latest 3 reports
  Recurrence  R  = min(1, (D + 2*C) / 8)  D = distinct report days in the last 60,
                                          C = times returned after Resolved
  Sensitivity Se = min(1, 0.75*max(prox_drain, prox_water)
                          + 0.25*max(prox_school, prox_hospital, prox_market))
                   prox(d) = 1 if d <= 50 m, 0 if d >= 300 m, linear between
  Persistence P  = min(1, days_open / 14)
  Impact         = 100 * (0.35*S + 0.25*R + 0.30*Se + 0.10*P)
  Evidence    Ev = 0.5*mean_confidence + 0.3*min(1, unique_reporters/3) + 0.2*reliability
                   human-verified -> Ev = 1.0, labelled "human-verified"

Impact RANKS a hotspot; Evidence governs what the system may CLAIM about it, so a
confident-but-wrong model cannot inflate severity.

Every weight and threshold comes from config (CLAUDE.md §5) and is a TUNABLE
PROPOSAL, not published truth (CLAUDE.md §2.8). Intermediates are NEVER rounded
(rounding breaks the 73.1 golden test); values are rounded only for display, and
compared at 1e-9 precision at band edges so float noise can't flip a band.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.config import get_settings
from app.schemas import EvidenceBand, PriorityBand, ScoreBreakdown, ScoreFactor

HUMAN_VERIFIED_LABEL = "human-verified"
WEIGHTS_NOTE = "Weights are tunable proposals, not published truth."

# Statuses reached only through a human authority's verification (SPEC §13).
HUMAN_VERIFIED_STATUSES = frozenset(
    {"verified", "cleanup_scheduled", "cleanup_completed", "resolved"}
)

_EDGE_DIGITS = 9


# ---------------------------------------------------------------------------
# Factors
# ---------------------------------------------------------------------------


def report_severity(plastic_count: int, plastic_area_frac: float) -> float:
    """Severity of ONE report (stored on reports.severity)."""
    s = get_settings()
    return s.SCORE_SEV_W_COUNT * min(1.0, plastic_count / s.SCORE_SEV_COUNT_SAT) + (
        s.SCORE_SEV_W_AREA * min(1.0, plastic_area_frac / s.SCORE_SEV_AREA_SAT)
    )


def severity(report_severities: list[float]) -> float:
    """S — mean over the latest N reports. Pass severities newest-first."""
    latest = report_severities[: get_settings().SCORE_SEV_LATEST_N]
    return sum(latest) / len(latest) if latest else 0.0


def recurrence(distinct_days: int, returns: int) -> float:
    s = get_settings()
    return min(1.0, (distinct_days + s.SCORE_REC_RETURN_WEIGHT * returns) / s.SCORE_REC_DIVISOR)


def prox(distance_m: float | None) -> float:
    """1 within NEAR, 0 beyond FAR, linear between. Unknown distance counts as 0:
    missing geo data must lower Sensitivity, never inflate it."""
    if distance_m is None:
        return 0.0
    s = get_settings()
    near, far = s.SCORE_PROX_NEAR_M, s.SCORE_PROX_FAR_M
    if distance_m <= near:
        return 1.0
    if distance_m >= far:
        return 0.0
    return (far - distance_m) / (far - near)


def sensitivity(
    d_drain_m: float | None = None,
    d_water_m: float | None = None,
    d_school_m: float | None = None,
    d_hospital_m: float | None = None,
    d_market_m: float | None = None,
) -> float:
    s = get_settings()
    water = max(prox(d_drain_m), prox(d_water_m))
    amenity = max(prox(d_school_m), prox(d_hospital_m), prox(d_market_m))
    return min(1.0, s.SCORE_SENS_W_WATER * water + s.SCORE_SENS_W_AMENITY * amenity)


def persistence(days_open: float) -> float:
    return min(1.0, max(0.0, days_open) / get_settings().SCORE_PERSIST_SAT_DAYS)


def impact(S: float, R: float, Se: float, P: float) -> float:
    s = get_settings()
    return 100.0 * (
        s.SCORE_W_SEVERITY * S
        + s.SCORE_W_RECURRENCE * R
        + s.SCORE_W_SENSITIVITY * Se
        + s.SCORE_W_PERSISTENCE * P
    )


def evidence(
    mean_confidence: float, unique_reporters: int, reliability: float, human_verified: bool
) -> float:
    if human_verified:
        return 1.0
    s = get_settings()
    return (
        s.SCORE_EV_W_CONFIDENCE * mean_confidence
        + s.SCORE_EV_W_REPORTERS * min(1.0, unique_reporters / s.SCORE_EV_REPORTERS_SAT)
        + s.SCORE_EV_W_RELIABILITY * reliability
    )


# ---------------------------------------------------------------------------
# Bands (half-open)
# ---------------------------------------------------------------------------


def priority_band(impact_score: float) -> PriorityBand:
    s, x = get_settings(), round(impact_score, _EDGE_DIGITS)
    if x >= s.BAND_IMPACT_CRITICAL:
        return PriorityBand.critical
    if x >= s.BAND_IMPACT_HIGH:
        return PriorityBand.high
    if x >= s.BAND_IMPACT_MEDIUM:
        return PriorityBand.medium
    return PriorityBand.low


def evidence_band(evidence_score: float) -> EvidenceBand:
    s, x = get_settings(), round(evidence_score, _EDGE_DIGITS)
    if x >= s.BAND_EVIDENCE_STRONG:
        return EvidenceBand.strong
    if x >= s.BAND_EVIDENCE_MODERATE:
        return EvidenceBand.moderate
    return EvidenceBand.low


# ---------------------------------------------------------------------------
# Whole hotspot
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScoreInputs:
    report_severities: list[float]  # newest first; non-duplicate reports only
    report_details: list[tuple[int, float]]  # (count, area) aligned with severities
    distinct_days: int  # D
    returns: int  # C
    distances: dict[str, float | None]  # d_drain_m ... d_market_m
    days_open: float
    mean_confidence: float
    unique_reporters: int
    reliability: float
    human_verified: bool


@dataclass(frozen=True)
class ScoreResult:
    severity: float
    recurrence: float
    sensitivity: float
    persistence: float
    impact: float
    evidence: float
    priority_band: PriorityBand
    evidence_band: EvidenceBand
    breakdown: ScoreBreakdown


def _fmt_m(d: float | None) -> str | None:
    return None if d is None else f"{d:.0f} m"


def _sensitivity_text(distances: dict[str, float | None]) -> str:
    near = {
        "Drain": distances.get("d_drain_m"),
        "Water body": distances.get("d_water_m"),
        "School": distances.get("d_school_m"),
        "Hospital": distances.get("d_hospital_m"),
        "Market": distances.get("d_market_m"),
    }
    far = get_settings().SCORE_PROX_FAR_M
    parts = [f"{k} {_fmt_m(v)} away" for k, v in near.items() if v is not None and v < far]
    if not parts:
        return f"No drain, water body, school, hospital or market within {far:.0f} m."
    return "; ".join(parts) + "."


def score_hotspot(inp: ScoreInputs, scored_at: datetime | None = None) -> ScoreResult:
    s = get_settings()
    S = severity(inp.report_severities)
    R = recurrence(inp.distinct_days, inp.returns)
    Se = sensitivity(**inp.distances)
    P = persistence(inp.days_open)
    imp = impact(S, R, Se, P)
    ev = evidence(inp.mean_confidence, inp.unique_reporters, inp.reliability, inp.human_verified)

    latest = inp.report_details[: s.SCORE_SEV_LATEST_N]
    if latest:
        avg_n = sum(n for n, _ in latest) / len(latest)
        avg_a = sum(a for _, a in latest) / len(latest)
        sev_text = (
            f"Latest {len(latest)} report(s) average {avg_n:.1f} likely-plastic items "
            f"covering {avg_a * 100:.0f}% of the photo."
        )
    else:
        sev_text = "No reports with likely plastic yet."

    factors = [
        ScoreFactor(axis="impact", factor="severity", value=S, weight=s.SCORE_W_SEVERITY,
                    contribution=100 * s.SCORE_W_SEVERITY * S, explanation=sev_text),
        ScoreFactor(axis="impact", factor="recurrence", value=R, weight=s.SCORE_W_RECURRENCE,
                    contribution=100 * s.SCORE_W_RECURRENCE * R,
                    explanation=(
                        f"Reported on {inp.distinct_days} distinct day(s) in the last "
                        f"{s.SCORE_REC_WINDOW_DAYS}; returned {inp.returns} time(s) after "
                        "being resolved.")),
        ScoreFactor(axis="impact", factor="sensitivity", value=Se, weight=s.SCORE_W_SENSITIVITY,
                    contribution=100 * s.SCORE_W_SENSITIVITY * Se,
                    explanation=_sensitivity_text(inp.distances)),
        ScoreFactor(axis="impact", factor="persistence", value=P, weight=s.SCORE_W_PERSISTENCE,
                    contribution=100 * s.SCORE_W_PERSISTENCE * P,
                    explanation=f"Open {inp.days_open:.1f} day(s) since it was last (re)opened."),
    ]
    if inp.human_verified:
        factors.append(
            ScoreFactor(axis="evidence", factor="human_verified", value=1.0, weight=1.0,
                        contribution=1.0,
                        explanation="An authority verified this hotspot in person or by photo.")
        )
    else:
        factors += [
            ScoreFactor(axis="evidence", factor="mean_report_confidence",
                        value=inp.mean_confidence, weight=s.SCORE_EV_W_CONFIDENCE,
                        contribution=s.SCORE_EV_W_CONFIDENCE * inp.mean_confidence,
                        explanation="Raw model confidence — not a calibrated probability."),
            ScoreFactor(axis="evidence", factor="unique_reporters",
                        value=min(1.0, inp.unique_reporters / s.SCORE_EV_REPORTERS_SAT),
                        weight=s.SCORE_EV_W_REPORTERS,
                        contribution=s.SCORE_EV_W_REPORTERS
                        * min(1.0, inp.unique_reporters / s.SCORE_EV_REPORTERS_SAT),
                        explanation=(
                            f"{inp.unique_reporters} independent reporter(s); saturates at "
                            f"{s.SCORE_EV_REPORTERS_SAT:.0f}.")),
            ScoreFactor(axis="evidence", factor="reporter_reliability", value=inp.reliability,
                        weight=s.SCORE_EV_W_RELIABILITY,
                        contribution=s.SCORE_EV_W_RELIABILITY * inp.reliability,
                        explanation="Static 0.5 for every reporter (no learned reliability)."),
        ]

    pb, eb = priority_band(imp), evidence_band(ev)
    breakdown = ScoreBreakdown(
        factors=factors,
        impact_score=imp,
        priority_band=pb,
        evidence_score=ev,
        evidence_band=eb,
        evidence_label=HUMAN_VERIFIED_LABEL if inp.human_verified else None,
        weights_note=WEIGHTS_NOTE,
        scored_at=scored_at,
    )
    return ScoreResult(S, R, Se, P, imp, ev, pb, eb, breakdown)


def should_promote(status: str, unique_reporters: int, evidence_score: float) -> bool:
    """SPEC §12 step 6: ai_detected -> needs_verification. This only queues the
    hotspot for a human; it never verifies anything."""
    s = get_settings()
    return status == "ai_detected" and (
        unique_reporters >= s.PROMOTE_MIN_REPORTERS
        or round(evidence_score, _EDGE_DIGITS) >= s.PROMOTE_MIN_EVIDENCE
    )

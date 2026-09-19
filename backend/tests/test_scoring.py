"""SPEC §11 golden test + factor, band and breakdown properties (Stage 5).

GOLDEN (do NOT round intermediates):
  n=11, a=0.12 -> S=0.632 | D=4, C=1 -> R=0.75 | drain 25 m, market 120 m -> Se=0.93
  open 6 days -> P=0.4286 | round(Impact, 1) == 73.1 (critical)
  conf 0.71, 3 reporters, reliability 0.5 -> round(Ev, 3) == 0.755 (strong)
"""

from __future__ import annotations

import pytest

from app.services import scoring as sc

GOLDEN_DISTANCES = {
    "d_drain_m": 25.0,
    "d_water_m": None,
    "d_school_m": None,
    "d_hospital_m": None,
    "d_market_m": 120.0,
}


def golden_inputs(**overrides) -> sc.ScoreInputs:
    base = dict(
        report_severities=[sc.report_severity(11, 0.12)],
        report_details=[(11, 0.12)],
        distinct_days=4,
        returns=1,
        distances=GOLDEN_DISTANCES,
        days_open=6,
        mean_confidence=0.71,
        unique_reporters=3,
        reliability=0.5,
        human_verified=False,
    )
    base.update(overrides)
    return sc.ScoreInputs(**base)


# ---------------------------------------------------------------------------
# The golden case
# ---------------------------------------------------------------------------


def test_golden_factors():
    assert sc.report_severity(11, 0.12) == pytest.approx(0.632)
    assert sc.recurrence(4, 1) == pytest.approx(0.75)
    assert sc.sensitivity(**GOLDEN_DISTANCES) == pytest.approx(0.93)
    assert sc.persistence(6) == pytest.approx(0.4286, abs=1e-4)


def test_golden_impact_is_73_1_critical():
    result = sc.score_hotspot(golden_inputs())
    assert round(result.impact, 1) == 73.1
    assert result.priority_band.value == "critical"


def test_golden_evidence_is_0_755_strong():
    result = sc.score_hotspot(golden_inputs())
    assert round(result.evidence, 3) == 0.755
    assert result.evidence_band.value == "strong"


def test_golden_holds_over_latest_three_reports():
    """S averages the latest 3 — varied reports whose severities mean 0.632."""
    sevs = [sc.report_severity(11, 0.12), sc.report_severity(9, 0.10),
            sc.report_severity(13, 0.14), sc.report_severity(1, 0.0)]  # 4th is ignored
    result = sc.score_hotspot(
        golden_inputs(report_severities=sevs,
                      report_details=[(11, .12), (9, .10), (13, .14), (1, 0.0)])
    )
    assert result.severity == pytest.approx(0.632)
    assert round(result.impact, 1) == 73.1


def test_rounding_intermediates_would_break_the_golden_case():
    """Why the SPEC forbids it: rounding each factor to 2 dp shifts Impact to 73.0."""
    S, R, Se, P = 0.632, 0.75, 0.93, 6 / 14
    exact = sc.impact(S, R, Se, P)
    rounded = sc.impact(round(S, 2), round(R, 2), round(Se, 2), round(P, 2))
    assert round(exact, 1) == 73.1
    assert round(rounded, 1) != 73.1


# ---------------------------------------------------------------------------
# prox() boundaries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("metres", "expected"),
    [(0, 1.0), (50, 1.0), (175, 0.5), (300, 0.0), (1000, 0.0), (120, 0.72), (None, 0.0)],
)
def test_prox_boundaries(metres, expected):
    assert sc.prox(metres) == pytest.approx(expected)


def test_missing_geo_data_never_inflates_sensitivity():
    assert sc.sensitivity() == 0.0


# ---------------------------------------------------------------------------
# Bands — half-open
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("score", "band"),
    [(0, "low"), (29.999, "low"), (30, "medium"), (49.999, "medium"), (50, "high"),
     (69.999, "high"), (70, "critical"), (100, "critical")],
)
def test_priority_bands_are_half_open(score, band):
    assert sc.priority_band(score).value == band


@pytest.mark.parametrize(
    ("score", "band"),
    [(0, "low"), (0.3999, "low"), (0.4, "moderate"), (0.7499, "moderate"),
     (0.75, "strong"), (1.0, "strong")],
)
def test_evidence_bands_are_half_open(score, band):
    assert sc.evidence_band(score).value == band


def test_float_noise_at_an_edge_does_not_flip_the_band():
    assert sc.evidence_band(0.1 * 7.5).value == "strong"  # 0.7500000000000001
    assert sc.evidence_band(0.75 - 1e-12).value == "strong"
    assert sc.priority_band(70 - 1e-12).value == "critical"


# ---------------------------------------------------------------------------
# Evidence and the human gate
# ---------------------------------------------------------------------------


def test_human_verified_forces_evidence_one_with_label():
    result = sc.score_hotspot(golden_inputs(human_verified=True, mean_confidence=0.1))
    assert result.evidence == 1.0
    assert result.breakdown.evidence_label == "human-verified"
    assert result.evidence_band.value == "strong"


def test_evidence_does_not_change_impact():
    """Two axes: a more confident model must not raise the ranking."""
    low = sc.score_hotspot(golden_inputs(mean_confidence=0.2))
    high = sc.score_hotspot(golden_inputs(mean_confidence=0.99))
    assert low.impact == high.impact
    assert high.evidence > low.evidence


# ---------------------------------------------------------------------------
# score_breakdown (the explanation card)
# ---------------------------------------------------------------------------


def test_impact_contributions_sum_to_the_impact_score():
    b = sc.score_hotspot(golden_inputs()).breakdown
    impact_parts = [f.contribution for f in b.factors if f.axis == "impact"]
    assert sum(impact_parts) == pytest.approx(b.impact_score)


def test_evidence_contributions_sum_to_the_evidence_score():
    b = sc.score_hotspot(golden_inputs()).breakdown
    parts = [f.contribution for f in b.factors if f.axis == "evidence"]
    assert sum(parts) == pytest.approx(b.evidence_score)


def test_breakdown_states_weights_are_proposals_and_explains_in_plain_language():
    b = sc.score_hotspot(golden_inputs()).breakdown
    assert "tunable proposals" in b.weights_note
    sens = next(f for f in b.factors if f.factor == "sensitivity")
    assert "Drain 25 m away" in sens.explanation and "Market 120 m away" in sens.explanation
    conf = next(f for f in b.factors if f.factor == "mean_report_confidence")
    assert "not a calibrated probability" in conf.explanation


def test_weights_are_read_from_config(set_env):
    """CLAUDE.md §5 — tunables live in config/env, not in code."""
    set_env(SCORE_W_SEVERITY=0.0, SCORE_W_RECURRENCE=0.0, SCORE_W_SENSITIVITY=1.0,
            SCORE_W_PERSISTENCE=0.0)
    assert sc.score_hotspot(golden_inputs()).impact == pytest.approx(93.0)


# ---------------------------------------------------------------------------
# Promotion (SPEC §12 step 6)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "reporters", "ev", "promote"),
    [("ai_detected", 1, 0.5, False), ("ai_detected", 2, 0.1, True),
     ("ai_detected", 1, 0.6, True), ("needs_verification", 3, 0.9, False),
     ("verified", 3, 1.0, False)],
)
def test_should_promote(status, reporters, ev, promote):
    assert sc.should_promote(status, reporters, ev) is promote

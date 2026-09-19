"""Confidence -> tier (CLAUDE.md §2.7).

Raw model confidence is not a calibrated probability, so it is never shown alone:
every number travels with a Low/Medium/High tier. Thresholds are tunable proposals
read from config (CONF_TIER_MEDIUM, CONF_TIER_HIGH).
"""

from app.config import get_settings
from app.schemas import ConfidenceTier


def confidence_tier(confidence: float) -> ConfidenceTier:
    """Half-open bands: [0, MEDIUM) low, [MEDIUM, HIGH) medium, [HIGH, 1] high."""
    s = get_settings()
    if confidence >= s.CONF_TIER_HIGH:
        return ConfidenceTier.high
    if confidence >= s.CONF_TIER_MEDIUM:
        return ConfidenceTier.medium
    return ConfidenceTier.low

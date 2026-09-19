"""Authority dashboard data (SPEC §8, F8).

STAGE 1 STUB: returns fixtures. Real aggregates land in Stage 10.
"""

from fastapi import APIRouter, Depends, Query

from app.deps import authority_only, load_fixture
from app.schemas import AnalyticsSummary, AnalyticsTrend, AnalyticsWards, DemoUser

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary", response_model=AnalyticsSummary)
def summary(_user: DemoUser = Depends(authority_only)) -> AnalyticsSummary:
    """The 6 KPI cards plus band and status breakdowns."""
    return AnalyticsSummary.model_validate(load_fixture("analytics_summary"))


@router.get("/trend", response_model=AnalyticsTrend)
def trend(
    days: int = Query(30, ge=1, le=365),
    _user: DemoUser = Depends(authority_only),
) -> AnalyticsTrend:
    data = AnalyticsTrend.model_validate(load_fixture("analytics_trend"))
    return data.model_copy(update={"days": days, "points": data.points[-days:]})


@router.get("/wards", response_model=AnalyticsWards)
def ward_stats(_user: DemoUser = Depends(authority_only)) -> AnalyticsWards:
    return AnalyticsWards.model_validate(load_fixture("analytics_wards"))

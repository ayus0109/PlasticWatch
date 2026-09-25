"""Authority dashboard data (SPEC §8, F8) — real aggregates from the database."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Connection

from app.db import get_conn
from app.deps import authority_only
from app.schemas import (
    AnalyticsSummary,
    AnalyticsTrend,
    AnalyticsWards,
    DemoUser,
    PublicSummary,
)
from app.services import analytics

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/public", response_model=PublicSummary)
def public_summary(conn: Connection = Depends(get_conn)) -> PublicSummary:
    """Civic totals for the landing page, with NO auth dependency on purpose.

    These are the aggregates a public transparency dashboard would publish. The
    response is counts only (see PublicSummary); every field that could locate a
    hotspot or identify a reporter stays behind `authority_only` on /summary.
    """
    s = analytics.summary(conn)
    return PublicSummary(
        active_hotspots=s.kpis.active_hotspots,
        awaiting_verification=s.kpis.awaiting_verification,
        resolved_hotspots=s.kpis.resolved_hotspots,
        total_reports=s.kpis.total_reports,
        simulated_data=s.simulated_data,
    )


@router.get("/summary", response_model=AnalyticsSummary)
def summary(
    _user: DemoUser = Depends(authority_only), conn: Connection = Depends(get_conn)
) -> AnalyticsSummary:
    """The 6 KPI cards plus band (open hotspots) and status breakdowns."""
    return analytics.summary(conn)


@router.get("/trend", response_model=AnalyticsTrend)
def trend(
    days: int = Query(30, ge=1, le=365),
    _user: DemoUser = Depends(authority_only),
    conn: Connection = Depends(get_conn),
) -> AnalyticsTrend:
    """Reports, hotspots opened and hotspots resolved per UTC day."""
    return analytics.trend(conn, days)


@router.get("/wards", response_model=AnalyticsWards)
def ward_stats(
    _user: DemoUser = Depends(authority_only), conn: Connection = Depends(get_conn)
) -> AnalyticsWards:
    return analytics.wards(conn)

"""Dashboard aggregates (SPEC §8, F8) — computed from the database, never fabricated.

Calendar days are UTC, matching how the scorer counts report days
(services/hotspot_state.py). "Open" means not resolved and not false_positive.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from statistics import median

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.schemas import (
    AnalyticsSummary,
    AnalyticsTrend,
    AnalyticsWards,
    BandCount,
    HotspotStatus,
    KpiCards,
    PriorityBand,
    StatusCount,
    TrendPoint,
    WardStats,
)

S = HotspotStatus
_BAND_ORDER = [PriorityBand.critical, PriorityBand.high, PriorityBand.medium, PriorityBand.low]
_OPEN = [s for s in HotspotStatus if s not in (S.resolved, S.false_positive)]

_ANY_SIMULATED = text("SELECT EXISTS (SELECT 1 FROM reports WHERE is_simulated)")


def _simulated(conn: Connection) -> bool:
    return bool(conn.execute(_ANY_SIMULATED).scalar())


def _days_to_resolve(conn: Connection) -> list[float]:
    """For every resolve event: days since that hotspot was last (re)opened."""
    rows = conn.execute(
        text(
            """
            SELECT r.created_at AS resolved_at,
                   (SELECT max(o.created_at) FROM hotspot_events o
                    WHERE o.hotspot_id = r.hotspot_id AND o.to_status = 'ai_detected'
                      AND (o.from_status IS NULL OR o.from_status = 'resolved')
                      AND o.created_at <= r.created_at) AS opened_at
            FROM hotspot_events r WHERE r.to_status = 'resolved'
            """
        )
    ).all()
    return [
        (r.resolved_at - r.opened_at).total_seconds() / 86400
        for r in rows
        if r.opened_at is not None
    ]


def summary(conn: Connection) -> AnalyticsSummary:
    status_rows = conn.execute(
        text("SELECT status, count(*) AS n FROM hotspots GROUP BY status")
    ).all()
    by_status = {r.status: r.n for r in status_rows}
    band_rows = conn.execute(
        text(
            """
            SELECT priority_band AS band, count(*) AS n FROM hotspots
            WHERE status NOT IN ('resolved', 'false_positive') AND priority_band IS NOT NULL
            GROUP BY priority_band
            """
        )
    ).all()
    by_band = {r.band: r.n for r in band_rows}
    total_reports = conn.execute(text("SELECT count(*) FROM reports")).scalar_one()
    durations = _days_to_resolve(conn)

    return AnalyticsSummary(
        kpis=KpiCards(
            total_reports=total_reports,
            active_hotspots=sum(by_status.get(s.value, 0) for s in _OPEN),
            awaiting_verification=by_status.get("needs_verification", 0),
            verified_hotspots=by_status.get("verified", 0),
            resolved_hotspots=by_status.get("resolved", 0),
            median_days_to_resolve=round(median(durations), 1) if durations else None,
        ),
        by_band=[BandCount(band=b, count=by_band.get(b.value, 0)) for b in _BAND_ORDER],
        by_status=[StatusCount(status=s, count=by_status.get(s.value, 0)) for s in HotspotStatus],
        simulated_data=_simulated(conn),
    )


def trend(conn: Connection, days: int, today: datetime | None = None) -> AnalyticsTrend:
    """One point per UTC day for the last `days` days, ending today."""
    end = (today or datetime.now(UTC)).astimezone(UTC).date()
    start = end - timedelta(days=days - 1)
    params = {"start": datetime(start.year, start.month, start.day, tzinfo=UTC)}

    def per_day(sql: str) -> dict:
        return {
            r.day: r.n
            for r in conn.execute(
                text(
                    f"SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n "
                    f"FROM {sql} AND created_at >= :start GROUP BY 1"
                ),
                params,
            ).all()
        }

    reports = per_day("reports WHERE true")
    opened = per_day(
        "hotspot_events WHERE to_status = 'ai_detected'"
        " AND (from_status IS NULL OR from_status = 'resolved')"
    )
    resolved = per_day("hotspot_events WHERE to_status = 'resolved'")
    points = []
    for i in range(days):
        d = start + timedelta(days=i)
        points.append(
            TrendPoint(
                date=d.isoformat(),
                reports=reports.get(d, 0),
                hotspots_opened=opened.get(d, 0),
                hotspots_resolved=resolved.get(d, 0),
            )
        )
    return AnalyticsTrend(days=days, points=points, simulated_data=_simulated(conn))


def wards(conn: Connection) -> AnalyticsWards:
    rows = conn.execute(
        text(
            """
            SELECT w.id, w.name,
                   count(h.id) AS hotspot_count,
                   count(h.id) FILTER (WHERE h.status NOT IN ('resolved', 'false_positive'))
                       AS open_count,
                   count(h.id) FILTER (WHERE h.status = 'resolved') AS resolved_count,
                   avg(h.impact_score)
                       FILTER (WHERE h.status NOT IN ('resolved', 'false_positive'))
                       AS avg_impact,
                   (SELECT count(*) FROM reports r JOIN hotspots h2 ON h2.id = r.hotspot_id
                    WHERE h2.ward_id = w.id) AS total_reports
            FROM wards w LEFT JOIN hotspots h ON h.ward_id = w.id
            GROUP BY w.id ORDER BY w.id
            """
        )
    ).all()
    return AnalyticsWards(
        wards=[
            WardStats(
                ward_id=r.id,
                ward_name=r.name,
                hotspot_count=r.hotspot_count,
                open_count=r.open_count,
                resolved_count=r.resolved_count,
                avg_impact=r.avg_impact,
                total_reports=r.total_reports,
            )
            for r in rows
        ],
        simulated_data=_simulated(conn),
    )

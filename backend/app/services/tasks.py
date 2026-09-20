"""Cleanup tasks (SPEC §8, F9 — Stage P1-A).

A task is an ordered route over VERIFIED hotspots only (SPEC §13): anything else is a
409. Creating it moves each hotspot verified -> cleanup_scheduled through the status
machine, so every stop is audited with the authority who scheduled it. Teams see
only the tasks assigned to them.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.config import get_settings
from app.schemas import (
    ArriveResponse,
    DemoUser,
    HotspotStatus,
    TaskCreateRequest,
    TaskDetail,
    TaskStop,
    TaskSummary,
    UserRole,
)
from app.services.routing import haversine_m, plan_route
from app.services.workflow import transition


class TaskError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


_SUMMARY = """
    SELECT t.id, t.status, t.assigned_team, u.name AS assigned_team_name, t.created_by,
           t.route_distance_m, t.route_duration_s, t.created_at, t.route_geojson,
           ST_X(t.depot) AS depot_lon, ST_Y(t.depot) AS depot_lat,
           (SELECT count(*) FROM task_stops s WHERE s.task_id = t.id) AS stop_count,
           EXISTS (SELECT 1 FROM task_stops s JOIN reports r ON r.hotspot_id = s.hotspot_id
                   WHERE s.task_id = t.id AND r.is_simulated) AS is_simulated
    FROM cleanup_tasks t LEFT JOIN users u ON u.id = t.assigned_team
"""


def _summary(row) -> TaskSummary:
    return TaskSummary(
        id=row.id,
        status=row.status,
        assigned_team=row.assigned_team,
        assigned_team_name=row.assigned_team_name,
        created_by=row.created_by,
        stop_count=row.stop_count,
        route_distance_m=row.route_distance_m,
        route_duration_s=row.route_duration_s,
        created_at=row.created_at,
        is_simulated=row.is_simulated,
    )


def list_tasks(conn: Connection, user: DemoUser) -> list[TaskSummary]:
    sql, params = _SUMMARY, {}
    if user.role == UserRole.team:
        sql += " WHERE t.assigned_team = :team"
        params["team"] = user.id
    rows = conn.execute(text(sql + " ORDER BY t.created_at DESC, t.id DESC"), params).all()
    return [_summary(r) for r in rows]


def task_detail(conn: Connection, task_id: int, user: DemoUser) -> TaskDetail | None:
    row = conn.execute(text(_SUMMARY + " WHERE t.id = :id"), {"id": task_id}).first()
    if row is None or (user.role == UserRole.team and row.assigned_team != user.id):
        return None  # a team can't see (or probe for) another team's task
    stops = conn.execute(
        text(
            """
            SELECT s.id, s.seq, s.hotspot_id, ST_Y(h.geom) AS lat, ST_X(h.geom) AS lon,
                   h.priority_band, s.arrived_at, s.completed_at,
                   b.id AS before_after_id, b.verdict, b.review_decision
            FROM task_stops s JOIN hotspots h ON h.id = s.hotspot_id
            LEFT JOIN before_after b ON b.task_stop_id = s.id
            WHERE s.task_id = :id ORDER BY s.seq
            """
        ),
        {"id": task_id},
    ).mappings().all()
    geo = row.route_geojson
    source = None
    if geo:
        source = (geo.get("properties") or {}).get("source", "greedy")
    return TaskDetail(
        **_summary(row).model_dump(),
        depot=[row.depot_lon, row.depot_lat] if row.depot_lon is not None else None,
        stops=[TaskStop.model_validate(dict(s)) for s in stops],
        route_geojson=geo,
        route_source=source,
    )


def create_task(conn: Connection, body: TaskCreateRequest, actor: DemoUser) -> TaskDetail:
    team = conn.execute(
        text("SELECT id FROM users WHERE id = :id AND role = 'team'"), {"id": body.team_id}
    ).first()
    if team is None:
        raise TaskError(422, "team_id must be a cleanup team account.")
    if len(body.depot) != 2:
        raise TaskError(422, "depot must be [lon, lat].")

    ids = list(dict.fromkeys(body.hotspot_ids))  # de-duplicate, keep order
    rows = conn.execute(
        text(
            "SELECT id, status, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM hotspots"
            " WHERE id = ANY(:ids) ORDER BY id FOR UPDATE"
        ),
        {"ids": ids},
    ).all()
    missing = sorted(set(ids) - {r.id for r in rows})
    if missing:
        raise TaskError(404, f"Hotspot(s) not found: {', '.join(map(str, missing))}.")
    not_verified = [f"#{r.id} ({r.status})" for r in rows if r.status != "verified"]
    if not_verified:
        raise TaskError(
            409,
            "Cleanup tasks accept verified hotspots only. Not verified: "
            + ", ".join(not_verified) + ".",
        )

    depot = (float(body.depot[0]), float(body.depot[1]))
    route = plan_route(depot, [(r.id, (r.lon, r.lat)) for r in rows])
    now = datetime.now(UTC)
    task_id = conn.execute(
        text(
            """
            INSERT INTO cleanup_tasks (created_by, assigned_team, status, depot, route_geojson,
                                       route_distance_m, route_duration_s, created_at)
            VALUES (:by, :team, 'planned', ST_SetSRID(ST_MakePoint(:x, :y), 4326),
                    CAST(:geo AS jsonb), :dist, :dur, :at)
            RETURNING id
            """
        ),
        {
            "by": actor.id, "team": body.team_id, "x": depot[0], "y": depot[1],
            "geo": json.dumps(route.geojson()), "dist": route.distance_m, "dur": route.duration_s,
            "at": now,
        },
    ).scalar_one()
    for seq, hid in enumerate(route.order, start=1):
        conn.execute(
            text("INSERT INTO task_stops (task_id, hotspot_id, seq) VALUES (:t, :h, :s)"),
            {"t": task_id, "h": hid, "s": seq},
        )
        transition(
            conn, hid, HotspotStatus.cleanup_scheduled, actor=actor, at=now,
            note=f"Added to cleanup task #{task_id} (stop {seq}).",
        )
    return task_detail(conn, task_id, actor)


def arrive(
    conn: Connection, task_id: int, stop_id: int, user: DemoUser, lon: float, lat: float
) -> ArriveResponse:
    detail = task_detail(conn, task_id, user)
    if detail is None:  # also covers another team's task: it is simply not found
        raise TaskError(404, "Task not found.")
    stop = next((s for s in detail.stops if s.id == stop_id), None)
    if stop is None:
        raise TaskError(404, "Stop not found on this task.")

    distance = haversine_m((lon, lat), (stop.lon, stop.lat))
    within = distance <= get_settings().ARRIVE_RADIUS_M
    if within and stop.arrived_at is None:
        now = datetime.now(UTC)
        conn.execute(
            text("UPDATE task_stops SET arrived_at = :at WHERE id = :id"),
            {"at": now, "id": stop_id},
        )
        conn.execute(
            text(
                "UPDATE cleanup_tasks SET status = 'in_progress' "
                "WHERE id = :t AND status = 'planned'"
            ),
            {"t": task_id},
        )
        stop = stop.model_copy(update={"arrived_at": now})
    return ArriveResponse(stop=stop, distance_m=round(distance, 1), within_range=within)

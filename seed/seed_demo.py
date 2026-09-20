"""Seed / reset the SIMULATED demo state (SPEC F11, §19).

Replays seed/scenario.json — a 45-day history — through the REAL code paths:
every report goes through the report pipeline (quality gate, pHash, dedupe,
geo-context, scoring, promotion) with a back-dated timestamp, and every decision
goes through the status machine as the demo authority or cleanup team. Cleanups
go through the before/after service (quality, ORB viewpoint, verdict) and are only
resolved by an authority's review. The seeded state therefore obeys every rule the
live system does: nothing is verified or resolved without a human actor on the
audit record, and every row is simulated.

Photos are procedurally drawn litter scenes (seed/scenes.py) whose exact boxes are
fed in as the detections — simulated data, flagged as such. After-photos are retakes
of the same street (same scene seed) with the litter removed.

Usage (repo root):   python seed/seed_demo.py [--reset]
In docker:           make seed   /   make reset-demo
The API's POST /admin/reset-demo calls reset_and_seed().
Idempotent: it always wipes demo state first (wards and geo layers are kept).
"""

from __future__ import annotations

import importlib.util
import io
import json
import math
import random
import shutil
import sys
import time
import uuid
import zlib
from datetime import UTC, datetime, timedelta
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SEED_DIR))
try:  # in the api container PYTHONPATH=/app; from the repo root we add backend/
    import app  # noqa: F401
except ImportError:
    sys.path.insert(0, str(SEED_DIR.parent / "backend"))

from app.deps import demo_users  # noqa: E402
from app.schemas import (  # noqa: E402
    DemoUser,
    HotspotStatus,
    LocationSource,
    ReviewDecision,
    ReviewRequest,
    UserRole,
)
from app.services import before_after, pipeline  # noqa: E402
from app.services.hotspot_state import rescore_hotspot  # noqa: E402
from app.services.media import upload_root  # noqa: E402
from app.services.routing import greedy_route  # noqa: E402
from app.services.users import ensure_demo_users  # noqa: E402
from app.services.workflow import transition  # noqa: E402
from scenes import close_up, make_scene, retake  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import Connection  # noqa: E402

S = HotspotStatus
SEED_NS = uuid.UUID("5eed0000-0000-4000-8000-00000000c1a0")
DEMO_TABLES = (
    "reports, detections, hotspots, hotspot_events, cleanup_tasks, task_stops, before_after"
)


def seed_citizen_id(i: int) -> uuid.UUID:
    return uuid.uuid5(SEED_NS, f"seed-citizen-{i}")


def _load_geo_module():
    path = SEED_DIR.parent / "gis" / "load_geo.py"
    spec = importlib.util.spec_from_file_location("load_geo", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _wipe(conn: Connection) -> None:
    conn.execute(text(f"TRUNCATE {DEMO_TABLES} RESTART IDENTITY CASCADE"))
    keep = [str(u.id) for u in demo_users()]
    conn.execute(text("DELETE FROM users WHERE NOT (id::text = ANY(:keep))"), {"keep": keep})
    for sub in ("reports", "annotated", "after"):
        shutil.rmtree(upload_root() / sub, ignore_errors=True)


def _ensure_geo(conn: Connection) -> None:
    features = conn.execute(text("SELECT count(*) FROM geo_features")).scalar()
    wards = conn.execute(text("SELECT count(*) FROM wards")).scalar()
    if not features or not wards:
        _load_geo_module().load_all(conn)


def _people(conn: Connection, n_seed: int) -> dict:
    ensure_demo_users(conn)
    for i in range(1, n_seed + 1):
        conn.execute(
            text("INSERT INTO users (id, name, role) VALUES (:id, :name, 'citizen')"),
            {"id": seed_citizen_id(i), "name": f"Seed citizen {i}"},
        )
    demo = demo_users()
    citizens = [u for u in demo if u.role == UserRole.citizen]
    who = {"A": citizens[0].id, "B": citizens[1].id}
    who.update({i: seed_citizen_id(i) for i in range(1, n_seed + 1)})
    return {
        "reporter": who,
        "authority": next(u for u in demo if u.role == UserRole.authority),
        "team": next(u for u in demo if u.role == UserRole.team),
    }


def _jitter(lon: float, lat: float, key: str, idx: int, max_m: float = 8.0) -> tuple[float, float]:
    rng = random.Random(zlib.crc32(f"{key}-{idx}-pos".encode()))
    r, a = rng.uniform(0, max_m), rng.uniform(0, 2 * math.pi)
    dlat = r * math.sin(a) / 111_320
    dlon = r * math.cos(a) / (111_320 * math.cos(math.radians(lat)))
    return lon + dlon, lat + dlat


def _scene_seed(key: str, idx: int) -> int:
    return zlib.crc32(f"{key}-{idx}".encode())


def _jpeg(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def _after_photos(seed: int, left: int) -> tuple[dict[str, bytes], dict[str, list[dict]]]:
    """Wide + close after-photos of the SAME street (same scene seed), `left` likely-
    plastic items remaining, with the boxes carried through the re-photographing."""
    scene, dets = make_scene(seed, left, 1)
    wide, wide_dets = retake(scene, dets, seed)
    close, close_dets = close_up(wide, wide_dets, seed)
    return {"wide": _jpeg(wide), "close": _jpeg(close)}, {"wide": wide_dets, "close": close_dets}


def _photo(key: str, idx: int, plastic: int, other: int, conf: list[float] | None):
    img, dets = make_scene(_scene_seed(key, idx), plastic, other)
    if conf:  # rescale the drawn "confidences" into the scenario's range
        lo, hi = conf
        for d in dets:
            d["confidence"] = round(lo + (d["confidence"] - 0.52) / (0.93 - 0.52) * (hi - lo), 3)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue(), dets


def reset_and_seed(conn: Connection, now: datetime | None = None) -> dict:
    """Wipe demo state and replay the scenario. Caller owns the transaction."""
    t0 = time.monotonic()
    now = (now or datetime.now(UTC)).astimezone(UTC)
    scenario = json.loads((SEED_DIR / "scenario.json").read_text(encoding="utf-8"))
    start = now - timedelta(days=scenario["days"])

    _wipe(conn)
    _ensure_geo(conn)
    people = _people(conn, scenario["seed_citizens"])
    authority: DemoUser = people["authority"]
    team: DemoUser = people["team"]

    # Build one chronological list of steps: (when, order, kind, payload).
    steps = []
    for h_i, h in enumerate(scenario["hotspots"]):
        for i, r in enumerate(h["reports"]):
            hour = r.get("hour", 3 + (i * 5 + h_i) % 7)  # 03:00-09:59 UTC
            when = start + timedelta(days=r["day"], hours=hour, minutes=(h_i * 7) % 50)
            steps.append((when, 0, "report", (h, i, r)))
        for a in h["actions"]:
            when = start + timedelta(days=a["day"], hours=13, minutes=(h_i * 3) % 40)
            steps.append((when, 1, "action", (h, a)))
    for i, r in enumerate(scenario.get("rejected_reports", [])):
        when = start + timedelta(days=r["day"], hours=6, minutes=i * 11)
        steps.append((when, 0, "rejected", (i, r)))
    for i, r in enumerate(scenario.get("duplicates", [])):
        when = start + timedelta(days=r["day"], hours=10, minutes=i * 13)
        steps.append((when, 0, "duplicate", (i, r)))
    steps.sort(key=lambda s: (s[0], s[1]))

    hotspot_of: dict[str, int] = {}
    last_scene: dict[str, int] = {}  # hotspot key -> scene seed of its latest photo
    photos: dict[tuple[str, int], tuple[bytes, list[dict]]] = {}
    tasks: dict[int, int] = {}  # scenario day -> cleanup_tasks.id
    reporter = people["reporter"]

    CITIZEN_PROOFS = [
        ("Priya Sharma", "+91 98765 43210"),
        ("Aarav Patel", "+91 98123 45678"),
        ("Rohan Verma", "+91 97654 32109"),
        ("Ananya Iyer", "+91 99887 76655"),
        ("Vikram Singh", "+91 98234 56789"),
        ("Sneha Kulkarni", "+91 97123 98765"),
        ("Mohammed Farooq", "+91 96543 21098"),
        ("Pooja Nair", "+91 98321 65490"),
    ]

    for when, _, kind, payload in steps:
        if when > now:
            continue
        if kind == "report":
            h, i, r = payload
            lon, lat = _jitter(*h["at"], h["key"], i)
            image, dets = _photo(h["key"], i, r["plastic"], r.get("other", 2), r.get("conf"))
            photos[(h["key"], i)] = (image, dets)
            c_name, c_phone = CITIZEN_PROOFS[(i + len(h["key"])) % len(CITIZEN_PROOFS)]
            res = pipeline.process_report(
                conn,
                reporter_id=reporter[r["by"]],
                image_bytes=image,
                lat=lat,
                lon=lon,
                source=LocationSource.browser,
                accuracy_m=r.get("acc", 6 + (i % 5) * 2),
                note=r.get("note"),
                reporter_name=c_name,
                reporter_phone=c_phone,
                created_at=when,
                simulated_location=True,
                known_detections=dets,
            )
            if res.dedupe is not None:
                hotspot_of.setdefault(h["key"], res.dedupe.hotspot_id)
                last_scene[h["key"]] = _scene_seed(h["key"], i)
        elif kind == "rejected":
            i, r = payload
            image, dets = _photo(f"rejected-{i}", 0, 0, 3, None)
            pipeline.process_report(
                conn,
                reporter_id=reporter[r["by"]],
                image_bytes=image,
                lat=r["at"][1],
                lon=r["at"][0],
                source=LocationSource.browser,
                accuracy_m=9,
                note=r.get("note"),
                created_at=when,
                simulated_location=True,
                known_detections=dets,
            )
        elif kind == "duplicate":
            i, r = payload
            key, idx = r["of"]
            h = next(x for x in scenario["hotspots"] if x["key"] == key)
            lon, lat = _jitter(*h["at"], key, 900 + i)
            image, dets = photos[(key, idx)]  # the SAME photo: dedupe's pHash check catches it
            pipeline.process_report(
                conn,
                reporter_id=reporter[r["by"]],
                image_bytes=image,
                lat=lat,
                lon=lon,
                source=LocationSource.browser,
                accuracy_m=8,
                note=r.get("note"),
                created_at=when,
                simulated_location=True,
                known_detections=dets,
            )
        else:  # a human decision
            h, a = payload
            hid = hotspot_of[h["key"]]
            do = a["do"]
            if do == "verify":
                transition(conn, hid, S.verified, actor=authority, note=a.get("note"), at=when)
            elif do in ("reject", "false_positive"):
                transition(
                    conn,
                    hid,
                    S.false_positive,
                    actor=authority,
                    reason=a["reason"],
                    note=a.get("note"),
                    at=when,
                )
            elif do == "schedule":
                transition(
                    conn,
                    hid,
                    S.cleanup_scheduled,
                    actor=authority,
                    note="Added to a cleanup route.",
                    at=when,
                )
                task = tasks.get(a["day"])
                if task is None:
                    task = conn.execute(
                        text(
                            "INSERT INTO cleanup_tasks (created_by, assigned_team, status, depot,"
                            " created_at) VALUES (:by, :team, 'planned',"
                            " ST_SetSRID(ST_MakePoint(:x, :y), 4326), :at) RETURNING id"
                        ),
                        {
                            "by": authority.id,
                            "team": team.id,
                            "x": scenario["depot"][0],
                            "y": scenario["depot"][1],
                            "at": when,
                        },
                    ).scalar_one()
                    tasks[a["day"]] = task
                seq = conn.execute(
                    text("SELECT count(*) + 1 FROM task_stops WHERE task_id = :t"), {"t": task}
                ).scalar_one()
                conn.execute(
                    text("INSERT INTO task_stops (task_id, hotspot_id, seq) VALUES (:t, :h, :s)"),
                    {"t": task, "h": hid, "s": seq},
                )
            elif do == "complete":
                stop = conn.execute(
                    text(
                        "SELECT id, task_id FROM task_stops"
                        " WHERE hotspot_id = :h AND completed_at IS NULL ORDER BY id DESC LIMIT 1"
                    ),
                    {"h": hid},
                ).one()
                conn.execute(  # the team checked in on site (simulated)
                    text("UPDATE task_stops SET arrived_at = :arr WHERE id = :id"),
                    {"arr": when - timedelta(minutes=40), "id": stop.id},
                )
                after, known = _after_photos(last_scene[h["key"]], a.get("left", 0))
                before_after.submit_after(
                    conn, stop.task_id, stop.id, after, team, at=when, known_detections=known
                )
            elif do == "resolve":
                ba_id = conn.execute(
                    text(
                        "SELECT b.id FROM before_after b JOIN task_stops s"
                        " ON s.id = b.task_stop_id WHERE s.hotspot_id = :h"
                        " ORDER BY b.id DESC LIMIT 1"
                    ),
                    {"h": hid},
                ).scalar_one()
                before_after.review(
                    conn,
                    ba_id,
                    ReviewRequest(decision=ReviewDecision.confirm_resolved, note=a.get("note")),
                    authority,
                    at=when,
                )
            else:
                raise ValueError(f"unknown action {do!r}")

    _route_tasks(conn, tasks, scenario["depot"])

    # Stored scores reflect "today", so the live map matches the time slider's end.
    for (hid,) in conn.execute(text("SELECT id FROM hotspots")).all():
        rescore_hotspot(conn, hid, now)

    counts = {
        "reports": conn.execute(text("SELECT count(*) FROM reports")).scalar_one(),
        "hotspots": conn.execute(text("SELECT count(*) FROM hotspots")).scalar_one(),
        "users": conn.execute(text("SELECT count(*) FROM users")).scalar_one(),
        "tasks": conn.execute(text("SELECT count(*) FROM cleanup_tasks")).scalar_one(),
        "by_status": dict(
            conn.execute(text("SELECT status, count(*) FROM hotspots GROUP BY status")).all()
        ),
        "seconds": round(time.monotonic() - t0, 1),
    }
    return counts


def _route_tasks(conn: Connection, tasks: dict[int, int], depot: list[float]) -> None:
    """One cached greedy route per task (ORS is optional; P1-A adds it)."""
    for task in tasks.values():
        stops = conn.execute(
            text(
                "SELECT s.id, ST_X(h.geom), ST_Y(h.geom), s.arrived_at, s.completed_at"
                " FROM task_stops s JOIN hotspots h ON h.id = s.hotspot_id WHERE s.task_id = :t"
            ),
            {"t": task},
        ).all()
        route = greedy_route((depot[0], depot[1]), [(s[0], (s[1], s[2])) for s in stops])
        for seq, sid in enumerate(route.order, start=1):
            conn.execute(
                text("UPDATE task_stops SET seq = -:s WHERE id = :id"), {"s": seq, "id": sid}
            )
        conn.execute(text("UPDATE task_stops SET seq = -seq WHERE task_id = :t"), {"t": task})
        done = all(s[4] is not None for s in stops)
        started = any(s[3] is not None for s in stops)
        conn.execute(
            text(
                "UPDATE cleanup_tasks SET route_geojson = CAST(:g AS jsonb), route_distance_m = :d,"
                " route_duration_s = :dur, status = :st WHERE id = :t"
            ),
            {
                "g": json.dumps(route.geojson()),
                "d": route.distance_m,
                "dur": route.duration_s,
                "st": "done" if done else "in_progress" if started else "planned",
                "t": task,
            },
        )


def main() -> int:
    from app.db import get_engine

    with get_engine().begin() as conn:
        counts = reset_and_seed(conn)
    print(
        f"Demo state reset: {counts['reports']} reports, {counts['hotspots']} hotspots, "
        f"{counts['users']} users, {counts['tasks']} cleanup tasks in {counts['seconds']} s."
    )
    for status, n in sorted(counts["by_status"].items()):
        print(f"  {status:<20} {n}")
    print("ALL SEEDED DATA IS SIMULATED (is_simulated = true).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

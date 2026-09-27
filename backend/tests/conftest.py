"""Shared test fixtures.

`db_engine` creates a throwaway database (unique name) on the server named by
TEST_DATABASE_URL, falling back to DATABASE_URL, applies sql/schema.sql, and drops it
at the end of the session. Tests therefore never touch the dev database — the GIS
loader truncates geo_features, which would otherwise wipe real layers.

If no Postgres server is reachable, DB-backed tests are SKIPPED with the reason shown
(run `pytest -rs` to list them). With `make up` the db service is always reachable.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import Connection, make_url
from sqlalchemy.exc import OperationalError

from app.config import get_settings

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "app" / "sql" / "schema.sql"

ALL_TABLES = (
    "users, wards, geo_features, reports, detections, hotspots, hotspot_events,"
    " cleanup_tasks, task_stops, before_after"
)


@pytest.fixture(scope="session")
def db_url() -> Iterator[str]:
    """URL of a freshly created, schema-applied test database."""
    base = make_url(os.environ.get("TEST_DATABASE_URL") or get_settings().DATABASE_URL)
    admin = create_engine(
        base.set(database="postgres"),
        isolation_level="AUTOCOMMIT",
        connect_args={"connect_timeout": 3},
    )
    name = f"pw_test_{uuid.uuid4().hex[:10]}"
    try:
        with admin.connect() as c:
            c.execute(text(f'CREATE DATABASE "{name}"'))
    except OperationalError as exc:
        admin.dispose()
        pytest.skip(
            f"No PostGIS server for DB tests at "
            f"{base.render_as_string(hide_password=True)}: {str(exc.orig).splitlines()[0]}"
        )

    url = base.set(database=name)
    engine = create_engine(url, future=True)
    with engine.begin() as c:
        c.exec_driver_sql(SCHEMA_PATH.read_text(encoding="utf-8"))
    engine.dispose()

    yield url.render_as_string(hide_password=False)

    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture(scope="session")
def db_engine(db_url: str) -> Iterator[Engine]:
    # Deliberately NOT forced to UTC (unlike app.db): scoring must be correct whatever
    # time zone the session returns timestamps in.
    engine = create_engine(db_url, future=True)
    yield engine
    engine.dispose()


@pytest.fixture
def set_env(monkeypatch):
    """Override settings for one test: set_env(DETECTOR_MODE="real", ...).

    get_settings() is cached, so the cache is cleared on the way in and out.
    """

    def _set(**values) -> None:
        for key, value in values.items():
            monkeypatch.setenv(key, str(value))
        get_settings.cache_clear()

    yield _set
    get_settings.cache_clear()


def truncate_all(engine: Engine) -> None:
    with engine.begin() as c:
        c.execute(text(f"TRUNCATE {ALL_TABLES} RESTART IDENTITY CASCADE"))


@pytest.fixture
def conn(db_engine: Engine) -> Iterator[Connection]:
    """A connection on empty tables, inside a transaction rolled back after the test."""
    truncate_all(db_engine)
    with db_engine.connect() as c:
        tx = c.begin()
        yield c
        tx.rollback()


@pytest.fixture
def api(db_engine: Engine, set_env, tmp_path):
    """TestClient wired to the throwaway DB: empty tables + seeded demo users,
    uploads in a temp dir, stub detector. Each request commits, like production."""
    from fastapi.testclient import TestClient

    from app.db import get_conn, get_optional_conn
    from app.main import app
    from app.services.users import ensure_demo_users

    set_env(UPLOAD_DIR=tmp_path / "uploads", DETECTOR_MODE="stub")
    truncate_all(db_engine)
    with db_engine.begin() as c:
        ensure_demo_users(c)

    def _conn():
        with db_engine.begin() as c:
            yield c

    app.dependency_overrides[get_conn] = _conn
    app.dependency_overrides[get_optional_conn] = _conn
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_conn, None)
        app.dependency_overrides.pop(get_optional_conn, None)


def auth_header(client, role: str) -> dict[str, str]:
    res = client.post("/auth/demo-login", json={"role": role})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}

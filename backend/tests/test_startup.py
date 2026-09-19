"""Startup must degrade, not hang, when the database is unreachable.

Regression test: before DB_CONNECT_TIMEOUT_S, an unreachable Postgres blocked the
lifespan hook forever ("Waiting for application startup."), because psycopg has no
connect timeout by default. A try/except around the bootstrap cannot catch a hang.

Note TestClient only runs lifespan events when used as a context manager — the
module-level client in test_contract.py never exercises startup at all.
"""

import time

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import get_engine
from app.main import app

# Port 1 on loopback is never a Postgres server: the connect can only time out/refuse.
UNREACHABLE = "postgresql+psycopg://x:x@127.0.0.1:1/x"


@pytest.fixture
def unreachable_db(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", UNREACHABLE)
    monkeypatch.setenv("DB_CONNECT_TIMEOUT_S", "2")
    get_settings.cache_clear()
    get_engine.cache_clear()
    yield
    get_settings.cache_clear()
    get_engine.cache_clear()


def test_startup_completes_and_health_degrades_when_db_unreachable(unreachable_db):
    started = time.monotonic()
    with TestClient(app) as client:  # runs the lifespan (schema bootstrap)
        res = client.get("/health")
    elapsed = time.monotonic() - started

    assert res.status_code == 200
    assert res.json() == {"status": "ok", "postgis": False}
    # Two bounded connects (bootstrap + health) at 2 s each, plus slack.
    assert elapsed < 20, f"startup/health took {elapsed:.1f}s — connect is not bounded"

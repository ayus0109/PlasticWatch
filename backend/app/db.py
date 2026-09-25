"""Database access: SQLAlchemy Core + raw SQL only (CLAUDE.md §3).

No ORM models anywhere in this project — spatial queries are written as raw SQL so
PostGIS functions (ST_DWithin, ST_Distance on ::geography, KNN <->) stay visible and
tunable.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import Connection

from app.config import get_settings

_last_db_failure_time: float = 0.0


def is_db_available() -> bool:
    """Check if the database circuit breaker allows connection attempts."""
    global _last_db_failure_time
    return (time.monotonic() - _last_db_failure_time) >= 10.0


def mark_db_failure() -> None:
    """Record a connection failure to trip the circuit breaker."""
    global _last_db_failure_time
    _last_db_failure_time = time.monotonic()


@lru_cache
def get_engine() -> Engine:
    """Process-wide engine. pool_pre_ping survives the db container restarting.

    connect_timeout makes an unreachable database FAIL rather than hang, so startup
    and /health degrade to postgis=false instead of blocking forever.

    Every session runs in UTC so timestamps (and anything derived from calendar
    days) are identical whatever time zone the database server is configured in.
    """
    settings = get_settings()
    return create_engine(
        settings.DATABASE_URL,
        pool_pre_ping=True,
        future=True,
        connect_args={
            "connect_timeout": settings.DB_CONNECT_TIMEOUT_S,
            "options": "-c timezone=UTC",
        },
    )


def get_conn() -> Iterator[Connection]:
    """FastAPI dependency yielding a transactional connection.

    Commits on success, rolls back if the request handler raises.
    """
    with get_engine().begin() as conn:
        yield conn


def get_optional_conn() -> Iterator[Connection | None]:
    """FastAPI dependency yielding a transactional connection if available, or None.

    Allows auth endpoints to fall back gracefully to demo users when DB is unreachable.
    Uses a circuit breaker so repeated offline calls don't hang on connection timeouts.
    """
    global _last_db_failure_time
    now = time.monotonic()
    if now - _last_db_failure_time < 10.0:
        yield None
        return

    try:
        with get_engine().begin() as conn:
            yield conn
    except Exception:
        _last_db_failure_time = time.monotonic()
        yield None

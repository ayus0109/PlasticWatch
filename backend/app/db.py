"""Database access: SQLAlchemy Core + raw SQL only (CLAUDE.md §3).

No ORM models anywhere in this project — spatial queries are written as raw SQL so
PostGIS functions (ST_DWithin, ST_Distance on ::geography, KNN <->) stay visible and
tunable.
"""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import Connection

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    """Process-wide engine. pool_pre_ping survives the db container restarting.

    connect_timeout makes an unreachable database FAIL rather than hang, so startup
    and /health degrade to postgis=false instead of blocking forever.
    """
    settings = get_settings()
    return create_engine(
        settings.DATABASE_URL,
        pool_pre_ping=True,
        future=True,
        connect_args={"connect_timeout": settings.DB_CONNECT_TIMEOUT_S},
    )


def get_conn() -> Iterator[Connection]:
    """FastAPI dependency yielding a transactional connection.

    Commits on success, rolls back if the request handler raises.
    """
    with get_engine().begin() as conn:
        yield conn

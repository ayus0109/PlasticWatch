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
    """Process-wide engine. pool_pre_ping survives the db container restarting."""
    settings = get_settings()
    return create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)


def get_conn() -> Iterator[Connection]:
    """FastAPI dependency yielding a transactional connection.

    Commits on success, rolls back if the request handler raises.
    """
    with get_engine().begin() as conn:
        yield conn

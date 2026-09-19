"""PlasticWatch API entrypoint.

App wiring, schema bootstrap, /health, and the Stage 1 frozen API surface. Routers
return fixtures until later stages replace each stub with real logic
(docs/CLAUDE_CODE_STAGES.md).
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from sqlalchemy import text

from app.db import get_engine
from app.routers import admin, analytics, auth, before_after, geo, hotspots, reports, tasks

logger = logging.getLogger("plasticwatch")

SCHEMA_PATH = Path(__file__).parent / "sql" / "schema.sql"

# Presence of this table is the marker for "schema already applied".
SCHEMA_SENTINEL_TABLE = "public.hotspots"


def apply_schema_if_absent() -> None:
    """Run sql/schema.sql once, if the schema has not been applied yet.

    schema.sql is idempotent, so a re-run is harmless; the sentinel check just keeps
    startup quiet on the common path.
    """
    engine = get_engine()
    with engine.begin() as conn:
        exists = conn.execute(
            text("SELECT to_regclass(:name)"), {"name": SCHEMA_SENTINEL_TABLE}
        ).scalar()
        if exists is not None:
            logger.info("Schema already present, skipping bootstrap.")
            return

        logger.info("Schema absent — applying %s", SCHEMA_PATH.name)
        # exec_driver_sql, not text(): the file is multi-statement DDL and must reach
        # the driver verbatim. text() would try to read ":word" as a bind parameter,
        # and psycopg only accepts multiple statements when no parameters are bound.
        conn.exec_driver_sql(SCHEMA_PATH.read_text(encoding="utf-8"))
        logger.info("Schema applied.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        apply_schema_if_absent()
    except Exception:
        # Don't take the API down if the db is still settling — /health will report it.
        logger.exception("Schema bootstrap failed.")
    yield


app = FastAPI(
    title="PlasticWatch API",
    description=(
        "AI-GIS detection and prioritisation of likely plastic-waste hotspots. "
        "Reports show waste appears to be present; they do not establish who is "
        "responsible."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

for module in (auth, reports, hotspots, geo, tasks, before_after, analytics, admin):
    app.include_router(module.router)


@app.get("/health")
def health() -> dict:
    """Liveness + PostGIS availability."""
    postgis = False
    try:
        with get_engine().connect() as conn:
            postgis = conn.execute(text("SELECT postgis_version()")).scalar() is not None
    except Exception:
        logger.exception("PostGIS health probe failed.")
    return {"status": "ok", "postgis": postgis}

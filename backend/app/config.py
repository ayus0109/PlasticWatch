"""Application settings.

Every tunable number in PlasticWatch lives here and is read from the environment
(CLAUDE.md §5). Nothing in services/ or routers/ may hard-code a radius, threshold,
weight or quota. The SPEC §20 OPEN ITEMS are wired to env keys until the team decides
them.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Config loaded from environment / .env. See .env.example for every key."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database -----------------------------------------------------------
    DATABASE_URL: str = "postgresql+psycopg://plasticwatch:plasticwatch@db:5432/plasticwatch"

    # --- Detector (SPEC §6) -------------------------------------------------
    # "stub" returns the frozen fake contract; "real" loads weights/best.pt.
    # The whole pipeline must stay demoable on "stub".
    DETECTOR_MODE: str = "stub"

    # --- Demo area (OPEN ITEM SPEC §20.1 — blocks OSM pull, wards, seed) -----
    # "min_lon,min_lat,max_lon,max_lat" in EPSG:4326.
    DEMO_AREA_BBOX: str = "0,0,0,0"
    DEMO_AREA_NAME: str = "UNSET"

    # --- Routing (OPEN ITEM SPEC §20.4 — confirm current ORS free quota) ----
    ORS_API_KEY: str = ""
    ORS_DAILY_QUOTA: int = 500

    # --- Duplicate detection (SPEC §12) -------------------------------------
    DEDUPE_RADIUS_M: int = 30
    DEDUPE_RADIUS_MAX_M: int = 75
    GPS_ACCURACY_WIDEN_M: int = 30
    PHASH_HAMMING_MAX: int = 6
    REOPEN_WINDOW_DAYS: int = 90

    # --- Local disk storage (CLAUDE.md §3) ----------------------------------
    UPLOAD_DIR: str = "uploads"


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton; use as a FastAPI dependency or call directly."""
    return Settings()

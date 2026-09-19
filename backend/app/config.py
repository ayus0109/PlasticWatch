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
    # Bounds every connect. Without it an unreachable DB hangs startup and /health
    # indefinitely instead of failing. libpq treats values below 2 as 2.
    DB_CONNECT_TIMEOUT_S: int = 5

    # --- Detector (SPEC §6) -------------------------------------------------
    # "stub" returns the frozen fake contract; "real" loads weights/best.pt.
    # The whole pipeline must stay demoable on "stub".
    DETECTOR_MODE: str = "stub"
    DETECTOR_WEIGHTS: str = "weights/best.pt"
    DETECTOR_IMGSZ: int = 640
    # Operating threshold; pick from the F1-vs-confidence curve on validation
    # (SPEC §6: ~0.25-0.4). Below it a box is dropped.
    DETECTOR_CONF_THRESHOLD: float = 0.3

    # --- Confidence tiers (CLAUDE.md §2.7) ----------------------------------
    # Raw confidence is not a calibrated probability; the UI always shows a tier.
    # [0, MEDIUM) low, [MEDIUM, HIGH) medium, [HIGH, 1] high.
    CONF_TIER_MEDIUM: float = 0.5
    CONF_TIER_HIGH: float = 0.75

    # --- Image quality gates (SPEC §14, USERFLOW quality gate) --------------
    # Laplacian variance below this = too blurry. Measured after resizing the
    # longest side to QUALITY_MAX_SIDE so the threshold is resolution-independent.
    # Deliberately lenient: rejecting a real report loses evidence, while a soft
    # photo only adds weak evidence the Evidence axis already discounts.
    # CALIBRATE on the team's local photo set before the demo.
    BLUR_MIN_VARIANCE: float = 25.0
    BRIGHTNESS_MIN: float = 35.0
    BRIGHTNESS_MAX: float = 230.0
    QUALITY_MAX_SIDE: int = 1024

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

    # --- Demo auth (CLAUDE.md §8: seeded demo users + role switcher) --------
    # Signs the demo role token. This is NOT real authentication and guards
    # nothing sensitive — it exists so role violations return 403.
    DEMO_TOKEN_SECRET: str = "plasticwatch-demo-secret-change-me"
    DEMO_TOKEN_TTL_HOURS: int = 24


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton; use as a FastAPI dependency or call directly."""
    return Settings()

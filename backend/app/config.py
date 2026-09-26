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
    # In "real" mode with no weights on disk, allow the OpenCV contour heuristic as a
    # last resort (hosts too small for PyTorch). Off by default: missing weights is an
    # error, not a silent substitute. When on, its output is capped at
    # detector.CV_MAX_CONFIDENCE and labelled HEURISTIC on the annotated image.
    DETECTOR_CV_FALLBACK: bool = False
    # Precomputed detections for the committed demo photos, keyed by perceptual
    # hash, so the live demo never waits on inference (Stage 10). Empty = off.
    DETECTOR_CACHE_PATH: str = "../seed/demo_images/detections.json"
    DETECTOR_CACHE_HAMMING: int = 6

    # --- Hosted inference (Roboflow) ----------------------------------------
    # PRIVACY: this uploads the citizen's photo to a third party. Everything else in
    # PlasticWatch runs on our own machine. Only for hosts that cannot carry PyTorch
    # (the free deploy tier); the local docker-compose demo should use "real".
    # Off unless a key is set, and tried only AFTER local weights (detector._run_real).
    # The model is trained on TACO, so it returns TACO category names, which
    # detector.TACO_TO_CONTRACT maps onto the frozen five (SPEC §6). Person/vehicle
    # labels are dropped by the same filter as every other path (CLAUDE.md §2.4).
    ROBOFLOW_API_KEY: str = ""
    ROBOFLOW_MODEL_ID: str = "garbage-litter-detector/1"
    ROBOFLOW_URL: str = "https://serverless.roboflow.com"
    ROBOFLOW_TIMEOUT_S: float = 12.0

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
    ORS_OPTIMIZATION_URL: str = "https://api.openrouteservice.org/optimization"
    ORS_TIMEOUT_S: float = 8.0
    # Average cleanup-vehicle speed for route durations when ORS is unavailable.
    ROUTE_SPEED_KMH: float = 15.0
    # A team member must be this close to a stop to mark arrival (SPEC §8).
    ARRIVE_RADIUS_M: float = 50.0

    # --- Duplicate detection (SPEC §12) -------------------------------------
    DEDUPE_RADIUS_M: int = 30
    DEDUPE_RADIUS_MAX_M: int = 75
    GPS_ACCURACY_WIDEN_M: int = 30
    PHASH_HAMMING_MAX: int = 6
    REOPEN_WINDOW_DAYS: int = 90

    # --- Scoring (SPEC §11) --------------------------------------------------
    # TUNABLE PROPOSALS, not published truth (CLAUDE.md §2.8). Defaults mirror
    # SPEC §11 exactly; the golden test (Impact 73.1, Evidence 0.755) pins them.
    # Impact = 100 x (W_S*S + W_R*R + W_SE*Se + W_P*P)
    SCORE_W_SEVERITY: float = 0.35
    SCORE_W_RECURRENCE: float = 0.25
    SCORE_W_SENSITIVITY: float = 0.30
    SCORE_W_PERSISTENCE: float = 0.10
    # Severity S = 0.6*min(1, n/15) + 0.4*min(1, a/0.25), over the latest 3 reports
    SCORE_SEV_W_COUNT: float = 0.6
    SCORE_SEV_W_AREA: float = 0.4
    SCORE_SEV_COUNT_SAT: float = 15
    SCORE_SEV_AREA_SAT: float = 0.25
    SCORE_SEV_LATEST_N: int = 3
    # Recurrence R = min(1, (D + 2*C) / 8), D over the last 60 days
    SCORE_REC_WINDOW_DAYS: int = 60
    SCORE_REC_RETURN_WEIGHT: float = 2
    SCORE_REC_DIVISOR: float = 8
    # Sensitivity Se = min(1, 0.75*max(drain, water) + 0.25*max(school, hospital, market))
    # prox(d) = 1 if d <= 50 m, 0 if d >= 300 m, linear between
    SCORE_SENS_W_WATER: float = 0.75
    SCORE_SENS_W_AMENITY: float = 0.25
    SCORE_PROX_NEAR_M: float = 50
    SCORE_PROX_FAR_M: float = 300
    # Persistence P = min(1, days_open / 14)
    SCORE_PERSIST_SAT_DAYS: float = 14
    # Evidence Ev = 0.5*mean_conf + 0.3*min(1, unique_reporters/3) + 0.2*reliability
    SCORE_EV_W_CONFIDENCE: float = 0.5
    SCORE_EV_W_REPORTERS: float = 0.3
    SCORE_EV_W_RELIABILITY: float = 0.2
    SCORE_EV_REPORTERS_SAT: float = 3
    # Half-open bands. Impact: >=70 critical, [50,70) high, [30,50) medium, <30 low.
    BAND_IMPACT_CRITICAL: float = 70
    BAND_IMPACT_HIGH: float = 50
    BAND_IMPACT_MEDIUM: float = 30
    # Evidence: <0.4 low, [0.4,0.75) moderate, >=0.75 strong.
    BAND_EVIDENCE_MODERATE: float = 0.4
    BAND_EVIDENCE_STRONG: float = 0.75
    # SPEC §12 step 6: promote ai_detected -> needs_verification (a queue for a
    # human; never verification itself).
    PROMOTE_MIN_REPORTERS: int = 2
    PROMOTE_MIN_EVIDENCE: float = 0.6

    # --- Report pipeline (SPEC §10, §12) -------------------------------------
    # Recompute stored geo-context only when the hotspot centre moved this far.
    GEO_RECOMPUTE_MOVE_M: float = 10.0
    MAX_UPLOAD_MB: float = 15.0

    # --- Before/after closure (SPEC §14) — tunable proposals ------------------
    # Verdict bands on reduction_ratio (worse after-photo). A verdict is only ever a
    # suggestion: an authority confirms or rejects (CLAUDE.md §2.5).
    VERDICT_CLEANED_MIN_REDUCTION: float = 0.8
    VERDICT_CLEANED_MAX_DETECTIONS: int = 1
    VERDICT_PARTIAL_MIN_REDUCTION: float = 0.4
    # ORB viewpoint match vs the before photo. Score = RANSAC inliers / keypoints of
    # the smaller set; BOTH floors must pass. Same-spot retakes of the demo scenes
    # score >= 0.10 with >= 55 inliers, other places <= 0.02 with <= 11 inliers.
    VIEWPOINT_MIN_MATCH: float = 0.05
    VIEWPOINT_MIN_INLIERS: int = 25
    VIEWPOINT_ORB_FEATURES: int = 1500
    VIEWPOINT_MAX_SIDE: int = 800

    # --- Demo seed (SPEC F11) -------------------------------------------------
    # Where seed_demo.py + scenario.json live (mounted at /seed in docker).
    SEED_DIR: str = "../seed"

    # --- Local disk storage (CLAUDE.md §3) ----------------------------------
    UPLOAD_DIR: str = "uploads"

    # --- Frontend origins allowed to call the API (comma-separated) ----------
    # Vite dev (5173) and preview (4173) by default.
    CORS_ORIGINS: str = (
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
    )

    # --- Demo auth (CLAUDE.md §8: seeded demo users + role switcher) --------
    # Signs the demo role token. This is NOT real authentication and guards
    # nothing sensitive — it exists so role violations return 403.
    DEMO_TOKEN_SECRET: str = "plasticwatch-demo-secret-change-me"
    DEMO_TOKEN_TTL_HOURS: int = 24


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton; use as a FastAPI dependency or call directly."""
    return Settings()

"""Demo administration (SPEC F11): wipe and reseed the SIMULATED demo state.

Calls seed/seed_demo.py's reset_and_seed() — the same function `make reset-demo`
runs — so the button in the UI and the command line can never drift apart.
"""

import importlib.util
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.engine import Connection

from app.config import get_settings
from app.db import get_conn
from app.deps import authority_only
from app.schemas import DemoUser, ResetDemoResponse

router = APIRouter(prefix="/admin", tags=["admin"])


@lru_cache
def _seed_module(seed_dir: str):
    path = Path(seed_dir) / "seed_demo.py"
    if not path.is_file():
        raise FileNotFoundError(f"seed_demo.py not found in {seed_dir}")
    spec = importlib.util.spec_from_file_location("seed_demo", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@router.post("/reset-demo", response_model=ResetDemoResponse)
def reset_demo(
    _user: DemoUser = Depends(authority_only), conn: Connection = Depends(get_conn)
) -> ResetDemoResponse:
    """Wipe and reseed the simulated 45-day demo history (takes ~20 s)."""
    try:
        seed = _seed_module(str(Path(get_settings().SEED_DIR).resolve()))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    counts = seed.reset_and_seed(conn)
    return ResetDemoResponse(
        reports=counts["reports"],
        hotspots=counts["hotspots"],
        users=counts["users"],
        message=(
            f"Demo state reseeded in {counts['seconds']} s: {counts['reports']} reports, "
            f"{counts['hotspots']} hotspots. All of it is simulated."
        ),
    )

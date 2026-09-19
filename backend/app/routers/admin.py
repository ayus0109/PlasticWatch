"""Demo administration (SPEC §8, F11).

STAGE 1 STUB: performs NO reseed — the seed script arrives in Stage 10. The response
says so rather than claiming work that did not happen.
"""

from fastapi import APIRouter, Depends

from app.deps import authority_only, load_fixture
from app.schemas import DemoUser, ResetDemoResponse

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/reset-demo", response_model=ResetDemoResponse)
def reset_demo(_user: DemoUser = Depends(authority_only)) -> ResetDemoResponse:
    """Wipe and reseed the simulated demo state."""
    return ResetDemoResponse.model_validate(load_fixture("reset_demo"))

"""Demo auth (SPEC §8). Seeded users + role switcher only — no real auth (CLAUDE.md §8)."""

from fastapi import APIRouter, HTTPException, status

from app.deps import create_demo_token, demo_users, find_demo_user
from app.schemas import DemoLoginRequest, DemoUser, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/demo-users", response_model=list[DemoUser])
def list_demo_users() -> list[DemoUser]:
    """Seeded accounts for the login role picker (SPEC §9). No token required."""
    return demo_users()


@router.post("/demo-login", response_model=TokenResponse)
def demo_login(body: DemoLoginRequest) -> TokenResponse:
    """Pick a seeded user by id, or by role; returns a signed demo token."""
    if body.user_id is None and body.role is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide user_id or role.",
        )
    user = find_demo_user(user_id=body.user_id, role=body.role)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such demo user.")

    token, expires_at = create_demo_token(user)
    return TokenResponse(token=token, user=user, expires_at=expires_at)

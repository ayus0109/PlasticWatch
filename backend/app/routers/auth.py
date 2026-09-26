"""Authentication router.

Supports both one-click demo login (SPEC §8) and full email/password authentication
(registration, login, and current-user profile).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.engine import Connection

from app.auth_utils import (
    DEFAULT_DEMO_PASSWORD,
    DEMO_ACCOUNT_EMAILS,
    DEMO_AUTHORITY_CENTRE_ID,
    DEMO_ROLE_SHORTCUTS,
    RESERVED_DEMO_NAMES,
    normalize_centre_id,
    recognised_centre_ids,
    verify_password,
)
from app.db import get_optional_conn
from app.deps import create_demo_token, demo_users, find_demo_user, get_current_user
from app.schemas import (
    DemoLoginRequest,
    DemoUser,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserRole,
)
from app.services.users import create_user, get_user_by_email_or_name

router = APIRouter(prefix="/auth", tags=["auth"])


def _authorise_portal(body: LoginRequest, user: DemoUser, stored_centre: str | None) -> None:
    """After the password checks out: the account must match the portal chosen, and a
    government account must also give its centre ID. Citizens and officials therefore
    sign in with different credentials."""
    if body.role is not None and user.role != body.role:
        portal = "government" if user.role == UserRole.authority else "citizen"
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This is a {portal} account. Use the {portal.capitalize()} sign-in.",
        )
    if user.role != UserRole.authority:
        return
    given = normalize_centre_id(body.centre_id)
    if not given:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Government sign-in needs your Centre ID.",
        )
    expected = normalize_centre_id(stored_centre)
    # Accounts made before centre IDs existed have none stored: any recognised ID works.
    if given != expected if expected else given not in recognised_centre_ids():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email, password or Centre ID.",
        )


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


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=TokenResponse)
def register(
    body: RegisterRequest, conn: Connection | None = Depends(get_optional_conn)
) -> TokenResponse:
    """Register a new user account with secure password hashing and role support."""
    if conn is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database service is unavailable. Please try again later.",
        )
    name = body.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Name cannot be empty.",
        )

    email = body.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid email address format.",
        )

    if len(body.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 6 characters long.",
        )

    # Check for reserved demo emails and usernames
    if email in DEMO_ACCOUNT_EMAILS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This email is reserved for demo accounts. "
                "Use demo login or pick another email."
            ),
        )

    if name.lower() in RESERVED_DEMO_NAMES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This name is reserved for demo accounts. Please pick another name.",
        )

    # A government account needs a municipal centre / ward ID the city has issued.
    centre_id: str | None = None
    if body.role == UserRole.authority:
        centre_id = normalize_centre_id(body.centre_id)
        if not centre_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Government accounts need a Municipal Centre / Ward ID.",
            )
        if centre_id not in recognised_centre_ids():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "That Centre ID is not recognised. "
                    "Ask your municipal administrator for your centre's ID."
                ),
            )

    # Check if email is already registered in DB
    existing_by_email = get_user_by_email_or_name(conn, email)
    if existing_by_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        )

    # Check if name is already registered in DB
    existing_by_name = get_user_by_email_or_name(conn, name)
    if existing_by_name:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this username or name already exists.",
        )

    new_user = create_user(
        conn=conn,
        name=name,
        email=email,
        password=body.password,
        role=body.role,
        ward_id=body.ward_id,
        centre_id=centre_id,
    )
    token, expires_at = create_demo_token(new_user)
    return TokenResponse(token=token, user=new_user, expires_at=expires_at)


@router.post("/login", response_model=TokenResponse)
def login(
    body: LoginRequest, conn: Connection | None = Depends(get_optional_conn)
) -> TokenResponse:
    """Authenticate with email or username and password."""
    identifier = body.identifier
    password = body.password

    # 1. Look up user in database if available
    if conn is not None:
        db_user = get_user_by_email_or_name(conn, identifier)
        if db_user:
            hashed = db_user.get("hashed_password")
            is_valid = verify_password(password, hashed)
            # Allow default demo password for simulated accounts
            if (
                not is_valid
                and db_user.get("is_simulated")
                and password in (DEFAULT_DEMO_PASSWORD, "password", "demo", "demo123")
            ):
                is_valid = True

            if is_valid:
                user = DemoUser(
                    id=UUID(str(db_user["id"])),
                    name=db_user["name"],
                    email=db_user.get("email"),
                    role=UserRole(db_user["role"]),
                    ward_id=db_user.get("ward_id"),
                    reliability=float(db_user.get("reliability", 0.5)),
                    is_simulated=bool(db_user.get("is_simulated", False)),
                )
                _authorise_portal(body, user, db_user.get("centre_id"))
                token, expires_at = create_demo_token(user)
                return TokenResponse(token=token, user=user, expires_at=expires_at)

    # 2. Check fixture demo accounts as fallback
    matched_demo: DemoUser | None = None
    lower_id = identifier.lower()

    if lower_id in DEMO_ACCOUNT_EMAILS:
        matched_demo = find_demo_user(user_id=DEMO_ACCOUNT_EMAILS[lower_id])
    elif lower_id in DEMO_ROLE_SHORTCUTS:
        matched_demo = find_demo_user(user_id=DEMO_ROLE_SHORTCUTS[lower_id])
    else:
        for u in demo_users():
            if u.name.lower() == lower_id or u.role.value.lower() == lower_id:
                matched_demo = u
                break

    if matched_demo and password in (DEFAULT_DEMO_PASSWORD, "password", "demo", "demo123"):
        _authorise_portal(
            body,
            matched_demo,
            DEMO_AUTHORITY_CENTRE_ID if matched_demo.role == UserRole.authority else None,
        )
        token, expires_at = create_demo_token(matched_demo)
        return TokenResponse(token=token, user=matched_demo, expires_at=expires_at)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect email or password.",
    )


@router.get("/me", response_model=DemoUser)
def get_me(user: DemoUser = Depends(get_current_user)) -> DemoUser:
    """Return the profile of the current authenticated user."""
    return user

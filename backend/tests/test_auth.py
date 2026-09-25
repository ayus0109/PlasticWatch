"""Tests for authentication: demo accounts, password hashing, JWT-like tokens,
login, registration, profile retrieval, and role-based access control.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth_utils import hash_password, verify_password
from app.deps import create_demo_token, decode_demo_token, find_demo_user
from app.main import app
from app.schemas import UserRole

client = TestClient(app)

CITIZEN_ID = "11111111-1111-4111-8111-111111111111"
AUTHORITY_ID = "22222222-2222-4222-8222-222222222222"


# --------------------------------------------------------------------------
# Password Hashing & Verification (Crypto Unit Tests)
# --------------------------------------------------------------------------


def test_password_hashing_and_verification():
    raw = "MySecretPass!456"
    hashed = hash_password(raw)
    assert hashed.startswith("pbkdf2_sha256$100000$")
    assert verify_password(raw, hashed) is True
    assert verify_password("WrongPassword", hashed) is False
    assert verify_password("", hashed) is False
    assert verify_password(raw, "") is False
    assert verify_password(raw, None) is False
    assert verify_password(raw, "malformed$hash") is False


# --------------------------------------------------------------------------
# Token Signing & Decoding
# --------------------------------------------------------------------------


def test_token_creation_and_decoding():
    user = find_demo_user(role=UserRole.citizen)
    assert user is not None
    token, expires_at = create_demo_token(user)
    assert token and "." in token
    assert expires_at is not None

    claims = decode_demo_token(token)
    assert claims["sub"] == str(user.id)
    assert claims["role"] == "citizen"
    assert claims["name"] == user.name


# --------------------------------------------------------------------------
# Demo Endpoints (SPEC §8 & Backward Compatibility)
# --------------------------------------------------------------------------


def test_demo_users_endpoint():
    res = client.get("/auth/demo-users")
    assert res.status_code == 200
    users = res.json()
    assert len(users) == 4
    roles = {u["role"] for u in users}
    assert roles == {"citizen", "authority", "team"}
    assert all(u.get("email") for u in users)
    assert any(u["email"] == "citizen@plasticwatch.local" for u in users)


def test_demo_login_by_role():
    res = client.post("/auth/demo-login", json={"role": "citizen"})
    assert res.status_code == 200
    data = res.json()
    assert "token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["role"] == "citizen"
    assert data["user"]["email"] == "citizen@plasticwatch.local"


def test_demo_login_by_id():
    res = client.post("/auth/demo-login", json={"user_id": CITIZEN_ID})
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["id"] == CITIZEN_ID
    assert data["user"]["name"] == "Demo Citizen A"
    assert data["user"]["email"] == "citizen@plasticwatch.local"


def test_demo_login_missing_params():
    res = client.post("/auth/demo-login", json={})
    assert res.status_code == 422


def test_demo_login_unknown_user():
    res = client.post("/auth/demo-login", json={"user_id": "00000000-0000-0000-0000-000000000000"})
    assert res.status_code == 404


# --------------------------------------------------------------------------
# Login with Password (Fixture & Demo Accounts)
# --------------------------------------------------------------------------


def test_login_with_demo_email():
    res = client.post(
        "/auth/login",
        json={"email": "citizen@plasticwatch.local", "password": "password123"},
    )
    assert res.status_code == 200
    data = res.json()
    assert "token" in data
    assert data["user"]["role"] == "citizen"


def test_login_with_demo_role_shortcut():
    res = client.post(
        "/auth/login",
        json={"email": "authority", "password": "password123"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["role"] == "authority"


def test_login_with_demo_name():
    res = client.post(
        "/auth/login",
        json={"email": "Demo Citizen A", "password": "password123"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["name"] == "Demo Citizen A"


def test_login_wrong_password_fails():
    res = client.post(
        "/auth/login",
        json={"email": "citizen@plasticwatch.local", "password": "incorrect_password"},
    )
    assert res.status_code == 401
    assert "Incorrect email or password" in res.json()["detail"]


def test_login_unknown_user_fails():
    res = client.post(
        "/auth/login",
        json={"email": "nonexistent@example.com", "password": "anypassword"},
    )
    assert res.status_code == 401


# --------------------------------------------------------------------------
# Current User Profile (/auth/me)
# --------------------------------------------------------------------------


def test_me_endpoint_with_valid_token():
    login_res = client.post("/auth/demo-login", json={"role": "citizen"})
    token = login_res.json()["token"]

    res = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    user = res.json()
    assert user["role"] == "citizen"
    assert user["name"] == "Demo Citizen A"


def test_me_endpoint_without_token():
    res = client.get("/auth/me")
    assert res.status_code == 401


def test_me_endpoint_with_tampered_token():
    login_res = client.post("/auth/demo-login", json={"role": "citizen"})
    token = login_res.json()["token"] + "bad"
    res = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


# --------------------------------------------------------------------------
# Real User Registration & DB Flow (Using `api` fixture when DB is present)
# --------------------------------------------------------------------------


def test_register_and_login_full_lifecycle(api):
    # 1. Register a new citizen
    reg_payload = {
        "name": "Jane Doe",
        "email": "jane.doe@example.org",
        "password": "strongPassword123",
        "role": "citizen",
    }
    reg_res = api.post("/auth/register", json=reg_payload)
    assert reg_res.status_code == 201, reg_res.text
    reg_data = reg_res.json()
    assert "token" in reg_data
    assert reg_data["user"]["name"] == "Jane Doe"
    assert reg_data["user"]["email"] == "jane.doe@example.org"
    assert reg_data["user"]["role"] == "citizen"
    assert reg_data["user"]["is_simulated"] is False

    citizen_token = reg_data["token"]

    # 2. Check /auth/me for this registered citizen
    me_res = api.get("/auth/me", headers={"Authorization": f"Bearer {citizen_token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "jane.doe@example.org"

    # 3. Log in with registered credentials
    login_res = api.post(
        "/auth/login",
        json={"email": "jane.doe@example.org", "password": "strongPassword123"},
    )
    assert login_res.status_code == 200
    assert login_res.json()["user"]["email"] == "jane.doe@example.org"

    # 4. Duplicate registration fails with 409
    dup_res = api.post("/auth/register", json=reg_payload)
    assert dup_res.status_code == 409

    # 5. Register an authority user
    auth_reg_res = api.post(
        "/auth/register",
        json={
            "name": "Officer Smith",
            "email": "smith@gov.org",
            "password": "govPassword456",
            "role": "authority",
        },
    )
    assert auth_reg_res.status_code == 201
    auth_token = auth_reg_res.json()["token"]

    # 6. Verify role enforcement:
    # Citizen cannot access authority-only endpoint (/hotspots)
    res_citizen = api.get("/hotspots", headers={"Authorization": f"Bearer {citizen_token}"})
    assert res_citizen.status_code == 403

    # Authority can access authority endpoint (/hotspots)
    res_authority = api.get("/hotspots", headers={"Authorization": f"Bearer {auth_token}"})
    assert res_authority.status_code == 200


def test_register_validations(api):
    # Short password
    res = api.post(
        "/auth/register",
        json={
            "name": "Short Pass",
            "email": "short@test.com",
            "password": "123",
            "role": "citizen",
        },
    )
    assert res.status_code == 422

    # Invalid email
    res = api.post(
        "/auth/register",
        json={
            "name": "Bad Email",
            "email": "not-an-email",
            "password": "validPassword123",
            "role": "citizen",
        },
    )
    assert res.status_code == 422

    # Reserved demo email
    res = api.post(
        "/auth/register",
        json={
            "name": "Demo Impersonator",
            "email": "citizen@plasticwatch.local",
            "password": "validPassword123",
            "role": "citizen",
        },
    )
    assert res.status_code == 409


@pytest.fixture
def mock_db_api():
    """TestClient backed by an in-memory SQLite DB for register/login tests without Postgres."""
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from app.db import get_conn, get_optional_conn

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE wards (id INTEGER PRIMARY KEY, name TEXT);")
        conn.exec_driver_sql(
            """CREATE TABLE users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT,
                hashed_password TEXT,
                role TEXT NOT NULL,
                ward_id INTEGER,
                reliability REAL DEFAULT 0.5,
                is_simulated BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );"""
        )

    def _conn():
        with engine.begin() as conn:
            yield conn

    app.dependency_overrides[get_conn] = _conn
    app.dependency_overrides[get_optional_conn] = _conn
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_conn, None)
        app.dependency_overrides.pop(get_optional_conn, None)
        engine.dispose()


def test_register_and_login_with_mock_db(mock_db_api):
    # 1. Register a new citizen
    citizen_payload = {
        "name": "Jane Doe",
        "email": "jane.doe@example.org",
        "password": "strongPassword123",
        "role": "citizen",
    }
    reg_res = mock_db_api.post("/auth/register", json=citizen_payload)
    assert reg_res.status_code == 201, reg_res.text
    reg_data = reg_res.json()
    assert "token" in reg_data
    assert reg_data["user"]["name"] == "Jane Doe"
    assert reg_data["user"]["email"] == "jane.doe@example.org"
    assert reg_data["user"]["role"] == "citizen"
    assert reg_data["user"]["is_simulated"] is False

    citizen_token = reg_data["token"]

    # 2. Check /auth/me for this registered citizen
    me_res = mock_db_api.get("/auth/me", headers={"Authorization": f"Bearer {citizen_token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "jane.doe@example.org"
    assert me_res.json()["role"] == "citizen"

    # 3. Log in with registered email
    login_res = mock_db_api.post(
        "/auth/login",
        json={"email": "jane.doe@example.org", "password": "strongPassword123"},
    )
    assert login_res.status_code == 200
    assert login_res.json()["user"]["email"] == "jane.doe@example.org"

    # 4. Log in with username (name)
    login_name_res = mock_db_api.post(
        "/auth/login",
        json={"email": "Jane Doe", "password": "strongPassword123"},
    )
    assert login_name_res.status_code == 200
    assert login_name_res.json()["user"]["name"] == "Jane Doe"

    # 5. Log in with explicit "username" JSON field
    login_userfield_res = mock_db_api.post(
        "/auth/login",
        json={"username": "Jane Doe", "password": "strongPassword123"},
    )
    assert login_userfield_res.status_code == 200
    assert login_userfield_res.json()["user"]["email"] == "jane.doe@example.org"

    # 6. Case-insensitive login
    login_case_res = mock_db_api.post(
        "/auth/login",
        json={"email": "JANE.DOE@EXAMPLE.ORG", "password": "strongPassword123"},
    )
    assert login_case_res.status_code == 200

    # 7. Register an authority user
    auth_payload = {
        "name": "Inspector Clouseau",
        "email": "inspector@gov.org",
        "password": "authoritySecret123",
        "role": "authority",
    }
    auth_reg_res = mock_db_api.post("/auth/register", json=auth_payload)
    assert auth_reg_res.status_code == 201, auth_reg_res.text
    auth_token = auth_reg_res.json()["token"]
    assert auth_reg_res.json()["user"]["role"] == "authority"

    # 8. Check /auth/me for authority
    auth_me = mock_db_api.get("/auth/me", headers={"Authorization": f"Bearer {auth_token}"})
    assert auth_me.status_code == 200
    assert auth_me.json()["role"] == "authority"

    # 9. Verify role enforcement:
    # Citizen cannot access authority endpoint (/hotspots) -> 403 Forbidden
    res_citizen = mock_db_api.get("/hotspots", headers={"Authorization": f"Bearer {citizen_token}"})
    assert res_citizen.status_code == 403

    # 10. Conflict validations:
    # Duplicate email fails with 409
    dup_email_res = mock_db_api.post(
        "/auth/register",
        json={
            "name": "Different Name",
            "email": "jane.doe@example.org",
            "password": "pass123456",
            "role": "citizen",
        },
    )
    assert dup_email_res.status_code == 409
    assert "email already exists" in dup_email_res.json()["detail"].lower()

    # Duplicate name fails with 409
    dup_name_res = mock_db_api.post(
        "/auth/register",
        json={
            "name": "Jane Doe",
            "email": "different@example.org",
            "password": "pass123456",
            "role": "citizen",
        },
    )
    assert dup_name_res.status_code == 409
    assert "already exists" in dup_name_res.json()["detail"].lower()

    # Reserved demo email fails with 409
    res_demo_email = mock_db_api.post(
        "/auth/register",
        json={
            "name": "Unique Name",
            "email": "citizen@plasticwatch.local",
            "password": "pass123456",
            "role": "citizen",
        },
    )
    assert res_demo_email.status_code == 409

    # Reserved demo name fails with 409
    res_demo_name = mock_db_api.post(
        "/auth/register",
        json={
            "name": "Demo Citizen A",
            "email": "unique@example.org",
            "password": "pass123456",
            "role": "citizen",
        },
    )
    assert res_demo_name.status_code == 409

    # 11. Format validations:
    # Short password fails with 422
    short_res = mock_db_api.post(
        "/auth/register",
        json={"name": "Alice", "email": "alice@x.com", "password": "123", "role": "citizen"},
    )
    assert short_res.status_code == 422

    # Invalid email fails with 422
    bad_email_res = mock_db_api.post(
        "/auth/register",
        json={"name": "Alice", "email": "not-an-email", "password": "validPassword123", "role": "citizen"},
    )
    assert bad_email_res.status_code == 422

    # Empty name fails with 422
    empty_name_res = mock_db_api.post(
        "/auth/register",
        json={"name": "   ", "email": "alice@x.com", "password": "validPassword123", "role": "citizen"},
    )
    assert empty_name_res.status_code == 422

    # 12. Incorrect credentials:
    # Invalid password fails with 401
    bad_login = mock_db_api.post(
        "/auth/login",
        json={"email": "jane.doe@example.org", "password": "wrongPassword"},
    )
    assert bad_login.status_code == 401

    # Unknown user fails with 401
    unknown_login = mock_db_api.post(
        "/auth/login",
        json={"email": "nonexistent@example.com", "password": "anyPassword"},
    )
    assert unknown_login.status_code == 401


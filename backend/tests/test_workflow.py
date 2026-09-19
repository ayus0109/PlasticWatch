"""Stage 7: the SPEC §13 status machine, the human gate and the audit log."""

from __future__ import annotations

import itertools
import uuid

import pytest
from sqlalchemy import text

from app.schemas import DemoUser, HotspotStatus, UserRole
from app.services.workflow import (
    ALLOWED_TRANSITIONS,
    HUMAN_ONLY,
    WorkflowError,
    transition,
)
from tests.conftest import auth_header

S = HotspotStatus
AUTHORITY_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
TEAM_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")


def make_actor(conn, role: UserRole) -> DemoUser:
    uid = uuid.uuid4()
    conn.execute(
        text("INSERT INTO users (id, name, role) VALUES (:id, :n, :r)"),
        {"id": uid, "n": f"test {role.value}", "r": role.value},
    )
    return DemoUser(id=uid, name=f"test {role.value}", role=role)


def make_hotspot(conn, status: HotspotStatus) -> int:
    hid = conn.execute(
        text(
            "INSERT INTO hotspots (geom, status) VALUES "
            "(ST_SetSRID(ST_MakePoint(73.85, 18.52), 4326), :s) RETURNING id"
        ),
        {"s": status.value},
    ).scalar_one()
    conn.execute(
        text("INSERT INTO hotspot_events (hotspot_id, to_status) VALUES (:h, :s)"),
        {"h": hid, "s": status.value},
    )
    return hid


def events(conn, hid):
    return conn.execute(
        text("SELECT from_status, to_status, actor_id, reason FROM hotspot_events"
             " WHERE hotspot_id = :h ORDER BY id"),
        {"h": hid},
    ).all()


def status_of(conn, hid) -> str:
    return conn.execute(text("SELECT status FROM hotspots WHERE id = :h"), {"h": hid}).scalar()


# ---------------------------------------------------------------------------
# The machine itself (service level, exhaustive)
# ---------------------------------------------------------------------------

ALL_PAIRS = [(a, b) for a, b in itertools.product(S, S) if a != b]
ILLEGAL = [p for p in ALL_PAIRS if p not in ALLOWED_TRANSITIONS]


@pytest.mark.parametrize(("frm", "to"), ILLEGAL, ids=[f"{a}->{b}" for a, b in ILLEGAL])
def test_every_illegal_transition_is_409(conn, frm, to):
    authority = make_actor(conn, UserRole.authority)
    hid = make_hotspot(conn, frm)
    before = len(events(conn, hid))
    with pytest.raises(WorkflowError) as err:
        transition(conn, hid, to, actor=authority)
    assert err.value.status_code == 409
    assert status_of(conn, hid) == frm.value
    assert len(events(conn, hid)) == before, "a rejected transition must not write an event"


def _actor_for(conn, who: str):
    return None if who == "system" else make_actor(conn, UserRole(who))


ALLOWED_CASES = [(a, b, who) for (a, b), whos in ALLOWED_TRANSITIONS.items() for who in whos]


@pytest.mark.parametrize(
    ("frm", "to", "who"), ALLOWED_CASES, ids=[f"{a}->{b} by {w}" for a, b, w in ALLOWED_CASES]
)
def test_every_allowed_edge_works_for_its_actor_and_writes_one_event(conn, frm, to, who):
    actor = _actor_for(conn, who)
    hid = make_hotspot(conn, frm)
    before = len(events(conn, hid))
    event = transition(conn, hid, to, actor=actor, note="test")
    assert status_of(conn, hid) == to.value
    rows = events(conn, hid)
    assert len(rows) == before + 1
    assert (rows[-1].from_status, rows[-1].to_status) == (frm.value, to.value)
    assert rows[-1].actor_id == (actor.id if actor else None)
    assert event.to_status == to


WRONG_ACTOR = [
    (a, b, who)
    for (a, b), whos in ALLOWED_TRANSITIONS.items()
    for who in ("system", "citizen", "team", "authority")
    if who not in whos
]


@pytest.mark.parametrize(
    ("frm", "to", "who"), WRONG_ACTOR, ids=[f"{a}->{b} by {w}" for a, b, w in WRONG_ACTOR]
)
def test_wrong_actor_on_a_legal_edge_is_403(conn, frm, to, who):
    actor = _actor_for(conn, who)
    hid = make_hotspot(conn, frm)
    with pytest.raises(WorkflowError) as err:
        transition(conn, hid, to, actor=actor)
    assert err.value.status_code == 403
    assert status_of(conn, hid) == frm.value


def test_human_only_states_have_no_non_authority_edge():
    """CLAUDE.md §2.5 — the table itself never lets anyone but an authority in."""
    for (_, to), whos in ALLOWED_TRANSITIONS.items():
        if to in HUMAN_ONLY:
            assert whos == {"authority"}, to


def test_resolved_is_reachable_only_from_cleanup_completed():
    """Resolution happens only through the §14 before/after confirmation."""
    sources = {a for (a, b) in ALLOWED_TRANSITIONS if b == S.resolved}
    assert sources == {S.cleanup_completed}


def test_unknown_hotspot_is_404(conn):
    authority = make_actor(conn, UserRole.authority)
    with pytest.raises(WorkflowError) as err:
        transition(conn, 999_999, S.verified, actor=authority)
    assert err.value.status_code == 404


# ---------------------------------------------------------------------------
# The API (POST /hotspots/{id}/verify)
# ---------------------------------------------------------------------------


@pytest.fixture
def hotspot(db_engine, api):
    """An ai_detected hotspot in the API's database."""
    with db_engine.begin() as c:
        return make_hotspot(c, S.ai_detected)


def verify(api, hid, role="authority", **body):
    return api.post(f"/hotspots/{hid}/verify", json=body, headers=auth_header(api, role))


def test_citizen_verify_is_403(api, hotspot, db_engine):
    assert verify(api, hotspot, role="citizen", decision="verify").status_code == 403
    with db_engine.connect() as c:
        assert status_of(c, hotspot) == "ai_detected"


def test_authority_verify_writes_exactly_one_event_and_forces_evidence(api, hotspot, db_engine):
    with db_engine.connect() as c:
        before = len(events(c, hotspot))
    res = verify(api, hotspot, decision="verify", note="Pile visible beside the drain.")
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["from_status"], body["to_status"]) == ("ai_detected", "verified")
    assert body["event"]["actor_id"] == str(AUTHORITY_ID)
    assert body["event"]["actor_name"] == "Demo Ward Authority"

    detail = api.get(f"/hotspots/{hotspot}", headers=auth_header(api, "authority")).json()
    assert detail["status"] == "verified"
    assert len(detail["events"]) == before + 1
    assert detail["events"][-1]["note"] == "Pile visible beside the drain."
    sb = detail["score_breakdown"]
    assert sb["evidence_score"] == 1.0 and sb["evidence_label"] == "human-verified"


def test_verifying_twice_is_409(api, hotspot):
    assert verify(api, hotspot, decision="verify").status_code == 200
    again = verify(api, hotspot, decision="verify")
    assert again.status_code == 409
    assert "cannot move from verified to verified" in again.json()["detail"]


def test_false_positive_from_verified_is_allowed(api, hotspot):
    verify(api, hotspot, decision="verify")
    res = verify(api, hotspot, decision="false_positive", reason="not_plastic")
    assert res.status_code == 200 and res.json()["to_status"] == "false_positive"
    assert res.json()["event"]["reason"] == "not_plastic"


def test_reject_needs_a_reason_and_lands_in_false_positive(api, hotspot):
    assert verify(api, hotspot, decision="reject").status_code == 422
    res = verify(api, hotspot, decision="reject", reason="no_waste_visible", note="Clean street.")
    assert res.status_code == 200
    assert res.json()["to_status"] == "false_positive"


def test_reason_on_a_verify_is_422(api, hotspot):
    assert verify(api, hotspot, decision="verify", reason="not_plastic").status_code == 422


def test_unknown_reason_is_422(api, hotspot):
    assert verify(api, hotspot, decision="reject", reason="blame_someone").status_code == 422


def test_unknown_hotspot_via_api_is_404(api):
    assert verify(api, 424242, decision="verify").status_code == 404


def test_false_positive_is_terminal(api, hotspot):
    verify(api, hotspot, decision="false_positive", reason="not_plastic")
    assert verify(api, hotspot, decision="verify").status_code == 409


def test_no_decision_can_resolve_a_hotspot(api, hotspot):
    """verify/reject/false_positive never produce resolved (only §14 can)."""
    from app.routers.hotspots import _DECISION_TO_STATUS

    assert S.resolved not in _DECISION_TO_STATUS.values()

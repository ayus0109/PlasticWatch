"""Stage 1 contract tests: the frozen API surface, fixtures and the role gate.

Runs WITHOUT a database: only checks that fail before a DB connection is opened
(OpenAPI shape, fixtures, 401/403 from the auth dependencies). DB-backed behaviour
lives in test_reports_e2e.py and test_workflow.py.
"""

import re

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel, TypeAdapter

from app import schemas
from app.deps import load_fixture
from app.main import app

client = TestClient(app)

CITIZEN = "11111111-1111-4111-8111-111111111111"
AUTHORITY = "22222222-2222-4222-8222-222222222222"
TEAM = "33333333-3333-4333-8333-333333333333"


def token_for(user_id: str) -> dict[str, str]:
    res = client.post("/auth/demo-login", json={"user_id": user_id})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


# --------------------------------------------------------------------------
# OpenAPI surface
# --------------------------------------------------------------------------


def test_openapi_has_at_least_16_paths():
    paths = client.get("/openapi.json").json()["paths"]
    assert len(paths) >= 16, sorted(paths)


def test_every_spec_path_is_present():
    """Every SPEC §8 endpoint, method and path."""
    paths = client.get("/openapi.json").json()["paths"]
    expected = {
        ("post", "/auth/demo-login"),
        ("post", "/detect"),
        ("post", "/reports"),
        ("get", "/reports/mine"),
        ("get", "/reports/{report_id}"),
        ("get", "/hotspots"),
        ("get", "/hotspots/{hotspot_id}"),
        ("post", "/hotspots/{hotspot_id}/verify"),
        ("get", "/geo/layers"),
        ("get", "/wards"),
        ("post", "/tasks"),
        ("get", "/tasks"),
        ("get", "/tasks/{task_id}"),
        ("post", "/tasks/{task_id}/stops/{stop_id}/arrive"),
        ("post", "/tasks/{task_id}/stops/{stop_id}/after"),
        ("post", "/before-after/{ba_id}/review"),
        ("get", "/analytics/summary"),
        ("get", "/analytics/trend"),
        ("get", "/analytics/wards"),
        ("post", "/admin/reset-demo"),
    }
    present = {(m, p) for p, ops in paths.items() for m in ops}
    assert expected <= present, sorted(expected - present)


def test_every_route_declares_a_response_schema():
    paths = client.get("/openapi.json").json()["paths"]
    for path, ops in paths.items():
        for method, op in ops.items():
            ok = next(
                (op["responses"][c] for c in ("200", "201") if c in op["responses"]), None
            )
            assert ok is not None, f"{method.upper()} {path} has no success response"
            assert "content" in ok, f"{method.upper()} {path} has no response schema"


# --------------------------------------------------------------------------
# Fixtures match the frozen schemas
# --------------------------------------------------------------------------

FIXTURE_MODELS: dict[str, type[BaseModel] | TypeAdapter] = {
    "demo_users": TypeAdapter(list[schemas.DemoUser]),
    "detector_output": schemas.DetectorOutput,
    "report_result": schemas.ReportCreateResponse,
    "reports_mine": TypeAdapter(list[schemas.ReportSummary]),
    "report_detail": schemas.ReportDetail,
    "hotspots": schemas.HotspotFeatureCollection,
    "hotspot_detail": schemas.HotspotDetail,
    "geo_layers": schemas.GeoFeatureCollection,
    "wards": schemas.WardFeatureCollection,
    "tasks": TypeAdapter(list[schemas.TaskSummary]),
    "task_detail": schemas.TaskDetail,
    "before_after": schemas.BeforeAfterRecord,
    "analytics_summary": schemas.AnalyticsSummary,
    "analytics_trend": schemas.AnalyticsTrend,
    "analytics_wards": schemas.AnalyticsWards,
    "reset_demo": schemas.ResetDemoResponse,
}


@pytest.mark.parametrize("name", sorted(FIXTURE_MODELS))
def test_fixture_validates_against_its_model(name):
    model = FIXTURE_MODELS[name]
    data = load_fixture(name)
    if isinstance(model, TypeAdapter):
        model.validate_python(data)
    else:
        model.model_validate(data)


FROZEN_DETECTOR_KEYS = {
    "plastic_count",
    "plastic_area_frac",
    "report_confidence",
    "detections",
    "annotated_jpg_path",
    "ai_status",
}
FROZEN_DETECTION_KEYS = {"class_name", "confidence", "x1", "y1", "x2", "y2", "area_frac"}


def test_detector_model_matches_frozen_contract_keys():
    """SPEC §6 — the detector's own shape, before the API adds a tier."""
    assert set(schemas.DetectorOutput.model_fields) == FROZEN_DETECTOR_KEYS
    assert set(schemas.Detection.model_fields) == FROZEN_DETECTION_KEYS


def test_detector_fixture_has_exactly_the_frozen_keys():
    """Pydantic ignores extra keys, so validation alone would not catch drift."""
    data = load_fixture("detector_output")
    assert set(data) == FROZEN_DETECTOR_KEYS
    for det in data["detections"]:
        assert set(det) == FROZEN_DETECTION_KEYS


def test_detector_contract_is_published_in_openapi():
    """The frozen §6 contract must be findable in /docs as its own schema."""
    spec = client.get("/openapi.json").json()
    components = spec["components"]["schemas"]
    assert "DetectorOutput" in components
    assert set(components["DetectorOutput"]["properties"]) == FROZEN_DETECTOR_KEYS
    result = components["DetectPreview"]["properties"]["result"]
    assert result["$ref"].endswith("/DetectorOutput")


def test_golden_hotspot_fixture_matches_spec_11():
    """hotspot_detail carries the SPEC §11 golden numbers (73.1 / 0.755)."""
    sb = load_fixture("hotspot_detail")["score_breakdown"]
    assert sb["impact_score"] == 73.1 and sb["priority_band"] == "critical"
    assert sb["evidence_score"] == 0.755 and sb["evidence_band"] == "strong"


# --------------------------------------------------------------------------
# Role gate — 403 on mismatch (CLAUDE.md §5)
# --------------------------------------------------------------------------

VERIFY_BODY = {"decision": "verify", "note": "Pile visible beside the drain."}


def test_verify_as_citizen_is_403():
    res = client.post("/hotspots/3/verify", json=VERIFY_BODY, headers=token_for(CITIZEN))
    assert res.status_code == 403


def test_verify_as_citizen_is_403_even_with_bad_id_and_no_body():
    """The role gate fires before path/body validation: the literal acceptance curl."""
    res = client.post("/hotspots/x/verify", headers=token_for(CITIZEN))
    assert res.status_code == 403


def test_verify_as_team_is_403():
    res = client.post("/hotspots/3/verify", json=VERIFY_BODY, headers=token_for(TEAM))
    assert res.status_code == 403


def test_no_token_is_401():
    assert client.get("/hotspots").status_code == 401


def test_tampered_token_is_401():
    headers = token_for(AUTHORITY)
    headers["Authorization"] = headers["Authorization"][:-2] + "xx"
    assert client.get("/hotspots", headers=headers).status_code == 401


def test_citizen_cannot_read_authority_map():
    assert client.get("/hotspots", headers=token_for(CITIZEN)).status_code == 403


def test_before_after_review_is_authority_only():
    body = {"decision": "confirm_resolved"}
    as_team = client.post("/before-after/9/review", json=body, headers=token_for(TEAM))
    assert as_team.status_code == 403
    res = client.post("/before-after/9/review", json=body, headers=token_for(AUTHORITY))
    assert res.status_code == 200
    assert res.json()["hotspot_status"] == "resolved"


# --------------------------------------------------------------------------
# Honesty guards (CLAUDE.md §2)
# --------------------------------------------------------------------------

ATTRIBUTION = re.compile(
    r"responsib|blame|culprit|offender|perpetrat|violator|polluter|dumper|litterer|owner",
    re.IGNORECASE,
)
# The one place the word is required: the note that says reports DON'T establish it.
ALLOWED_FIELDS = {"non_attribution_note"}


def _property_names(node, found=None):
    found = set() if found is None else found
    if isinstance(node, dict):
        for key, val in node.items():
            if key == "properties" and isinstance(val, dict):
                found.update(val)
            _property_names(val, found)
    elif isinstance(node, list):
        for item in node:
            _property_names(item, found)
    return found


def test_no_attribution_field_anywhere_in_api():
    """CLAUDE.md §2.3 — no field names who is responsible for waste."""
    names = _property_names(client.get("/openapi.json").json()) - ALLOWED_FIELDS
    offending = sorted(n for n in names if ATTRIBUTION.search(n))
    assert not offending, offending


def test_detection_classes_exclude_people_and_vehicles():
    """CLAUDE.md §2.4 — litter classes only."""
    banned = re.compile(r"person|people|face|vehicle|car|plate|licen", re.IGNORECASE)
    assert not [c.value for c in schemas.DetectionClass if banned.search(c.value)]


def test_simulated_fixtures_are_flagged():
    """CLAUDE.md §2.2 — every fabricated hotspot is marked."""
    for f in load_fixture("hotspots")["features"]:
        assert f["properties"]["is_simulated"] is True
    assert load_fixture("hotspot_detail")["is_simulated"] is True


def test_stub_detection_is_flagged_simulated_with_a_tier():
    """The stub detector's output is fabricated, so the API must say so (§2.2),
    and its confidence must travel with a tier (§2.7).
    """
    files = {"image": ("x.jpg", b"not-a-real-image", "image/jpeg")}
    res = client.post("/detect", files=files, headers=token_for(CITIZEN))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["is_simulated"] is True
    assert body["confidence_tier"] in {"low", "medium", "high"}
    assert set(body["result"]) == FROZEN_DETECTOR_KEYS


def test_every_confidence_travels_with_a_tier():
    """CLAUDE.md §2.7 — a raw confidence is never shown alone."""
    for r in load_fixture("reports_mine"):
        if r["report_confidence"] is not None:
            assert r["confidence_tier"] in {"low", "medium", "high"}


def test_before_after_is_not_auto_resolved():
    """CLAUDE.md §2.5 — a verdict exists, but no human has reviewed it yet."""
    ba = load_fixture("before_after")
    assert ba["verdict"] == "likely_cleaned"
    assert ba["review_decision"] is None and ba["reviewed_by"] is None

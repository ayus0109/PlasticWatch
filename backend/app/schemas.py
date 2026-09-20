"""FROZEN CONTRACT — do not change without a stage saying so (CLAUDE.md §5).

Pydantic models for every endpoint in SPEC §8, plus the frozen detector output of
SPEC §6. The frontend builds against these shapes from Day 1, so a field rename here
breaks work already in progress.

Honesty rules encoded in this file (CLAUDE.md §2):
  * "likely plastic" everywhere — never a bare claim of "plastic" (§2.1).
  * is_simulated travels with any fabricated demo data (§2.2).
  * NO field anywhere names or implies a responsible party (§2.3).
  * Every raw confidence is paired with a Low/Medium/High tier (§2.7).
  * score_breakdown documents weights as tunable proposals, not truth (§2.8).
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

# Shown wherever reports are presented to an authority (CLAUDE.md §2.3).
NON_ATTRIBUTION_NOTE = (
    "Reports show waste appears to be present; they do not establish who is responsible."
)


# --------------------------------------------------------------------------
# Enums — frozen value sets
# --------------------------------------------------------------------------


class UserRole(StrEnum):
    """SPEC §7 users.role."""

    citizen = "citizen"
    authority = "authority"
    team = "team"


class HotspotStatus(StrEnum):
    """SPEC §13. Only an authority reaches verified / false_positive / resolved."""

    ai_detected = "ai_detected"
    needs_verification = "needs_verification"
    verified = "verified"
    cleanup_scheduled = "cleanup_scheduled"
    cleanup_completed = "cleanup_completed"
    resolved = "resolved"
    false_positive = "false_positive"


class VerifyDecision(StrEnum):
    """SPEC §8 POST /hotspots/{id}/verify."""

    verify = "verify"
    reject = "reject"
    false_positive = "false_positive"


class RejectReason(StrEnum):
    """SPEC §13."""

    not_plastic = "not_plastic"
    no_waste_visible = "no_waste_visible"
    wrong_location = "wrong_location"
    duplicate = "duplicate"
    already_cleaned = "already_cleaned"
    other = "other"


class ReviewDecision(StrEnum):
    """SPEC §8 POST /before-after/{id}/review. Only confirm_resolved closes a hotspot."""

    confirm_resolved = "confirm_resolved"
    reject = "reject"


class PriorityBand(StrEnum):
    """SPEC §11 Impact bands (half-open): >=70 critical, [50,70) high, [30,50) medium, <30 low."""

    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class EvidenceBand(StrEnum):
    """SPEC §11 Evidence bands (half-open): <0.4 low, [0.4,0.75) moderate, >=0.75 strong."""

    low = "low"
    moderate = "moderate"
    strong = "strong"


class LocationSource(StrEnum):
    """SPEC §7 reports.location_source. Capture order: browser GPS -> EXIF -> map pin."""

    browser = "browser"
    exif = "exif"
    pin = "pin"


class AiStatus(StrEnum):
    """SPEC §6 detector contract."""

    detected = "detected"
    not_detected = "not_detected"
    error = "error"


class DetectionClass(StrEnum):
    """SPEC §6 — 5 classes collapsed from TACO's 60.

    The four plastic_* classes are "plastic-likely". No person, vehicle or
    licence-plate class may ever be added here (CLAUDE.md §2.4).
    """

    plastic_bottle = "plastic_bottle"
    plastic_bag_film = "plastic_bag_film"
    plastic_packaging = "plastic_packaging"
    plastic_other = "plastic_other"
    non_plastic_litter = "non_plastic_litter"


class ConfidenceTier(StrEnum):
    """Raw model confidence is not a calibrated probability (CLAUDE.md §2.7).

    A tier is shown beside every number so a score is never read as a promise.
    """

    low = "low"
    medium = "medium"
    high = "high"


class GeoFeatureKind(StrEnum):
    """SPEC §7 geo_features.kind."""

    drain = "drain"
    water = "water"
    school = "school"
    hospital = "hospital"
    market = "market"


class TaskStatus(StrEnum):
    """SPEC §7 cleanup_tasks.status."""

    planned = "planned"
    in_progress = "in_progress"
    done = "done"


class Verdict(StrEnum):
    """SPEC §14. A verdict is a suggestion — it never resolves anything by itself."""

    likely_cleaned = "likely_cleaned"
    partial = "partial"
    not_cleaned = "not_cleaned"
    inconclusive = "inconclusive"


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------


class DemoUser(BaseModel):
    """A seeded demo account. There is no real auth in this system (CLAUDE.md §8)."""

    id: UUID
    name: str
    role: UserRole
    ward_id: int | None = None
    reliability: float = Field(
        0.5, description="Static 0.5 — learned reporter reliability is out of scope."
    )
    is_simulated: bool = True


class DemoLoginRequest(BaseModel):
    """Pick a seeded user by id, or by role to take the first account with it."""

    user_id: UUID | None = None
    role: UserRole | None = None


class TokenResponse(BaseModel):
    token: str
    token_type: Literal["bearer"] = "bearer"
    user: DemoUser
    expires_at: datetime


# --------------------------------------------------------------------------
# Detector — FROZEN CONTRACT (SPEC §6)
# --------------------------------------------------------------------------


class Detection(BaseModel):
    """One detected litter item. Box coordinates are pixels in the source image."""

    class_name: DetectionClass
    confidence: float = Field(..., ge=0, le=1, description="Raw model confidence, not calibrated.")
    x1: float
    y1: float
    x2: float
    y2: float
    area_frac: float = Field(..., ge=0, le=1, description="Box area / image area.")


class DetectorOutput(BaseModel):
    """FROZEN CONTRACT (SPEC §6) — detector.py returns exactly this shape in both
    stub and real mode. Do not add, rename or reorder fields without a stage.
    """

    plastic_count: int = Field(..., ge=0, description="Count of likely-plastic items.")
    plastic_area_frac: float = Field(
        ..., ge=0, le=1, description="Sum of likely-plastic box areas / image area, capped at 1.0."
    )
    report_confidence: float = Field(
        ..., ge=0, le=1, description="Mean of the top-3 plastic-likely confidences."
    )
    detections: list[Detection]
    annotated_jpg_path: str | None = Field(
        ..., description="Always present; null when no annotated image was written."
    )
    ai_status: AiStatus


class DetectPreview(BaseModel):
    """POST /detect — the frozen DetectorOutput, wrapped with the tier the UI must show.

    Composition, not inheritance: `result` is exactly what detector.py returns, so
    the §6 contract appears verbatim (as its own schema) in /docs, and the tier is
    added at the API layer without touching it (CLAUDE.md §2.7).
    """

    result: DetectorOutput
    confidence_tier: ConfidenceTier = Field(
        ..., description="Shown beside result.report_confidence; raw confidence is not calibrated."
    )
    is_simulated: bool = Field(
        False, description="True while the detector runs in stub mode (fabricated output)."
    )


# --------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------


class ReportSummary(BaseModel):
    """A citizen's own report and the status of the hotspot it belongs to."""

    id: UUID
    created_at: datetime
    captured_at: datetime | None = None
    image_path: str
    annotated_jpg_path: str | None = None
    note: str | None = None
    lat: float
    lon: float
    location_source: LocationSource
    gps_accuracy_m: float | None = None
    low_accuracy: bool = Field(
        False, description="GPS accuracy was poor enough to widen the merge radius."
    )
    ai_status: AiStatus
    plastic_count: int | None = None
    plastic_area_frac: float | None = None
    report_confidence: float | None = None
    confidence_tier: ConfidenceTier | None = None
    hotspot_id: int | None = None
    hotspot_status: HotspotStatus | None = Field(
        None, description="Pending / work in progress / completed, as shown to the citizen."
    )
    is_duplicate: bool = Field(
        False, description="Matched an existing image; attached as evidence but not counted twice."
    )
    is_simulated: bool = False


class ReportDetail(ReportSummary):
    detections: list[Detection] = []


class HotspotSummary(BaseModel):
    """The hotspot a report landed on, as returned to the citizen who reported it."""

    id: int
    status: HotspotStatus
    lat: float
    lon: float
    radius_m: float | None = None
    report_count: int
    unique_reporters: int
    impact_score: float | None = None
    priority_band: PriorityBand | None = None
    evidence_score: float | None = None
    evidence_band: EvidenceBand | None = None
    is_simulated: bool = False


class ReportCreateResponse(BaseModel):
    """Result of POST /reports: detect -> dedupe -> context -> score (SPEC §8)."""

    report: ReportDetail
    detections: list[Detection]
    hotspot: HotspotSummary | None = None
    merged: bool = Field(
        ..., description="True when the report joined an existing hotspot rather than creating one."
    )
    duplicate_of: UUID | None = None
    low_accuracy: bool = Field(
        False, description="Location accuracy was low; the merge radius was widened."
    )
    message: str = Field(
        ...,
        description="Plain-language outcome for the citizen, e.g. no likely plastic found.",
    )


# --------------------------------------------------------------------------
# Hotspots — GeoJSON (see FROZEN CONTRACT comment in routers/hotspots.py)
# --------------------------------------------------------------------------


class PointGeometry(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: list[float] = Field(..., description="[lon, lat] — GeoJSON order.")


class HotspotProperties(BaseModel):
    """FROZEN — the property set every map marker styles itself from."""

    id: int
    status: HotspotStatus
    impact_score: float | None = None
    priority_band: PriorityBand | None = None
    evidence_score: float | None = None
    evidence_band: EvidenceBand | None = None
    report_count: int
    unique_reporters: int
    recurrence_returns: int
    radius_m: float | None = None
    ward_id: int | None = None
    ward_name: str | None = None
    first_reported_at: datetime | None = None
    last_reported_at: datetime | None = None
    is_simulated: bool = Field(
        False, description="True when any member report has a fabricated geotag (CLAUDE.md §2.2)."
    )


class HotspotFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: int
    geometry: PointGeometry
    properties: HotspotProperties


class HotspotFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[HotspotFeature]


class ScoreFactor(BaseModel):
    """One row of the explanation card (SPEC §11).

    Weights are tunable proposals documented here, not published truth (CLAUDE.md §2.8).
    """

    axis: Literal["impact", "evidence"] = Field(
        ..., description="Impact ranks the hotspot; Evidence governs what may be claimed."
    )
    factor: str
    value: float = Field(..., description="Normalised 0-1.")
    weight: float
    contribution: float = Field(
        ..., description="Impact axis: points out of 100. Evidence axis: share of 0-1."
    )
    explanation: str | None = None


class ScoreBreakdown(BaseModel):
    factors: list[ScoreFactor]
    impact_score: float
    priority_band: PriorityBand
    evidence_score: float
    evidence_band: EvidenceBand
    evidence_label: str | None = Field(
        None, description='e.g. "human-verified" once an authority has confirmed.'
    )
    weights_note: str = Field(
        "Weights are tunable proposals, not published truth.",
        description="CLAUDE.md §2.8.",
    )
    scored_at: datetime | None = None


class HotspotEvent(BaseModel):
    """Audit log row. actor_id is the human who acted, null for system transitions."""

    id: int
    from_status: HotspotStatus | None = None
    to_status: HotspotStatus
    reason: RejectReason | None = None
    note: str | None = None
    actor_id: UUID | None = None
    actor_name: str | None = None
    created_at: datetime


class GeoContext(BaseModel):
    """Distances stored on the hotspot row at create/update (SPEC §10)."""

    d_drain_m: float | None = None
    d_water_m: float | None = None
    d_school_m: float | None = None
    d_hospital_m: float | None = None
    d_market_m: float | None = None


class HotspotDetail(BaseModel):
    """GET /hotspots/{id} — score breakdown, reports, events (the evidence ledger)."""

    id: int
    status: HotspotStatus
    lat: float
    lon: float
    radius_m: float | None = None
    ward_id: int | None = None
    ward_name: str | None = None
    first_reported_at: datetime | None = None
    last_reported_at: datetime | None = None
    report_count: int
    unique_reporters: int
    recurrence_returns: int
    geo_context: GeoContext
    score_breakdown: ScoreBreakdown
    reports: list[ReportSummary]
    events: list[HotspotEvent]
    before_after: BeforeAfterRecord | None = Field(
        None, description="Latest before/after record for this hotspot (SPEC §14), if any."
    )
    is_simulated: bool = False
    non_attribution_note: str = Field(
        NON_ATTRIBUTION_NOTE, description="Persistent note required on authority views."
    )


class VerifyRequest(BaseModel):
    """SPEC §8. A human authority action — nothing here happens automatically."""

    decision: VerifyDecision
    reason: RejectReason | None = Field(
        None, description="Required when decision is reject or false_positive."
    )
    note: str | None = None

    @model_validator(mode="after")
    def _reason_matches_decision(self) -> VerifyRequest:
        if self.decision != VerifyDecision.verify and self.reason is None:
            raise ValueError("reason is required when decision is reject or false_positive")
        if self.decision == VerifyDecision.verify and self.reason is not None:
            raise ValueError("reason only applies to reject or false_positive")
        return self


class VerifyResponse(BaseModel):
    hotspot_id: int
    from_status: HotspotStatus
    to_status: HotspotStatus
    event: HotspotEvent


# --------------------------------------------------------------------------
# Geo layers (see FROZEN CONTRACT comment in routers/geo.py)
# --------------------------------------------------------------------------


class GeoFeatureProperties(BaseModel):
    id: int
    kind: GeoFeatureKind
    name: str | None = None
    source: Literal["osm", "manual"] = "osm"


class GeoFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: int
    geometry: dict[str, Any] = Field(
        ..., description="Any GeoJSON geometry: drains are lines, water polygons, amenities points."
    )
    properties: GeoFeatureProperties


class GeoFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GeoFeature]
    attribution: str = "© OpenStreetMap contributors"


class WardProperties(BaseModel):
    id: int
    name: str
    hotspot_count: int = 0
    open_count: int = 0
    resolved_count: int = 0
    avg_impact: float | None = None
    is_simulated: bool = False


class WardFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: int
    geometry: dict[str, Any]
    properties: WardProperties


class WardFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[WardFeature]
    attribution: str = "© OpenStreetMap contributors"


# --------------------------------------------------------------------------
# Cleanup tasks + routing
# --------------------------------------------------------------------------


class TaskCreateRequest(BaseModel):
    """Tasks accept VERIFIED hotspots only (SPEC §13) — a non-verified id is a 409."""

    hotspot_ids: list[int] = Field(..., min_length=1)
    team_id: UUID
    depot: list[float] = Field(..., description="[lon, lat] start/end point of the route.")


class TaskStop(BaseModel):
    id: int
    seq: int
    hotspot_id: int
    lat: float
    lon: float
    priority_band: PriorityBand | None = None
    arrived_at: datetime | None = None
    completed_at: datetime | None = None
    before_after_id: int | None = None
    verdict: Verdict | None = Field(None, description="Suggested verdict — never a resolution.")
    review_decision: ReviewDecision | None = None


class TaskSummary(BaseModel):
    id: int
    status: TaskStatus
    assigned_team: UUID | None = None
    assigned_team_name: str | None = None
    created_by: UUID | None = None
    stop_count: int
    route_distance_m: float | None = None
    route_duration_s: float | None = None
    created_at: datetime
    is_simulated: bool = False


class TaskDetail(TaskSummary):
    depot: list[float] | None = None
    stops: list[TaskStop]
    route_geojson: dict[str, Any] | None = Field(
        None, description="Decoded ORS geometry, or straight lines when the fallback ran."
    )
    route_source: Literal["ors", "greedy"] | None = None


class ArriveRequest(BaseModel):
    """The team's current position, checked against the stop (SPEC §8: within 50 m)."""

    lat: float
    lon: float
    gps_accuracy_m: float | None = None


class ArriveResponse(BaseModel):
    """Arrival is checked within 50 m of the stop (SPEC §8)."""

    stop: TaskStop
    distance_m: float
    within_range: bool


# --------------------------------------------------------------------------
# Before / after
# --------------------------------------------------------------------------


class BeforeAfterRecord(BaseModel):
    """SPEC §14. The system computes a verdict but NEVER auto-resolves (CLAUDE.md §2.5).

    Absence of detections after cleanup is not proof of cleanliness (CLAUDE.md §2.6).
    """

    id: int
    task_stop_id: int | None = None
    task_id: int | None = None
    hotspot_id: int | None = None
    hotspot_status: HotspotStatus | None = None
    before_report_id: UUID | None = None
    before_image_path: str | None = None
    before_annotated_path: str | None = Field(
        None, description="Detector-annotated before photo (boxes), if written."
    )
    after_image_paths: list[str] = []
    after_annotated_paths: list[str | None] = Field(
        [], description="Detector-annotated after-photos, in after_image_paths order."
    )
    before_count: int | None = None
    before_area: float | None = None
    after_count: int | None = None
    after_area: float | None = None
    reduction_ratio: float | None = Field(
        None, description="1 - (after plastic area / before plastic area), using the worse photo."
    )
    viewpoint_match: float | None = Field(
        None, description="ORB match score against the before image."
    )
    quality_flags: dict[str, Any] = {}
    verdict: Verdict | None = None
    verdict_note: str = Field(
        "A verdict is a suggestion. Only an authority can resolve a hotspot.",
        description="CLAUDE.md §2.5/§2.6.",
    )
    review_decision: ReviewDecision | None = None
    reviewed_by: UUID | None = None
    reviewed_by_name: str | None = None
    created_at: datetime
    is_simulated: bool = False


class ReviewRequest(BaseModel):
    """A human authority action. Only confirm_resolved closes the hotspot."""

    decision: ReviewDecision
    note: str | None = None


class ReviewResponse(BaseModel):
    before_after: BeforeAfterRecord
    hotspot_id: int
    hotspot_status: HotspotStatus
    event: HotspotEvent


# --------------------------------------------------------------------------
# Analytics
# --------------------------------------------------------------------------


class KpiCards(BaseModel):
    """The 6 KPI cards of SPEC §2 F8."""

    total_reports: int
    active_hotspots: int
    awaiting_verification: int
    verified_hotspots: int
    resolved_hotspots: int
    median_days_to_resolve: float | None = None


class BandCount(BaseModel):
    band: PriorityBand
    count: int


class StatusCount(BaseModel):
    status: HotspotStatus
    count: int


class AnalyticsSummary(BaseModel):
    kpis: KpiCards
    by_band: list[BandCount]
    by_status: list[StatusCount]
    simulated_data: bool = Field(
        True, description="True while the dashboard is showing seeded demo data (CLAUDE.md §2.2)."
    )
    non_attribution_note: str = NON_ATTRIBUTION_NOTE


class TrendPoint(BaseModel):
    date: str = Field(..., description="ISO date, YYYY-MM-DD.")
    reports: int
    hotspots_opened: int
    hotspots_resolved: int


class AnalyticsTrend(BaseModel):
    days: int
    points: list[TrendPoint]
    simulated_data: bool = True


class WardStats(BaseModel):
    ward_id: int
    ward_name: str
    hotspot_count: int
    open_count: int
    resolved_count: int
    avg_impact: float | None = None
    total_reports: int = 0


class AnalyticsWards(BaseModel):
    wards: list[WardStats]
    simulated_data: bool = True
    non_attribution_note: str = NON_ATTRIBUTION_NOTE


# --------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------


class ResetDemoResponse(BaseModel):
    """POST /admin/reset-demo — wipes and reseeds the simulated demo state."""

    status: Literal["ok"] = "ok"
    reports: int
    hotspots: int
    users: int
    is_simulated: bool = True
    message: str = "Demo state reseeded. All geotags in this dataset are simulated."

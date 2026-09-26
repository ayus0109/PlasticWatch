"""Stage 3: the frozen detector contract (SPEC §6) and the image quality gates."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw, ImageFilter

from app.schemas import AiStatus, Detection, DetectionClass, DetectorOutput
from app.services import detector, quality
from app.services.confidence import confidence_tier
from app.services.media import to_fs

FROZEN_KEYS = {
    "plastic_count",
    "plastic_area_frac",
    "report_confidence",
    "detections",
    "annotated_jpg_path",
    "ai_status",
}
DETECTION_KEYS = {"class_name", "confidence", "x1", "y1", "x2", "y2", "area_frac"}


@pytest.fixture(autouse=True)
def stub_env(set_env, tmp_path):
    set_env(DETECTOR_MODE="stub", UPLOAD_DIR=tmp_path / "uploads")


def textured_photo(path, seed: int = 0, size=(800, 600)):
    """A sharp, mid-brightness synthetic 'photo' (random rectangles)."""
    import random

    rng = random.Random(seed)
    img = Image.new("RGB", size, (120, 130, 110))
    draw = ImageDraw.Draw(img)
    for _ in range(300):
        x, y = rng.randrange(size[0]), rng.randrange(size[1])
        colour = tuple(rng.randrange(40, 220) for _ in range(3))
        draw.rectangle([x, y, x + rng.randrange(4, 40), y + rng.randrange(4, 40)], fill=colour)
    img.save(path, "JPEG", quality=92)
    return path


# ---------------------------------------------------------------------------
# Contract shape
# ---------------------------------------------------------------------------


def test_stub_output_has_exactly_the_contract_keys_and_types():
    out = detector.run_detection("uploads/x.jpg").model_dump(mode="json")
    assert set(out) == FROZEN_KEYS
    assert isinstance(out["plastic_count"], int)
    assert isinstance(out["plastic_area_frac"], float)
    assert isinstance(out["report_confidence"], float)
    assert out["ai_status"] in {"detected", "not_detected"}
    assert 0.0 <= out["plastic_area_frac"] <= 1.0
    assert 0.0 <= out["report_confidence"] <= 1.0
    for det in out["detections"]:
        assert set(det) == DETECTION_KEYS
        assert 0.0 <= det["area_frac"] <= 1.0
        assert 0.0 <= det["confidence"] <= 1.0
        assert det["x1"] <= det["x2"] and det["y1"] <= det["y2"]


def test_stub_is_deterministic_for_a_filename():
    """Stage 3 acceptance: two calls with the same path return identical dicts."""
    a = detector.run_detection("uploads/x.jpg").model_dump()
    b = detector.run_detection("uploads/x.jpg").model_dump()
    assert a == b


def test_stub_is_deterministic_for_the_same_image_bytes(tmp_path):
    """Same photo under two different names -> same detections (uploads get UUID names)."""
    first = textured_photo(tmp_path / "a.jpg", seed=7)
    second = tmp_path / "b.jpg"
    second.write_bytes(first.read_bytes())
    a = detector.run_detection(first).model_dump(exclude={"annotated_jpg_path"})
    b = detector.run_detection(second).model_dump(exclude={"annotated_jpg_path"})
    assert a == b


def test_stub_varies_across_files_and_covers_both_outcomes():
    outs = [detector.run_detection(f"uploads/img_{i}.jpg") for i in range(60)]
    assert len({o.plastic_count for o in outs}) > 5, "stub output should vary"
    statuses = {o.ai_status for o in outs}
    assert statuses == {AiStatus.detected, AiStatus.not_detected}


def test_stub_never_emits_a_class_outside_the_five():
    allowed = {c.value for c in DetectionClass}
    for i in range(60):
        for det in detector.run_detection(f"uploads/c_{i}.jpg").detections:
            assert det.class_name.value in allowed


def test_stub_writes_a_watermarked_annotated_image(tmp_path):
    photo = textured_photo(tmp_path / "scene.jpg", seed=3)
    out = next(
        o
        for o in (detector.run_detection(textured_photo(tmp_path / f"s{i}.jpg", seed=i))
                  for i in range(20))
        if o.ai_status == AiStatus.detected
    )
    assert out.annotated_jpg_path is not None
    assert out.annotated_jpg_path.startswith("uploads/annotated/")
    with Image.open(to_fs(out.annotated_jpg_path)) as annotated:
        assert annotated.format == "JPEG"
        # The amber SIMULATED banner spans the top edge.
        r, g, b = annotated.convert("RGB").getpixel((annotated.width - 5, 3))
        assert (r, g, b) == pytest.approx((245, 158, 11), abs=25)
    assert photo.exists()


def test_missing_file_gives_no_annotated_image():
    assert detector.run_detection("uploads/does-not-exist.jpg").annotated_jpg_path is None


# ---------------------------------------------------------------------------
# Contract maths (shared by stub and real)
# ---------------------------------------------------------------------------


def det(cls: str, conf: float, area: float) -> Detection:
    return Detection(
        class_name=cls, confidence=conf, x1=0, y1=0, x2=10, y2=10, area_frac=area
    )


def test_summarise_uses_top3_plastic_confidences():
    out = detector.summarise(
        [
            det("plastic_bottle", 0.9, 0.1),
            det("plastic_bag_film", 0.8, 0.1),
            det("plastic_other", 0.7, 0.1),
            det("plastic_packaging", 0.2, 0.1),
            det("non_plastic_litter", 0.99, 0.3),  # excluded from count, area, confidence
        ],
        None,
    )
    assert out.plastic_count == 4
    assert out.report_confidence == pytest.approx(0.8)
    assert out.plastic_area_frac == pytest.approx(0.4)
    assert out.ai_status == AiStatus.detected


def test_summarise_fewer_than_three_uses_mean_of_available():
    dets = [det("plastic_bottle", 0.9, 0.1), det("plastic_other", 0.5, 0.1)]
    out = detector.summarise(dets, None)
    assert out.report_confidence == pytest.approx(0.7)


def test_summarise_no_plastic_is_zero_confidence_and_not_detected():
    out = detector.summarise([det("non_plastic_litter", 0.95, 0.2)], None)
    assert (out.plastic_count, out.report_confidence, out.plastic_area_frac) == (0, 0.0, 0.0)
    assert out.ai_status == AiStatus.not_detected


def test_summarise_caps_area_at_one():
    dets = [det("plastic_bottle", 0.9, 0.7), det("plastic_other", 0.9, 0.6)]
    out = detector.summarise(dets, None)
    assert out.plastic_area_frac == 1.0


# ---------------------------------------------------------------------------
# Real mode guards (no weights / no ultralytics needed)
# ---------------------------------------------------------------------------


def test_real_mode_without_weights_is_an_error_not_a_stub_fallback(set_env, tmp_path):
    set_env(DETECTOR_MODE="real", DETECTOR_WEIGHTS=tmp_path / "missing.pt")
    out = detector.run_detection(textured_photo(tmp_path / "p.jpg"))
    assert out.ai_status == AiStatus.error
    assert out.detections == [] and out.annotated_jpg_path is None


def test_real_mode_drops_classes_outside_the_contract(set_env, tmp_path, monkeypatch):
    """CLAUDE.md §2.4 — even if a model emitted 'person', it never leaves the detector."""
    weights = tmp_path / "best.pt"
    weights.write_bytes(b"fake")
    set_env(DETECTOR_MODE="real", DETECTOR_WEIGHTS=weights)

    def box(cls: int, conf: float, xyxy):
        return SimpleNamespace(
            cls=cls, conf=conf, xyxy=[SimpleNamespace(tolist=lambda v=xyxy: list(v))]
        )

    fake_result = SimpleNamespace(
        names={0: "plastic_bottle", 1: "person", 2: "car"},
        boxes=[box(0, 0.8, (10, 10, 110, 110)), box(1, 0.99, (0, 0, 50, 50)),
               box(2, 0.95, (5, 5, 60, 60))],
    )
    fake_model = SimpleNamespace(predict=lambda *a, **k: [fake_result])
    monkeypatch.setattr(detector, "_load_model", lambda weights: fake_model)

    out = detector.run_detection(textured_photo(tmp_path / "p.jpg"))
    assert [d.class_name.value for d in out.detections] == ["plastic_bottle"]
    assert out.plastic_count == 1 and out.ai_status == AiStatus.detected
    DetectorOutput.model_validate(out.model_dump())


def _fake_model(monkeypatch, names, boxes):
    result = SimpleNamespace(names=names, boxes=boxes)
    monkeypatch.setattr(
        detector,
        "_load_model",
        lambda weights: SimpleNamespace(predict=lambda *a, **k: [result]),
    )


def test_real_mode_finding_nothing_is_not_detected_never_an_error(
    set_env, tmp_path, monkeypatch
):
    """A model that RAN and saw no plastic is not_detected — a real answer.

    Regression: an empty box list used to return None, which _run_real could not tell
    apart from "no detector available", so it produced ai_status=error. The citizen was
    then told "we couldn't analyse this photo right now" about a photo that analysed
    perfectly — e.g. every photo of an already-clean street.
    """
    weights = tmp_path / "best.pt"
    weights.write_bytes(b"fake")
    set_env(DETECTOR_MODE="real", DETECTOR_WEIGHTS=weights)
    _fake_model(monkeypatch, {0: "plastic_bottle"}, [])

    out = detector.run_detection(textured_photo(tmp_path / "clean.jpg"))
    assert out.ai_status == AiStatus.not_detected
    assert out.plastic_count == 0 and out.report_confidence == 0.0
    assert out.detections == []
    DetectorOutput.model_validate(out.model_dump())


def test_forbidden_filter_matches_words_not_substrings():
    """§2.4 must drop people and vehicles — and ONLY those.

    Regression: a substring test on "car" also discarded "carton", "cardboard",
    "carded" and "carrier bag" — seven TACO categories, one of them a plastic bag.
    """
    for name in ("person", "a person", "car", "cars", "bus", "buses", "horse",
                 "motorcycle", "licence plate", "face"):
        assert detector.is_forbidden_label(name), f"{name!r} must be dropped"
    for name in ("Single-use carrier bag", "Egg carton", "Other carton",
                 "Corrugated carton", "Meal carton", "Drink carton",
                 "Carded blister pack", "Clear plastic bottle"):
        assert not detector.is_forbidden_label(name), f"{name!r} must be kept"


class _FakeResponse:
    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_roboflow(monkeypatch, payload, captured=None):
    def _urlopen(req, timeout=None):
        if captured is not None:
            captured["url"] = req.full_url
            captured["headers"] = dict(req.headers)
        if isinstance(payload, Exception):
            raise payload
        return _FakeResponse(payload)

    monkeypatch.setattr(detector.urllib.request, "urlopen", _urlopen)


def test_roboflow_is_off_without_a_key(set_env, tmp_path, monkeypatch):
    """No key configured means the path does not run at all."""
    set_env(DETECTOR_MODE="real", DETECTOR_WEIGHTS=tmp_path / "missing.pt", ROBOFLOW_API_KEY="")
    called = {"n": 0}
    monkeypatch.setattr(
        detector, "_try_roboflow_detection",
        lambda p: called.__setitem__("n", called["n"] + 1),
    )
    detector.run_detection(textured_photo(tmp_path / "p.jpg"))
    assert called["n"] == 0


def test_roboflow_maps_taco_names_and_never_puts_the_key_in_the_url(
    set_env, tmp_path, monkeypatch
):
    """TACO category names become the frozen five, and the key travels in a header."""
    set_env(DETECTOR_MODE="real", DETECTOR_WEIGHTS=tmp_path / "missing.pt",
            ROBOFLOW_API_KEY="secret-key", UPLOAD_DIR=tmp_path / "uploads")
    captured: dict = {}
    _fake_roboflow(monkeypatch, {
        "predictions": [
            {"class": "Clear plastic bottle", "confidence": 0.81, "x": 60, "y": 60,
             "width": 40, "height": 40},
            {"class": "Single-use carrier bag", "confidence": 0.62, "x": 120, "y": 90,
             "width": 30, "height": 30},
            {"class": "Glass bottle", "confidence": 0.55, "x": 30, "y": 30,
             "width": 20, "height": 20},
        ]
    }, captured)

    out = detector.run_detection(textured_photo(tmp_path / "p.jpg"))
    assert [d.class_name.value for d in out.detections] == [
        "plastic_bottle", "plastic_bag_film", "non_plastic_litter",
    ]
    assert out.ai_status == AiStatus.detected
    assert out.plastic_count == 2  # the glass bottle is litter, not plastic
    assert "secret-key" not in captured["url"]
    assert captured["headers"].get("Authorization") == "Bearer secret-key"
    DetectorOutput.model_validate(out.model_dump())


def test_roboflow_mode_routes_to_the_hosted_model_and_is_not_simulated(
    set_env, tmp_path, monkeypatch
):
    """DETECTOR_MODE=roboflow must reach the hosted model, NOT the stub.

    is_stub_mode() gates the dispatch AND the API's `is_simulated` flag, so if it
    treated any non-"real" mode as stub, this mode would quietly serve fabricated
    boxes while the UI claimed a real model (CLAUDE.md §2.2 inverted).
    """
    set_env(DETECTOR_MODE="roboflow", ROBOFLOW_API_KEY="k",
            UPLOAD_DIR=tmp_path / "uploads")
    assert detector.is_stub_mode() is False
    _fake_roboflow(monkeypatch, {
        "predictions": [
            {"class": "Plastic film", "confidence": 0.77, "x": 50, "y": 50,
             "width": 24, "height": 24}
        ]
    })
    out = detector.run_detection(textured_photo(tmp_path / "p.jpg"))
    assert [d.class_name.value for d in out.detections] == ["plastic_bag_film"]
    assert out.ai_status == AiStatus.detected


def test_roboflow_mode_without_a_key_errors_rather_than_falling_back_to_the_stub(
    set_env, tmp_path
):
    """Asking for the hosted model and not getting it is an error, never fake output."""
    set_env(DETECTOR_MODE="roboflow", ROBOFLOW_API_KEY="")
    out = detector.run_detection(textured_photo(tmp_path / "p.jpg"))
    assert out.ai_status == AiStatus.error
    assert out.detections == []


def test_roboflow_drops_people_and_vehicles(set_env, tmp_path, monkeypatch):
    """CLAUDE.md §2.4 applies to a third party's model exactly as to ours."""
    set_env(DETECTOR_MODE="real", DETECTOR_WEIGHTS=tmp_path / "missing.pt",
            ROBOFLOW_API_KEY="k", UPLOAD_DIR=tmp_path / "uploads")
    _fake_roboflow(monkeypatch, {
        "predictions": [
            {"class": "person", "confidence": 0.99, "x": 10, "y": 10, "width": 8, "height": 8},
            {"class": "car", "confidence": 0.98, "x": 20, "y": 20, "width": 8, "height": 8},
            {"class": "Other plastic bottle", "confidence": 0.7, "x": 40, "y": 40,
             "width": 20, "height": 20},
        ]
    })
    out = detector.run_detection(textured_photo(tmp_path / "p.jpg"))
    assert [d.class_name.value for d in out.detections] == ["plastic_bottle"]


def test_roboflow_failure_falls_through_and_never_fabricates(set_env, tmp_path, monkeypatch):
    """A dead network is an error, not an excuse to emit stub output."""
    set_env(DETECTOR_MODE="real", DETECTOR_WEIGHTS=tmp_path / "missing.pt",
            ROBOFLOW_API_KEY="k", DETECTOR_CV_FALLBACK=False)
    _fake_roboflow(monkeypatch, detector.urllib.error.URLError("no route to host"))
    out = detector.run_detection(textured_photo(tmp_path / "p.jpg"))
    assert out.ai_status == AiStatus.error
    assert out.detections == []


def test_local_weights_take_precedence_over_the_hosted_model(
    set_env, tmp_path, monkeypatch
):
    """The photo must not leave the machine when we can answer locally."""
    weights = tmp_path / "best.pt"
    weights.write_bytes(b"fake")
    set_env(DETECTOR_MODE="real", DETECTOR_WEIGHTS=weights, ROBOFLOW_API_KEY="k",
            UPLOAD_DIR=tmp_path / "uploads")
    _fake_model(monkeypatch, {0: "plastic_bottle"}, [
        SimpleNamespace(cls=0, conf=0.9, xyxy=[SimpleNamespace(tolist=lambda: [5, 5, 50, 50])])
    ])
    reached = {"n": 0}
    monkeypatch.setattr(
        detector, "_try_roboflow_detection",
        lambda p: reached.__setitem__("n", reached["n"] + 1),
    )
    out = detector.run_detection(textured_photo(tmp_path / "p.jpg"))
    assert out.ai_status == AiStatus.detected
    assert reached["n"] == 0, "hosted inference ran even though local weights answered"


def test_roboflow_multi_model_ensemble_and_nms(set_env, tmp_path, monkeypatch):
    """Ensemble of multiple Roboflow models runs concurrently and fuses boxes with NMS."""
    set_env(
        DETECTOR_MODE="roboflow",
        ROBOFLOW_API_KEY="test-key",
        ROBOFLOW_MODEL_ID="waste-tfpi0/7,garbage-0q3db/10",
        UPLOAD_DIR=tmp_path / "uploads",
    )
    calls = []

    def _mock_query(model_id, body, conf_floor, timeout_s, api_key, api_url):
        calls.append(model_id)
        if "waste-tfpi0" in model_id:
            return model_id, [
                {"class": "plastic bottle", "confidence": 0.85,
                 "x": 100, "y": 100, "width": 50, "height": 50},
                {"class": "plastic bag", "confidence": 0.70,
                 "x": 200, "y": 200, "width": 40, "height": 40},
            ]
        else:
            return model_id, [
                # Overlapping bottle, higher confidence: NMS keeps this one
                {"class": "plastic bottle", "confidence": 0.95,
                 "x": 102, "y": 98, "width": 48, "height": 52},
                # Unique to model 2: must be merged into the result
                {"class": "drink can", "confidence": 0.80,
                 "x": 300, "y": 300, "width": 30, "height": 30},
            ]

    monkeypatch.setattr(detector, "_query_single_roboflow_model", _mock_query)
    out = detector.run_detection(textured_photo(tmp_path / "ensemble.jpg"))
    assert set(calls) == {"waste-tfpi0/7", "garbage-0q3db/10"}
    assert len(out.detections) == 3  # bottle (fused to 0.95), bag (0.70), can (0.80)
    classes = [d.class_name.value for d in out.detections]
    assert "plastic_bottle" in classes
    assert "plastic_bag_film" in classes
    # Verify highest confidence was kept
    bottle = next(d for d in out.detections if d.class_name.value == "plastic_bottle")
    assert bottle.confidence == 0.95


def test_real_mode_only_forbidden_classes_is_not_detected_not_an_error(
    set_env, tmp_path, monkeypatch
):
    """§2.4 filtering emptying the list is still "ran and found no plastic"."""
    weights = tmp_path / "best.pt"
    weights.write_bytes(b"fake")
    set_env(DETECTOR_MODE="real", DETECTOR_WEIGHTS=weights)
    boxes = [
        SimpleNamespace(cls=0, conf=0.99, xyxy=[SimpleNamespace(tolist=lambda: [0, 0, 40, 40])]),
        SimpleNamespace(cls=1, conf=0.97, xyxy=[SimpleNamespace(tolist=lambda: [5, 5, 60, 60])]),
    ]
    _fake_model(monkeypatch, {0: "person", 1: "car"}, boxes)

    out = detector.run_detection(textured_photo(tmp_path / "street.jpg"))
    assert out.detections == []
    assert out.ai_status == AiStatus.not_detected


# ---------------------------------------------------------------------------
# Confidence tiers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("conf", "tier"), [(0.0, "low"), (0.49, "low"), (0.5, "medium"), (0.749, "medium"),
                       (0.75, "high"), (1.0, "high")]
)
def test_confidence_tier_half_open_bands(conf, tier):
    assert confidence_tier(conf).value == tier


# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------


def test_sharp_photo_passes_quality(tmp_path):
    low, flags = quality.check_file(textured_photo(tmp_path / "sharp.jpg"))
    assert not low, flags
    assert flags["blur_ok"] and flags["brightness_ok"]


def test_blurred_photo_fails_blur_gate(tmp_path):
    sharp = Image.open(textured_photo(tmp_path / "sharp.jpg"))
    sharp.filter(ImageFilter.GaussianBlur(12)).save(tmp_path / "blur.jpg")
    low, flags = quality.check_file(tmp_path / "blur.jpg")
    assert low and not flags["blur_ok"]
    assert flags["blur_score"] < quality.blur_score(sharp)


def test_dark_photo_fails_brightness_gate(tmp_path):
    Image.new("RGB", (400, 300), (8, 8, 8)).save(tmp_path / "dark.jpg")
    low, flags = quality.check_file(tmp_path / "dark.jpg")
    assert low and not flags["brightness_ok"]


def test_blur_score_is_resolution_independent(tmp_path):
    """Normalising the size keeps one threshold meaningful for any camera."""
    big = Image.open(textured_photo(tmp_path / "big.jpg", size=(3200, 2400)))
    small = big.resize((1024, 768), Image.Resampling.LANCZOS)
    assert quality.blur_score(big) == pytest.approx(quality.blur_score(small), rel=0.05)

"""Stage 3: the frozen detector contract (SPEC §6) and the image quality gates."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw, ImageFilter

from app.schemas import AiStatus, Detection, DetectionClass, DetectorOutput
from app.services import detector, quality
from app.services.confidence import confidence_tier

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
    with Image.open(out.annotated_jpg_path) as annotated:
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

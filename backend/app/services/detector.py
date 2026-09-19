"""Likely-plastic detector — frozen contract of SPEC §6, stub-first (CLAUDE.md §5).

run_detection(image_path) -> DetectorOutput, selected by DETECTOR_MODE:

  stub  (default) Deterministic fake output derived from a hash of the image bytes
        (or the file name when no file exists) — varied across images, identical for
        the same image, no model download. The
        annotated image is watermarked "SIMULATED DETECTION" so fake boxes on a real
        photo can never be mistaken for a real model's output (CLAUDE.md §2.2).
  real  Ultralytics YOLO on DETECTOR_WEIGHTS. Only the five SPEC §6 classes are
        accepted — anything else is dropped, so no person, vehicle or licence-plate
        label can ever leave this module (CLAUDE.md §2.4). Missing weights is an
        error, never a silent fallback to the stub.

Both modes feed one summarise() so count / area / confidence follow SPEC §6 exactly:
  plastic_count      = number of plastic-likely boxes
  plastic_area_frac  = sum of plastic-likely box areas / image area, capped at 1.0
  report_confidence  = mean of the top-3 plastic-likely confidences
                       (fewer than 3: mean of those present; none: 0.0)
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
from functools import lru_cache
from pathlib import Path

import imagehash
from PIL import Image, ImageDraw, ImageFont, ImageOps

from app.config import get_settings
from app.schemas import AiStatus, Detection, DetectionClass, DetectorOutput
from app.services.confidence import confidence_tier
from app.services.media import to_public, upload_root

logger = logging.getLogger("plasticwatch.detector")

PLASTIC_CLASSES = frozenset(
    {
        DetectionClass.plastic_bottle,
        DetectionClass.plastic_bag_film,
        DetectionClass.plastic_packaging,
        DetectionClass.plastic_other,
    }
)
ALLOWED_CLASS_NAMES = frozenset(c.value for c in DetectionClass)

# Box labels always say "likely" and carry the tier (CLAUDE.md §2.1, §2.7).
_LABELS = {
    DetectionClass.plastic_bottle: "likely bottle",
    DetectionClass.plastic_bag_film: "likely bag/film",
    DetectionClass.plastic_packaging: "likely packaging",
    DetectionClass.plastic_other: "likely other plastic",
    DetectionClass.non_plastic_litter: "non-plastic litter",
}
_COLOURS = {
    DetectionClass.plastic_bottle: (239, 68, 68),
    DetectionClass.plastic_bag_film: (249, 115, 22),
    DetectionClass.plastic_packaging: (245, 158, 11),
    DetectionClass.plastic_other: (236, 72, 153),
    DetectionClass.non_plastic_litter: (100, 116, 139),
}

# Stub shape: roughly 1 in 7 files yields no likely plastic, so the rejection path
# shows up in demos without any special casing.
STUB_NOT_DETECTED_RATE = 0.15
STUB_DEFAULT_SIZE = (640, 640)
ANNOTATED_MAX_SIDE = 1600


# ---------------------------------------------------------------------------
# Shared contract maths
# ---------------------------------------------------------------------------


def summarise(detections: list[Detection], annotated_path: str | None) -> DetectorOutput:
    plastic = [d for d in detections if d.class_name in PLASTIC_CLASSES]
    top3 = sorted((d.confidence for d in plastic), reverse=True)[:3]
    return DetectorOutput(
        plastic_count=len(plastic),
        plastic_area_frac=min(1.0, sum(d.area_frac for d in plastic)),
        report_confidence=sum(top3) / len(top3) if top3 else 0.0,
        detections=detections,
        annotated_jpg_path=annotated_path,
        ai_status=AiStatus.detected if plastic else AiStatus.not_detected,
    )


def _error_output() -> DetectorOutput:
    return DetectorOutput(
        plastic_count=0,
        plastic_area_frac=0.0,
        report_confidence=0.0,
        detections=[],
        annotated_jpg_path=None,
        ai_status=AiStatus.error,
    )


def _box(cls: DetectionClass, conf: float, x1, y1, x2, y2, w: int, h: int) -> Detection:
    x1, x2 = max(0.0, min(x1, x2)), min(float(w), max(x1, x2))
    y1, y2 = max(0.0, min(y1, y2)), min(float(h), max(y1, y2))
    area = (x2 - x1) * (y2 - y1) / float(w * h) if w and h else 0.0
    return Detection(
        class_name=cls,
        confidence=round(conf, 4),
        x1=round(x1, 1),
        y1=round(y1, 1),
        x2=round(x2, 1),
        y2=round(y2, 1),
        area_frac=min(1.0, max(0.0, area)),
    )


def is_stub_mode() -> bool:
    return get_settings().DETECTOR_MODE.strip().lower() != "real"


# ---------------------------------------------------------------------------
# Annotated image
# ---------------------------------------------------------------------------


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1 has no sized default font
        return ImageFont.load_default()


def _annotated_path(image_path: Path) -> Path:
    return upload_root() / "annotated" / f"{image_path.stem}.jpg"


def _write_annotated(
    img: Image.Image, detections: list[Detection], out: Path, simulated: bool
) -> str:
    scale = min(1.0, ANNOTATED_MAX_SIDE / max(img.size))
    canvas = img.convert("RGB")
    if scale < 1.0:
        canvas = canvas.resize((round(img.width * scale), round(img.height * scale)))
    draw = ImageDraw.Draw(canvas)
    stroke = max(2, round(max(canvas.size) / 320))
    font = _font(max(12, round(max(canvas.size) / 48)))

    for d in detections:
        colour = _COLOURS[d.class_name]
        box = [d.x1 * scale, d.y1 * scale, d.x2 * scale, d.y2 * scale]
        draw.rectangle(box, outline=colour, width=stroke)
        label = f"{_LABELS[d.class_name]} · {confidence_tier(d.confidence).value.capitalize()}"
        tx, ty = box[0], max(0, box[1] - font.size - 6)
        tb = draw.textbbox((tx + 4, ty + 2), label, font=font)
        draw.rectangle([tb[0] - 4, tb[1] - 2, tb[2] + 4, tb[3] + 2], fill=colour)
        draw.text((tx + 4, ty + 2), label, fill=(255, 255, 255), font=font)

    if simulated:
        banner = "SIMULATED DETECTION - stub output, not a real model"
        bh = font.size + 16
        draw.rectangle([0, 0, canvas.width, bh], fill=(245, 158, 11))
        draw.text((10, 8), banner, fill=(0, 0, 0), font=font)

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, "JPEG", quality=85)
    return to_public(out)


# ---------------------------------------------------------------------------
# Stub
# ---------------------------------------------------------------------------


def _stub_detections(key: bytes, w: int, h: int) -> list[Detection]:
    seed = int.from_bytes(hashlib.sha256(key).digest()[:8], "big")
    rng = random.Random(seed)
    floor = get_settings().DETECTOR_CONF_THRESHOLD

    n_plastic = 0 if rng.random() < STUB_NOT_DETECTED_RATE else rng.randint(1, 14)
    n_other = rng.randint(0, 2)
    plastic = sorted(PLASTIC_CLASSES)

    out = []
    for i in range(n_plastic + n_other):
        cls = rng.choice(plastic) if i < n_plastic else DetectionClass.non_plastic_litter
        bw, bh = rng.uniform(0.05, 0.22) * w, rng.uniform(0.05, 0.22) * h
        x1, y1 = rng.uniform(0, w - bw), rng.uniform(0, h - bh)
        conf = rng.uniform(max(floor, 0.3), 0.93)
        out.append(_box(cls, conf, x1, y1, x1 + bw, y1 + bh, w, h))
    return out


def _run_stub(path: Path) -> DetectorOutput:
    # Keyed on the image BYTES when the file exists — uploads are saved under fresh
    # UUID names, so a name key would make the same photo give a different result on
    # every upload. Same photo -> same result, like a real model. Falls back to the
    # file name when there is no file (e.g. a bare path in a python shell).
    img = None
    key = path.name.encode("utf-8")
    if path.is_file():
        key = path.read_bytes()
        with Image.open(path) as raw:
            img = ImageOps.exif_transpose(raw).copy()
    w, h = img.size if img is not None else STUB_DEFAULT_SIZE

    detections = _stub_detections(key, w, h)
    annotated = None
    if img is not None:
        annotated = _write_annotated(img, detections, _annotated_path(path), simulated=True)
    return summarise(detections, annotated)


# ---------------------------------------------------------------------------
# Known detections: the demo cache and the seed
# ---------------------------------------------------------------------------


def from_known(path: Path, known: list[dict], simulated: bool = True) -> DetectorOutput:
    """Contract output for boxes we already know (synthetic demo scenes, or a cached
    inference). Writes the annotated image like a live run would. Synthetic boxes
    are simulated data, so the SIMULATED watermark goes on by default (§2.2)."""
    with Image.open(path) as raw:
        img = ImageOps.exif_transpose(raw).convert("RGB")
    w, h = img.size
    dets = [
        _box(DetectionClass(k["class_name"]), float(k["confidence"]),
             k["x1"], k["y1"], k["x2"], k["y2"], w, h)
        for k in known
        if k["class_name"] in ALLOWED_CLASS_NAMES
    ]
    annotated = _write_annotated(img, dets, _annotated_path(path), simulated=simulated)
    return summarise(dets, annotated)


@lru_cache
def _load_cache(cache_path: str) -> tuple[tuple[imagehash.ImageHash, list[dict], bool], ...]:
    p = Path(cache_path)
    if not cache_path or not p.is_file():
        return ()
    data = json.loads(p.read_text(encoding="utf-8"))
    return tuple(
        (imagehash.hex_to_hash(e["phash"]), e["detections"], e.get("simulated", True))
        for e in data.get("entries", [])
    )


def _cache_lookup(path: Path) -> tuple[list[dict], bool] | None:
    s = get_settings()
    entries = _load_cache(s.DETECTOR_CACHE_PATH)
    if not entries or not path.is_file():
        return None
    with Image.open(path) as img:
        h = imagehash.phash(ImageOps.exif_transpose(img))
    best = min(entries, key=lambda e: h - e[0])
    return (best[1], best[2]) if h - best[0] <= s.DETECTOR_CACHE_HAMMING else None


# ---------------------------------------------------------------------------
# Real (Ultralytics) — exercised once ML-3 delivers weights
# ---------------------------------------------------------------------------


@lru_cache
def _load_model(weights: str):
    from ultralytics import YOLO  # imported lazily: the stub must not need it

    return YOLO(weights)


def _run_real(path: Path) -> DetectorOutput:
    s = get_settings()
    weights = Path(s.DETECTOR_WEIGHTS)
    if not weights.is_file():
        raise FileNotFoundError(
            f"DETECTOR_MODE=real but weights not found at {weights}. "
            "Refusing to fall back to the stub: that would present fake output as real."
        )

    with Image.open(path) as raw:
        img = ImageOps.exif_transpose(raw).convert("RGB")
    w, h = img.size

    model = _load_model(str(weights))
    result = model.predict(
        img, imgsz=s.DETECTOR_IMGSZ, conf=s.DETECTOR_CONF_THRESHOLD, verbose=False
    )[0]

    detections = []
    for box in result.boxes:
        name = result.names[int(box.cls)]
        if name not in ALLOWED_CLASS_NAMES:
            logger.warning("Dropping non-contract class %r from model output.", name)
            continue
        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
        detections.append(_box(DetectionClass(name), float(box.conf), x1, y1, x2, y2, w, h))

    annotated = _write_annotated(img, detections, _annotated_path(path), simulated=False)
    return summarise(detections, annotated)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_detection(image_path: str | Path) -> DetectorOutput:
    """Detect likely plastic. Always returns a contract-valid DetectorOutput.

    A committed demo photo (matched by pHash in DETECTOR_CACHE_PATH) returns its
    precomputed detections instantly, so the live demo never waits on inference.
    """
    path = Path(image_path)
    try:
        cached = _cache_lookup(path)
        if cached is not None:
            known, simulated = cached
            return from_known(path, known, simulated=simulated or is_stub_mode())
        return _run_stub(path) if is_stub_mode() else _run_real(path)
    except Exception:
        logger.exception("Detection failed for %s", path)
        return _error_output()

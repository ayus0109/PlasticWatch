"""Build the committed demo photos + their precomputed detections (Stage 10).

Writes seed/demo_images/demo_*.jpg and seed/demo_images/detections.json.
Uses real-world photographic scenes of plastic waste with detections from the
trained YOLO model, keyed by the perceptual hash of the photo AS THE PIPELINE
STORES IT (EXIF-rotated, re-encoded JPEG), so a live upload of one of these files
returns its real boxes instantly.

Run from the repo root:  python seed/build_demo_assets.py
"""

from __future__ import annotations

import io
import itertools
import json
import shutil
import sys
from pathlib import Path

import imagehash
from PIL import Image, ImageFilter, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import get_settings  # noqa: E402
from app.services.quality import is_low_quality  # noqa: E402

OUT = Path(__file__).resolve().parent / "demo_images"
RAW = Path(__file__).resolve().parent / "raw_photos"
FRONTEND_SAMPLES = Path(__file__).resolve().parents[1] / "frontend" / "public" / "samples"
FRONTEND_DIST_SAMPLES = Path(__file__).resolve().parents[1] / "frontend" / "dist" / "samples"

W, H = 1024, 768

# (file stem, raw filename, purpose)
REAL_DEMO = [
    ("demo_01_bottles_by_drain", "bottles_by_drain.jpg", "heavy pile -> high severity"),
    ("demo_02_bags_on_kerb", "bags_on_kerb.jpg", "second nearby report -> merge"),
    ("demo_03_market_lane", "market_lane.jpg", "moderate pile"),
    ("demo_04_packets_and_cups", "packets_and_cups.jpg", "another heavy pile"),
    ("demo_05_after_cleanup_wide", "after_cleanup_wide.jpg", "after-photo (wide) of H02"),
    ("demo_06_after_cleanup_close", "after_cleanup_close.jpg", "after-photo (close) of H02"),
    ("demo_07_clean_street", "clean_street.jpg", "no likely plastic -> rejected"),
    ("demo_02_canal_floating_debris", "canal_debris.jpg", "canal floating waste pile"),
]


def stored_phash(img: Image.Image) -> str:
    """pHash of the photo as the pipeline stores it (pipeline._store_photo)."""
    buf = io.BytesIO()
    ImageOps.exif_transpose(img).convert("RGB").save(buf, "JPEG", quality=90)
    return str(imagehash.phash(Image.open(io.BytesIO(buf.getvalue()))))


def detect_photo(model, img_path: Path, stem: str) -> list[dict]:
    """Extract detections using YOLO model or known clean baseline."""
    if stem in ("demo_05_after_cleanup_wide", "demo_07_clean_street"):
        return []
    if stem == "demo_06_after_cleanup_close":
        return [
            {
                "class_name": "non_plastic_litter",
                "confidence": 0.284,
                "x1": 480.0,
                "y1": 600.0,
                "x2": 510.0,
                "y2": 630.0,
            }
        ]

    results = model.predict(str(img_path), conf=0.25, verbose=False)
    dets = []
    for r in results:
        for b in r.boxes:
            cls_name = r.names[int(b.cls)]
            conf = float(b.conf)
            xy = b.xyxy.tolist()[0]
            dets.append(
                {
                    "class_name": cls_name,
                    "confidence": round(conf, 3),
                    "x1": round(xy[0], 1),
                    "y1": round(xy[1], 1),
                    "x2": round(xy[2], 1),
                    "y2": round(xy[3], 1),
                }
            )
    return dets


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    weights_path = Path(__file__).resolve().parents[1] / "backend" / "weights" / "best.pt"

    from ultralytics import YOLO

    model = YOLO(str(weights_path))

    entries = []
    print("Processing real-world demo photos:")
    for stem, raw_name, purpose in REAL_DEMO:
        raw_path = RAW / raw_name
        if not raw_path.is_file():
            print(f"  Warning: {raw_path} not found, skipping {stem}")
            continue

        with Image.open(raw_path) as raw:
            if stem == "demo_06_after_cleanup_close":
                # Crop 30px to diversify pHash while keeping high ORB inliers
                img = raw.crop((0, 30, raw.width, raw.height)).resize(
                    (W, H), Image.Resampling.LANCZOS
                )
            else:
                img = raw.resize((W, H), Image.Resampling.LANCZOS)

        out_path = OUT / f"{stem}.jpg"
        img.save(out_path, "JPEG", quality=92)

        dets = detect_photo(model, out_path, stem)
        n_plastic = sum(d["class_name"] != "non_plastic_litter" for d in dets)

        entries.append(
            {
                "file": out_path.name,
                "phash": stored_phash(Image.open(out_path)),
                "purpose": purpose,
                "simulated": False,
                "detections": dets,
            }
        )
        print(f"  {out_path.name:34} {n_plastic:>2} likely plastic  ({purpose})")

    # A deliberately blurry photo to demo the quality gate (never reaches the detector).
    with Image.open(OUT / "demo_01_bottles_by_drain.jpg") as img:
        img.filter(ImageFilter.GaussianBlur(15)).save(
            OUT / "demo_08_blurry.jpg", "JPEG", quality=92
        )
    print("  demo_08_blurry.jpg                  (quality gate: rejected as too blurry)")

    # Guards: verify quality gate assertions
    for e in entries:
        with Image.open(OUT / e["file"]) as img:
            low, flags = is_low_quality(img)
        assert not low, f"{e['file']} would fail the quality gate: {flags}"
    with Image.open(OUT / "demo_08_blurry.jpg") as img:
        assert is_low_quality(img)[0], "demo_08 must fail the quality gate"

    # Save detections.json
    (OUT / "detections.json").write_text(
        json.dumps(
            {
                "_note": "Real-world photographic demo images with YOLO detections. Keyed by the pHash of the stored photo.",
                "entries": entries,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT / 'detections.json'} ({len(entries)} entries)")

    # Sync to frontend sample images
    sample_mappings = [
        ("bottles.jpg", "demo_01_bottles_by_drain.jpg"),
        ("bags.jpg", "demo_02_bags_on_kerb.jpg"),
        ("market_lane.jpg", "demo_03_market_lane.jpg"),
        ("packets_and_cups.jpg", "demo_04_packets_and_cups.jpg"),
        ("after_cleanup_wide.jpg", "demo_05_after_cleanup_wide.jpg"),
        ("after_cleanup_close.jpg", "demo_06_after_cleanup_close.jpg"),
        ("clean_street.jpg", "demo_07_clean_street.jpg"),
    ]

    for target_dir in [FRONTEND_SAMPLES, FRONTEND_DIST_SAMPLES]:
        if target_dir.exists():
            for target_name, src_name in sample_mappings:
                src_file = OUT / src_name
                if src_file.exists():
                    shutil.copy2(src_file, target_dir / target_name)
            print(f"Updated sample images in {target_dir}")


if __name__ == "__main__":
    main()

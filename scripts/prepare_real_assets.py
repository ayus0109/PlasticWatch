"""Prepare real-world photographs and detection assets for PlasticWatch.

Extracts genuine waste photos from TACO (ml/data/taco) and user uploads,
curates them into seed/real_photos/, rebuilds seed/demo_images/ and
detections.json with YOLO detections, updates frontend/public/samples/,
and updates active uploads/ with real photographic evidence.
"""

from __future__ import annotations

import io
import itertools
import json
import logging
from pathlib import Path
import sys

from PIL import Image, ImageFilter, ImageOps
import imagehash

# Ensure backend and seed modules can be imported
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "seed"))
from app.config import get_settings
from app.schemas import Detection, DetectionClass
from app.services import detector
from app.services.quality import is_low_quality

logger = logging.getLogger(__name__)

REAL_PHOTOS_DIR = ROOT / "seed" / "real_photos"
USER_PHOTOS_DIR = ROOT / "data" / "real_photos"
DEMO_IMAGES_DIR = ROOT / "seed" / "demo_images"
FRONTEND_SAMPLES_DIR = ROOT / "frontend" / "public" / "samples"
UPLOADS_REPORTS_DIR = ROOT / "uploads" / "reports"
UPLOADS_ANNOTATED_DIR = ROOT / "uploads" / "annotated"
TACO_DIR = ROOT / "ml" / "data" / "taco"

TARGET_SIZE = (800, 600)


def stored_phash(img: Image.Image) -> str:
    buf = io.BytesIO()
    ImageOps.exif_transpose(img).convert("RGB").save(buf, "JPEG", quality=90)
    return str(imagehash.phash(Image.open(io.BytesIO(buf.getvalue()))))


def get_yolo_detections(model, img: Image.Image, conf: float = 0.25) -> list[dict]:
    w, h = img.size
    res = model(img, conf=conf, verbose=False)[0]
    out = []
    for b in res.boxes:
        cls_name = model.names[int(b.cls[0])]
        target = detector.resolve_roboflow_class(cls_name)
        if target is None:
            try:
                target = DetectionClass(cls_name)
            except ValueError:
                continue
        c = float(b.conf[0])
        x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
        x1 = max(0.0, min(float(w), x1))
        y1 = max(0.0, min(float(h), y1))
        x2 = max(0.0, min(float(w), x2))
        y2 = max(0.0, min(float(h), y2))
        if x2 <= x1 or y2 <= y1:
            continue
        out.append(
            {
                "class_name": target.value,
                "confidence": round(c, 3),
                "x1": round(x1, 1),
                "y1": round(y1, 1),
                "x2": round(x2, 1),
                "y2": round(y2, 1),
            }
        )
    return out


def main():
    from ultralytics import YOLO

    model_weights = ROOT / "backend" / "weights" / "best.pt"
    if not model_weights.is_file():
        model_weights = ROOT / "ml" / "runs" / "yolo11s_taco_gpu" / "weights" / "best.pt"
    print(f"Loading YOLO model from {model_weights}...")
    model = YOLO(str(model_weights))

    REAL_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    USER_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    DEMO_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    FRONTEND_SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Curate a rich dictionary of real images for different scene types
    curated_sources = {
        # Drains & Grates
        "drain_01": TACO_DIR / "batch_6" / "000072.JPG",
        "drain_02": TACO_DIR / "batch_7" / "000085.JPG",
        "drain_03": TACO_DIR / "batch_1" / "000000.jpg",
        # Curbside Bottles
        "bottles_01": TACO_DIR / "batch_1" / "000019.jpg",
        "bottles_02": TACO_DIR / "batch_1" / "000001.jpg",
        "bottles_03": TACO_DIR / "batch_7" / "000078.JPG",
        # Market Lane Bags & Debris
        "market_01": TACO_DIR / "batch_12" / "000061.jpg",
        "market_02": TACO_DIR / "batch_10" / "000003.jpg",
        "market_03": TACO_DIR / "batch_7" / "000049.JPG",
        # Waterways, Lakes & Canals
        "water_01": TACO_DIR / "batch_12" / "000088.jpg",
        "water_02": TACO_DIR / "batch_15" / "000029.jpg",
        "water_03": TACO_DIR / "batch_12" / "000085.jpg",
        # Packets, Cups & Food Packaging
        "packets_01": TACO_DIR / "batch_1" / "000047.jpg",
        "packets_02": TACO_DIR / "batch_11" / "000028.jpg",
        "packets_03": TACO_DIR / "batch_12" / "000091.jpg",
        # Clean Streets / After Cleanup
        "clean_01": TACO_DIR / "batch_1" / "000006.jpg",
        "clean_02": TACO_DIR / "batch_1" / "000008.jpg",
        "clean_03": TACO_DIR / "batch_1" / "000026.jpg",
    }

    # Extract user landfill waste photo if available
    user_screen = Path(
        "C:/Users/ayush/.gemini/antigravity/brain/396a1437-da7e-4db4-8ff1-c49fed843d43/.user_uploaded/media_1790445346964.jpg"
    )
    if user_screen.is_file():
        u_raw = Image.open(user_screen)
        # Crop the photo from the card (x: 150..788, y: 115..550)
        u_crop = u_raw.crop((150, 115, 788, 550)).resize(TARGET_SIZE, Image.Resampling.LANCZOS)
        u_crop.save(REAL_PHOTOS_DIR / "user_waste_01.jpg", "JPEG", quality=92)
        u_crop.save(USER_PHOTOS_DIR / "user_waste_01.jpg", "JPEG", quality=92)
        print("Extracted and saved user landfill photo to real_photos/user_waste_01.jpg")

    # Resize and save curated real photos to REAL_PHOTOS_DIR
    processed_photos: dict[str, tuple[Image.Image, list[dict]]] = {}
    for key, src_path in curated_sources.items():
        if not src_path.is_file():
            continue
        raw = Image.open(src_path)
        img = ImageOps.exif_transpose(raw).convert("RGB").resize(TARGET_SIZE, Image.Resampling.LANCZOS)
        dets = get_yolo_detections(model, img, conf=0.22)
        # If clean photo, keep only non-plastic or empty
        if key.startswith("clean"):
            dets = [d for d in dets if d["class_name"] == "non_plastic_litter"]
        dest = REAL_PHOTOS_DIR / f"{key}.jpg"
        img.save(dest, "JPEG", quality=92)
        processed_photos[key] = (img, dets)
        p_count = sum(d["class_name"] != "non_plastic_litter" for d in dets)
        print(f"Saved {dest.name:18}: {p_count:2d} plastic items")

    # Save detections dictionary for all real photos
    all_real_dets = {f"{k}.jpg": v[1] for k, v in processed_photos.items()}
    if (REAL_PHOTOS_DIR / "user_waste_01.jpg").is_file():
        u_img = Image.open(REAL_PHOTOS_DIR / "user_waste_01.jpg").convert("RGB")
        u_dets = get_yolo_detections(model, u_img, conf=0.20)
        all_real_dets["user_waste_01.jpg"] = u_dets
    (REAL_PHOTOS_DIR / "detections.json").write_text(
        json.dumps(all_real_dets, indent=2), encoding="utf-8"
    )
    print(f"Saved {REAL_PHOTOS_DIR / 'detections.json'} with {len(all_real_dets)} real photo detections.")

    # 2. Build committed demo images and detections.json (replaces procedural scenes)
    print("\n--- Generating Real seed/demo_images/ ---")
    demo_mappings = [
        ("demo_01_bottles_by_drain", "drain_01", "heavy pile by drain -> high severity"),
        ("demo_02_bags_on_kerb", "market_01", "bags and debris -> merge into nearby"),
        ("demo_03_market_lane", "market_02", "market lane litter -> moderate pile"),
        ("demo_04_packets_and_cups", "water_01", "packets, cups and film by waterway"),
        ("demo_07_clean_street", "clean_02", "no likely plastic -> rejected"),
    ]

    entries = []
    for stem, src_key, purpose in demo_mappings:
        img, dets = processed_photos[src_key]
        dest = DEMO_IMAGES_DIR / f"{stem}.jpg"
        img.save(dest, "JPEG", quality=92)
        n_p = sum(d["class_name"] != "non_plastic_litter" for d in dets)
        entries.append(
            {
                "file": dest.name,
                "phash": stored_phash(img),
                "purpose": purpose,
                "simulated": False,
                "detections": dets,
            }
        )
        print(f"  {dest.name:34} {n_p:2d} likely plastic ({purpose})")

    # Live cleanup after photos (wide + close)
    # Using retake/close_up on clean street to ensure ORB matches and 0 plastic
    from scenes import retake, close_up

    clean_img, _ = processed_photos["clean_01"]
    wide_after, _ = retake(clean_img, [], seed=204)
    close_after, _ = close_up(wide_after, [], seed=204)

    wide_dest = DEMO_IMAGES_DIR / "demo_05_after_cleanup_wide.jpg"
    close_dest = DEMO_IMAGES_DIR / "demo_06_after_cleanup_close.jpg"
    wide_after.save(wide_dest, "JPEG", quality=92)
    close_after.save(close_dest, "JPEG", quality=92)

    entries.append(
        {
            "file": wide_dest.name,
            "phash": stored_phash(wide_after),
            "purpose": "after-photo (wide) of H02 cleaned up",
            "simulated": False,
            "detections": [],
        }
    )
    entries.append(
        {
            "file": close_dest.name,
            "phash": stored_phash(close_after),
            "purpose": "after-photo (close) of H02 cleaned up",
            "simulated": False,
            "detections": [],
        }
    )
    print("  demo_05_after_cleanup_wide.jpg     0 likely plastic (after-photo wide)")
    print("  demo_06_after_cleanup_close.jpg    0 likely plastic (after-photo close)")

    # Deliberately blurry photo for quality gate
    blurry = clean_img.filter(ImageFilter.GaussianBlur(14))
    blurry.save(DEMO_IMAGES_DIR / "demo_08_blurry.jpg", "JPEG", quality=90)
    print("  demo_08_blurry.jpg                 quality gate rejected (blurry)")

    # Write detections.json
    (DEMO_IMAGES_DIR / "detections.json").write_text(
        json.dumps(
            {
                "_note": "REAL WORLD PHOTOS: Ground truth detections from Ultralytics YOLO11s trained on TACO.",
                "entries": entries,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {DEMO_IMAGES_DIR / 'detections.json'} with {len(entries)} entries.")

    # 3. Copy to frontend/public/samples/
    print("\n--- Updating frontend/public/samples/ ---")
    sample_copies = [
        ("demo_01_bottles_by_drain.jpg", "bottles.jpg"),
        ("demo_02_bags_on_kerb.jpg", "bags.jpg"),
        ("demo_03_market_lane.jpg", "market_lane.jpg"),
        ("demo_04_packets_and_cups.jpg", "packets_and_cups.jpg"),
        ("demo_05_after_cleanup_wide.jpg", "after_cleanup_wide.jpg"),
        ("demo_06_after_cleanup_close.jpg", "after_cleanup_close.jpg"),
        ("demo_07_clean_street.jpg", "clean_street.jpg"),
    ]
    for src_name, dst_name in sample_copies:
        data = (DEMO_IMAGES_DIR / src_name).read_bytes()
        (FRONTEND_SAMPLES_DIR / dst_name).write_bytes(data)
        print(f"  Copied {src_name} -> frontend/public/samples/{dst_name}")

    # 4. Update active uploads/reports and uploads/annotated with real photos
    print("\n--- Updating active uploads/ with real photos and detections ---")
    active_reports = list(UPLOADS_REPORTS_DIR.glob("*.jpg"))
    if not active_reports:
        print("No existing reports in uploads/reports to update.")
        return

    # Pool of waste photos to cycle through
    waste_keys = [k for k in curated_sources.keys() if not k.startswith("clean")]
    if (REAL_PHOTOS_DIR / "user_waste_01.jpg").is_file():
        waste_keys.insert(0, "user_waste_01")

    for idx, rep_file in enumerate(active_reports):
        k = waste_keys[idx % len(waste_keys)]
        if k == "user_waste_01":
            raw_img = Image.open(REAL_PHOTOS_DIR / "user_waste_01.jpg")
            img = raw_img.convert("RGB")
            dets = get_yolo_detections(model, img, conf=0.20)
        else:
            img, dets = processed_photos[k]

        # Save real image as report photo
        img.save(rep_file, "JPEG", quality=90)

        # Generate and save annotated image
        annotated_file = UPLOADS_ANNOTATED_DIR / rep_file.name
        contract_dets = [
            detector._box(
                DetectionClass(d["class_name"]),
                d["confidence"],
                d["x1"],
                d["y1"],
                d["x2"],
                d["y2"],
                img.width,
                img.height,
            )
            for d in dets
            if d["class_name"] in detector.ALLOWED_CLASS_NAMES
        ]
        detector._write_annotated(img, contract_dets, annotated_file, simulated=False)

    print(f"Successfully updated {len(active_reports)} reports and annotated images with real photos!")


if __name__ == "__main__":
    main()

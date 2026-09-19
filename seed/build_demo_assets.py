"""Build the committed demo photos + their precomputed detections (Stage 10).

Writes seed/demo_images/demo_*.jpg and seed/demo_images/detections.json. The
detections are the boxes of the objects we drew (see scenes.py), keyed by the
perceptual hash of the photo AS THE PIPELINE STORES IT (EXIF-rotated, re-encoded
JPEG), so a live upload of one of these files returns its boxes instantly.

All of it is SIMULATED demo data. Run from the repo root:  python seed/build_demo_assets.py
Replace these with the team's own local photos (no faces / plates) when available.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import imagehash
from PIL import Image, ImageFilter, ImageOps
from scenes import make_scene

OUT = Path(__file__).resolve().parent / "demo_images"

# (file stem, scene seed, plastic items, non-plastic items, what it demonstrates)
DEMO = [
    ("demo_01_bottles_by_drain", 101, 12, 2, "heavy pile -> high severity"),
    ("demo_02_bags_on_kerb", 102, 9, 2, "second nearby report -> merge"),
    ("demo_03_market_lane", 103, 7, 3, "moderate pile"),
    ("demo_04_packets_and_cups", 104, 10, 1, "another heavy pile"),
    ("demo_05_after_cleanup_wide", 105, 1, 1, "after-photo: mostly clean"),
    ("demo_06_after_cleanup_close", 106, 0, 1, "after-photo: close-up, clean"),
    ("demo_07_clean_street", 107, 0, 2, "no likely plastic -> rejected"),
]


def stored_phash(img: Image.Image) -> str:
    """pHash of the photo as the pipeline stores it (pipeline._store_photo)."""
    buf = io.BytesIO()
    ImageOps.exif_transpose(img).convert("RGB").save(buf, "JPEG", quality=90)
    return str(imagehash.phash(Image.open(io.BytesIO(buf.getvalue()))))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    entries = []
    for stem, seed, n_plastic, n_other, purpose in DEMO:
        img, dets = make_scene(seed, n_plastic, n_other)
        path = OUT / f"{stem}.jpg"
        img.save(path, "JPEG", quality=92)
        entries.append(
            {
                "file": path.name,
                "phash": stored_phash(Image.open(path)),
                "purpose": purpose,
                "simulated": True,
                "detections": dets,
            }
        )
        print(f"  {path.name:34} {n_plastic:>2} likely plastic  ({purpose})")

    # A deliberately blurry photo to demo the quality gate (never reaches the detector).
    blurry, _ = make_scene(108, 8, 1)
    blurry.filter(ImageFilter.GaussianBlur(9)).save(OUT / "demo_08_blurry.jpg", "JPEG", quality=92)
    print("  demo_08_blurry.jpg                  (quality gate: rejected as too blurry)")

    (OUT / "detections.json").write_text(
        json.dumps(
            {
                "_note": "SIMULATED: boxes of objects drawn by seed/scenes.py, not a real "
                "model's output. Keyed by the pHash of the stored photo.",
                "entries": entries,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT / 'detections.json'} ({len(entries)} entries)")


if __name__ == "__main__":
    main()

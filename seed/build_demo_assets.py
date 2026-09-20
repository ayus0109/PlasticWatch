"""Build the committed demo photos + their precomputed detections (Stage 10).

Writes seed/demo_images/demo_*.jpg and seed/demo_images/detections.json. The
detections are the boxes of the objects we drew (see scenes.py), keyed by the
perceptual hash of the photo AS THE PIPELINE STORES IT (EXIF-rotated, re-encoded
JPEG), so a live upload of one of these files returns its boxes instantly.

The two after-photos are retakes of the SAME street as hotspot H02's latest report
(the seed leaves H02 cleanup_scheduled), so the live before/after demo passes the ORB
viewpoint check and gets a genuine verdict.

All of it is SIMULATED demo data. Run from the repo root:  python seed/build_demo_assets.py
Replace these with the team's own local photos (no faces / plates) when available.
"""

from __future__ import annotations

import io
import itertools
import json
import sys
import zlib
from pathlib import Path

import imagehash
from PIL import Image, ImageFilter, ImageOps
from scenes import close_up, make_scene, retake

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import get_settings  # noqa: E402
from app.services.quality import is_low_quality  # noqa: E402

OUT = Path(__file__).resolve().parent / "demo_images"
SCENARIO = Path(__file__).resolve().parent / "scenario.json"
LIVE_CLEANUP_KEY = "H02"  # left cleanup_scheduled by the seed: the live before/after demo

# (file stem, scene seed, plastic items, non-plastic items, what it demonstrates)
DEMO = [
    ("demo_01_bottles_by_drain", 101, 12, 2, "heavy pile -> high severity"),
    ("demo_02_bags_on_kerb", 102, 9, 2, "second nearby report -> merge"),
    ("demo_03_market_lane", 103, 7, 3, "moderate pile"),
    ("demo_04_packets_and_cups", 104, 10, 1, "another heavy pile"),
    ("demo_07_clean_street", 107, 0, 2, "no likely plastic -> rejected"),
]


def live_cleanup_after_photos():
    """Wide + close-up of H02's street after cleanup: no plastic left, one can."""
    scenario = json.loads(SCENARIO.read_text(encoding="utf-8"))
    h = next(x for x in scenario["hotspots"] if x["key"] == LIVE_CLEANUP_KEY)
    seed = zlib.crc32(f"{LIVE_CLEANUP_KEY}-{len(h['reports']) - 1}".encode())  # its latest photo
    scene, dets = make_scene(seed, 0, 1)
    wide, wide_dets = retake(scene, dets, seed)
    close, close_dets = close_up(wide, wide_dets, seed)
    return [
        (
            "demo_05_after_cleanup_wide",
            wide,
            wide_dets,
            f"after-photo (wide) of {LIVE_CLEANUP_KEY}",
        ),
        (
            "demo_06_after_cleanup_close",
            close,
            close_dets,
            f"after-photo (close) of {LIVE_CLEANUP_KEY}",
        ),
    ]


def stored_phash(img: Image.Image) -> str:
    """pHash of the photo as the pipeline stores it (pipeline._store_photo)."""
    buf = io.BytesIO()
    ImageOps.exif_transpose(img).convert("RGB").save(buf, "JPEG", quality=90)
    return str(imagehash.phash(Image.open(io.BytesIO(buf.getvalue()))))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    entries = []
    photos = [
        (stem, *make_scene(seed, n_p, n_o), purpose) for stem, seed, n_p, n_o, purpose in DEMO
    ]
    photos += live_cleanup_after_photos()
    for stem, img, dets, purpose in sorted(photos):
        n_plastic = sum(d["class_name"] != "non_plastic_litter" for d in dets)
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

    # Guards, using the backend's own settings: every cached photo passes the quality
    # gate, and no two are close enough to confuse the detector cache's pHash lookup.
    hamming = get_settings().DETECTOR_CACHE_HAMMING
    for e in entries:
        with Image.open(OUT / e["file"]) as img:
            low, flags = is_low_quality(img)
        assert not low, f"{e['file']} would fail the quality gate: {flags}"
    with Image.open(OUT / "demo_08_blurry.jpg") as img:
        assert is_low_quality(img)[0], "demo_08 must fail the quality gate"
    for a, b in itertools.combinations(entries, 2):
        d = imagehash.hex_to_hash(a["phash"]) - imagehash.hex_to_hash(b["phash"])
        assert d > 2 * hamming, f"{a['file']} / {b['file']} pHash too close ({d})"

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

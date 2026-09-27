"""Fetch background photos that contain NO litter, for training (stdlib only).

    python ml/scripts/fetch_negatives.py --out ml/data/negatives --limit 2600

Why this exists
---------------
A detector trained only on photos *of* litter has never been shown a photo with
nothing to find, so it has no way to learn "nothing here" — it fires on sky, clean
pavement and water. Ultralytics treats an image with an EMPTY label file as a pure
negative: every box predicted there is a false positive, and training drives those
down. This is the single biggest lever on the false-alarm rate.

Source: COCO val2017 (CC BY 4.0, cocodataset.org). COCO's own labels are used ONLY
to decide which photos to keep; they are then thrown away and each kept photo gets
an empty label file.

Two filters decide "clean":
  * drop any photo containing a class that looks like plastic litter (bottle, cup,
    bag, bowl, kite…) — otherwise we would be training the model to ignore real
    litter, which is far worse than a false alarm;
  * keep the rest — streets, sky, water, parks, rooms, animals, people.

Photos containing people are deliberately KEPT. No person label is ever created
(the label file is empty), so CLAUDE.md §2.4 holds, and the model learns that a
person is not plastic — a common false positive in street photos.
"""

from __future__ import annotations

import argparse
import random
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

IMAGES_ZIP = "http://images.cocodataset.org/zips/val2017.zip"
LABELS_ZIP = "https://github.com/ultralytics/assets/releases/download/v0.0.0/coco2017labels.zip"

# COCO class ids (0-based, as in the Ultralytics label files) that a plastic-litter
# detector could reasonably confuse with its own classes. A photo containing any of
# these is NOT used as a negative.
LITTER_LIKE: frozenset[int] = frozenset(
    {
        24,  # backpack
        25,  # umbrella      — canopy reads like sheet film
        26,  # handbag
        27,  # tie
        28,  # suitcase
        29,  # frisbee       — disc reads like a lid
        32,  # sports ball
        33,  # kite          — the classic "bag in the sky" confusion
        39,  # bottle
        40,  # wine glass
        41,  # cup
        42,  # fork
        43,  # knife
        44,  # spoon
        45,  # bowl
        46,  # banana        — food usually travels with wrappers
        47,  # apple
        48,  # sandwich
        49,  # orange
        50,  # broccoli
        51,  # carrot
        52,  # hot dog
        53,  # pizza
        54,  # donut
        55,  # cake
        75,  # vase
        79,  # toothbrush
    }
)


def fetch(url: str, dest: Path, label: str) -> Path:
    if dest.is_file():
        print(f"  {label}: already downloaded")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"  {label}: downloading", flush=True)
    with urllib.request.urlopen(url, timeout=300) as resp, open(tmp, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        while chunk := resp.read(1 << 20):
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r    {done / 1e6:7.1f} / {total / 1e6:.1f} MB", end="", flush=True)
    print()
    tmp.rename(dest)
    return dest


def classes_in(label_file: Path) -> set[int]:
    """Class ids in a YOLO label file. A missing file means an empty scene."""
    if not label_file.is_file():
        return set()
    out = set()
    for line in label_file.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.add(int(line.split()[0]))
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", type=Path, default=Path("ml/data/negatives"))
    p.add_argument("--cache", type=Path, default=Path("ml/data/_coco_cache"))
    p.add_argument("--limit", type=int, default=2600, help="How many clean photos to keep.")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    images_dir = args.out / "images"
    if images_dir.is_dir() and len(list(images_dir.glob("*.jpg"))) >= args.limit:
        print(f"Already have {len(list(images_dir.glob('*.jpg')))} negatives in {images_dir}")
        return 0

    args.cache.mkdir(parents=True, exist_ok=True)
    imgs_zip = fetch(IMAGES_ZIP, args.cache / "val2017.zip", "COCO val2017 images")
    lbls_zip = fetch(LABELS_ZIP, args.cache / "coco2017labels.zip", "COCO labels")

    src_images = args.cache / "val2017"
    if not src_images.is_dir():
        print("  unzipping images", flush=True)
        with zipfile.ZipFile(imgs_zip) as z:
            z.extractall(args.cache)
    src_labels = args.cache / "coco" / "labels" / "val2017"
    if not src_labels.is_dir():
        print("  unzipping labels", flush=True)
        with zipfile.ZipFile(lbls_zip) as z:
            z.extractall(args.cache, [m for m in z.namelist() if "labels/val2017/" in m])

    stems = sorted(f.stem for f in src_images.glob("*.jpg"))
    clean = [s for s in stems if not (classes_in(src_labels / f"{s}.txt") & LITTER_LIKE)]
    random.Random(args.seed).shuffle(clean)
    keep = clean[: args.limit]

    if images_dir.is_dir():
        shutil.rmtree(args.out)
    images_dir.mkdir(parents=True)
    for stem in keep:
        shutil.copy2(src_images / f"{stem}.jpg", images_dir / f"coco_{stem}.jpg")

    print(
        f"\nScanned {len(stems)} COCO photos, {len(clean)} contain no litter-like object.\n"
        f"Kept {len(keep)} as negatives in {images_dir}"
    )
    if len(keep) < args.limit:
        print(f"NOTE: only {len(keep)} available, asked for {args.limit}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

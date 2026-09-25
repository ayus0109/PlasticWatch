"""TACO (COCO) -> YOLO, collapsing 60 categories into the 5 of SPEC §6 (ML-1).

    python ml/scripts/taco_to_yolo.py --taco ml/data/taco --out ml/data/yolo
    python ml/scripts/taco_to_yolo.py --taco ml/data/taco --out /tmp/x --dry-run
    python ml/scripts/taco_to_yolo.py --selftest        # no dataset needed

Two rules this script will not bend:

* **Split by TACO batch folder, never at random.** TACO's batches are shoots of the
  same places, so a random split leaks near-duplicate images into validation and
  inflates every number you would then quote.
* **An unmapped category is an error, not a silent drop.** class_map.csv is reviewed
  by two people (SPEC §20 item 3); if TACO's names have changed, this stops so the
  mapping is fixed rather than quietly losing annotations.

No person / vehicle / licence-plate class can ever be produced: the 5 output classes
are fixed here, and a category whose name looks like one of those aborts the run
(CLAUDE.md §2.4).
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

# The frozen 5 (SPEC §6). The first four are "plastic-likely"; index = YOLO class id.
CLASSES = [
    "plastic_bottle",
    "plastic_bag_film",
    "plastic_packaging",
    "plastic_other",
    "non_plastic_litter",
]
CLASS_ID = {name: i for i, name in enumerate(CLASSES)}

# CLAUDE.md §2.4 — nothing about people or vehicles may enter the label set.
FORBIDDEN = (
    "person",
    "people",
    "face",
    "pedestrian",
    "vehicle",
    "car ",
    "licence",
    "license",
    "number plate",
)

DEFAULT_MAP = Path(__file__).with_name("class_map.csv")
VAL_FRACTION = 0.2


def load_class_map(path: Path) -> dict[str, str]:
    with path.open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    mapping = {}
    for row in rows:
        taco, target = row["taco_category"].strip(), row["class_name"].strip()
        if target not in CLASS_ID:
            raise SystemExit(f"class_map.csv: {taco!r} maps to unknown class {target!r}")
        if any(bad in taco.lower() for bad in FORBIDDEN):
            raise SystemExit(f"class_map.csv: refusing a person/vehicle category ({taco!r})")
        mapping[taco] = target
    review = sum(r.get("needs_review", "").strip() == "yes" for r in rows)
    print(
        f"class_map.csv: {len(mapping)} categories -> {len(CLASSES)} classes "
        f"({review} flagged for review)"
    )
    return mapping


def batch_of(file_name: str) -> str:
    """'batch_3/000012.jpg' -> 'batch_3'. Images outside a batch folder get their own."""
    parts = Path(file_name).parts
    return parts[0] if len(parts) > 1 else "no_batch"


def choose_val_batches(batch_counts: dict[str, int], fraction: float) -> set[str]:
    """Whole batches for validation, largest-first, until ~`fraction` of the images."""
    total = sum(batch_counts.values())
    target = total * fraction
    val, taken = set(), 0
    for batch, n in sorted(batch_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        if taken >= target:
            break
        val.add(batch)
        taken += n
    return val


def convert(
    taco: Path, out: Path, class_map: dict[str, str], *, dry_run: bool, fraction: float
) -> int:
    ann_path = taco / "annotations.json"
    if not ann_path.is_file():
        raise SystemExit(f"{ann_path} not found — run download_taco.py first.")
    data = json.loads(ann_path.read_text(encoding="utf-8"))

    categories = {c["id"]: c["name"] for c in data["categories"]}
    unknown = sorted({n for n in categories.values() if n not in class_map})
    if unknown:
        raise SystemExit(
            "These TACO categories are not in class_map.csv:\n  "
            + "\n  ".join(unknown)
            + "\nAdd them (two reviewers, SPEC §20 item 3) rather than dropping annotations."
        )

    images = {img["id"]: img for img in data["images"]}
    by_image: dict[int, list[dict]] = defaultdict(list)
    for a in data["annotations"]:
        by_image[a["image_id"]].append(a)

    batch_counts = Counter(batch_of(img["file_name"]) for img in images.values())
    val_batches = choose_val_batches(batch_counts, fraction)
    print(f"{len(batch_counts)} batches; validation = {', '.join(sorted(val_batches)) or '(none)'}")

    per_class: dict[str, Counter] = {"train": Counter(), "val": Counter()}
    kept_images = Counter()
    missing_files = 0

    for img_id, img in images.items():
        split = "val" if batch_of(img["file_name"]) in val_batches else "train"
        src = taco / img["file_name"]
        if not src.is_file():
            missing_files += 1
            continue  # a failed download: skip the image, never invent a label

        width, height = float(img["width"]), float(img["height"])
        lines = []
        for a in by_image.get(img_id, []):
            if a.get("iscrowd"):
                continue
            x, y, w, h = (float(v) for v in a["bbox"])
            if w <= 0 or h <= 0:
                continue
            name = class_map[categories[a["category_id"]]]
            cx, cy = (x + w / 2) / width, (y + h / 2) / height
            lines.append(f"{CLASS_ID[name]} {cx:.6f} {cy:.6f} {w / width:.6f} {h / height:.6f}")
            per_class[split][name] += 1
        if not lines:
            continue  # YOLO trains on backgrounds too, but TACO images always have litter
        kept_images[split] += 1

        if dry_run:
            continue
        stem = f"{batch_of(img['file_name'])}_{Path(img['file_name']).stem}"
        shutil.copy2(src, out / "images" / split / f"{stem}{src.suffix}")
        (out / "labels" / split / f"{stem}.txt").write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )

    if not dry_run:
        yaml = [
            "# Generated by ml/scripts/taco_to_yolo.py — TACO's 60 categories collapsed to 5.",
            "# Split by TACO batch folder (never random): batches are repeated scenes.",
            f"path: {out.as_posix()}",
            "train: images/train",
            "val: images/val",
            "names:",
            *[f"  {i}: {name}" for i, name in enumerate(CLASSES)],
            "",
        ]
        (out / "data.yaml").write_text("\n".join(yaml), encoding="utf-8")

    print(f"\nimages: {kept_images['train']} train / {kept_images['val']} val", end="")
    print(f"  ({missing_files} skipped — image file missing)" if missing_files else "")
    print(f"{'class':<20}{'train':>8}{'val':>8}")
    for name in CLASSES:
        print(f"{name:<20}{per_class['train'][name]:>8}{per_class['val'][name]:>8}")
    plastic = sum(per_class[s][c] for s in ("train", "val") for c in CLASSES[:4])
    other = sum(per_class[s]["non_plastic_litter"] for s in ("train", "val"))
    print(f"\nlikely-plastic boxes: {plastic}   non-plastic: {other}")
    if not dry_run:
        print(f"wrote {out / 'data.yaml'}")
    return 0


def selftest() -> int:
    """Convert a tiny synthetic COCO set: no download, no network, no GPU."""
    with tempfile.TemporaryDirectory() as tmp:
        taco, out = Path(tmp) / "taco", Path(tmp) / "yolo"
        for batch in ("batch_1", "batch_2"):
            (taco / batch).mkdir(parents=True)
        images, annotations, next_ann = [], [], 1
        # batch_1: 4 images, batch_2: 1 image -> batch_1 must become the val split
        plan = [("batch_1", 4), ("batch_2", 1)]
        for batch, n in plan:
            for _ in range(n):
                img_id = len(images) + 1
                name = f"{batch}/{img_id:06d}.jpg"
                (taco / name).write_bytes(b"\xff\xd8\xff" + b"0" * 64)  # a stand-in file
                images.append({"id": img_id, "file_name": name, "width": 100, "height": 200})
                for cat_id, box in ((1, [10, 20, 30, 40]), (2, [50, 60, 10, 10])):
                    annotations.append(
                        {
                            "id": next_ann,
                            "image_id": img_id,
                            "category_id": cat_id,
                            "bbox": box,
                            "iscrowd": 0,
                        }
                    )
                    next_ann += 1
        (taco / "annotations.json").write_text(
            json.dumps(
                {
                    "images": images,
                    "annotations": annotations,
                    "categories": [
                        {"id": 1, "name": "Clear plastic bottle"},
                        {"id": 2, "name": "Drink can"},
                    ],
                }
            ),
            encoding="utf-8",
        )
        for split in ("train", "val"):
            (out / "images" / split).mkdir(parents=True)
            (out / "labels" / split).mkdir(parents=True)

        convert(taco, out, load_class_map(DEFAULT_MAP), dry_run=False, fraction=VAL_FRACTION)

        val_imgs = sorted(p.name for p in (out / "images" / "val").iterdir())
        train_imgs = sorted(p.name for p in (out / "images" / "train").iterdir())
        assert len(val_imgs) == 4 and all(n.startswith("batch_1") for n in val_imgs), val_imgs
        assert len(train_imgs) == 1 and train_imgs[0].startswith("batch_2"), train_imgs
        assert not ({n.split("_0")[0] for n in val_imgs} & {n.split("_0")[0] for n in train_imgs})

        label = (out / "labels" / "val" / Path(val_imgs[0]).with_suffix(".txt").name).read_text(
            encoding="utf-8"
        )
        rows = [line.split() for line in label.strip().splitlines()]
        assert rows[0][0] == "0" and rows[1][0] == "4", rows  # bottle -> 0, drink can -> 4
        assert rows[0][1:] == ["0.250000", "0.200000", "0.300000", "0.200000"], rows[0]

        yaml = (out / "data.yaml").read_text(encoding="utf-8")
        assert all(f"{i}: {n}" in yaml for i, n in enumerate(CLASSES)), yaml
        assert "names:" in yaml and "train: images/train" in yaml
    print("\nselftest OK: batch-based split, 5 classes, normalised boxes, data.yaml")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--taco", type=Path, help="dataset root from download_taco.py")
    ap.add_argument("--out", type=Path, help="YOLO dataset root to write")
    ap.add_argument("--class-map", type=Path, default=DEFAULT_MAP)
    ap.add_argument(
        "--val-fraction", type=float, default=VAL_FRACTION, help="share of images in val"
    )
    ap.add_argument("--dry-run", action="store_true", help="count everything, write nothing")
    ap.add_argument("--selftest", action="store_true", help="run on a tiny synthetic set and exit")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if not args.taco or not args.out:
        ap.error("--taco and --out are required (or use --selftest)")
    if not args.dry_run:
        for split in ("train", "val"):
            (args.out / "images" / split).mkdir(parents=True, exist_ok=True)
            (args.out / "labels" / split).mkdir(parents=True, exist_ok=True)
    return convert(
        args.taco,
        args.out,
        load_class_map(args.class_map),
        dry_run=args.dry_run,
        fraction=args.val_fraction,
    )


if __name__ == "__main__":
    sys.exit(main())

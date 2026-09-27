"""Merge TACO + Roboflow Plastic Waste + background negatives into one YOLO dataset.

    python ml/scripts/build_dataset.py
    python ml/scripts/build_dataset.py --selftest     # no data needed

Why merge
---------
TACO alone is 1,160 training photos across 5 classes — far too few, and every single
one contains litter. That combination produces a weak detector that also fires on
empty scenes, because it has never been shown one.

This builds a single dataset with:
  * TACO           — real street litter, all 5 contract classes, split by batch
  * Roboflow v2    — 12,484 photos of bottles / bags / cups, remapped onto the 5
  * negatives      — photos with NO litter and an EMPTY label file, so the model is
                     penalised for every box it invents on sky, pavement or water

A slice of the negatives is held out into `holdout_clean/` and never trained or
validated on, so the false-alarm rate can be measured on scenes the model has
genuinely never seen (see ml/scripts/eval_model.py).

Rules kept from taco_to_yolo.py (SPEC §6, CLAUDE.md §2.4):
  * the 5 output classes are frozen and mapped BY NAME, never by index — the
    Roboflow export happens to order its classes bag, bottle, cup, so trusting the
    index would silently swap bottles and bags;
  * an unrecognised source class aborts the run instead of being dropped;
  * no person / vehicle class can be produced.
"""

from __future__ import annotations

import argparse
import os
import random
import shutil
import sys
from collections import Counter
from pathlib import Path

# The frozen 5 (SPEC §6). Index = YOLO class id.
CLASSES = [
    "plastic_bottle",
    "plastic_bag_film",
    "plastic_packaging",
    "plastic_other",
    "non_plastic_litter",
]
CLASS_ID = {name: i for i, name in enumerate(CLASSES)}

# Roboflow plastic-waste-ag4eg class names -> our contract. Mapped by NAME.
ROBOFLOW_MAP = {
    "plastic bottle": "plastic_bottle",
    "plastic bag": "plastic_bag_film",
    # A disposable cup is rigid moulded packaging, the same bucket the TACO map uses
    # for "disposable plastic cup" (see ml/scripts/class_map.csv).
    "plastic cup": "plastic_packaging",
}

FORBIDDEN = ("person", "people", "face", "car", "vehicle", "bike", "plate", "licence", "license")


def link_or_copy(src: Path, dst: Path) -> None:
    """Hard-link the image if possible (saves ~2 GB), else copy."""
    if dst.exists():
        return
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def read_names(data_yaml: Path) -> list[str]:
    """Pull `names:` out of a data.yaml without a yaml dependency.

    Handles both the list form (`names: ['a', 'b']`) and the block form
    (`names:` then `  0: a`). Anything else is an error, not a guess.
    """
    text = data_yaml.read_text(encoding="utf-8")
    lines = text.splitlines()
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("names:"):
            continue
        inline = stripped[len("names:") :].strip()
        if inline.startswith("["):
            return [p.strip().strip("'\"") for p in inline[1:-1].split(",") if p.strip()]
        out: list[str] = []
        for follow in lines[i + 1 :]:
            if not follow.startswith((" ", "\t")) or not follow.strip():
                break
            _, _, name = follow.strip().partition(":")
            out.append(name.strip().strip("'\""))
        if out:
            return out
    raise SystemExit(f"Could not read `names:` from {data_yaml}")


def remap_label(src: Path, dst: Path, mapping: dict[int, int], stats: Counter) -> None:
    """Rewrite one label file with new class ids, dropping malformed rows loudly."""
    out_lines = []
    for raw in src.read_text(encoding="utf-8").splitlines():
        parts = raw.split()
        if not parts:
            continue
        if len(parts) != 5:
            stats["malformed_rows"] += 1
            continue
        try:
            cls = int(float(parts[0]))
            box = [float(v) for v in parts[1:]]
        except ValueError:
            stats["malformed_rows"] += 1
            continue
        if cls not in mapping:
            raise SystemExit(f"Unmapped class id {cls} in {src}")
        # A box outside [0,1] means the export is wrong; clamping would hide it.
        if not all(0.0 <= v <= 1.0 for v in box) or box[2] <= 0 or box[3] <= 0:
            stats["out_of_range_boxes"] += 1
            continue
        out_lines.append(f"{mapping[cls]} {box[0]:.6f} {box[1]:.6f} {box[2]:.6f} {box[3]:.6f}")
        stats[f"boxes_{CLASSES[mapping[cls]]}"] += 1
    dst.write_text("\n".join(out_lines) + ("\n" if out_lines else ""), encoding="utf-8")
    if not out_lines:
        stats["images_that_became_empty"] += 1


def ingest(
    pairs: list[tuple[Path, Path | None]],
    out_img: Path,
    out_lbl: Path,
    prefix: str,
    mapping: dict[int, int] | None,
    stats: Counter,
) -> int:
    """Copy/link (image, label) pairs into a split. label=None means a negative."""
    n = 0
    for img, lbl in pairs:
        stem = f"{prefix}{img.stem}"
        link_or_copy(img, out_img / f"{stem}{img.suffix}")
        target = out_lbl / f"{stem}.txt"
        if lbl is None:
            target.write_text("", encoding="utf-8")  # empty = pure negative
            stats["negative_images"] += 1
        elif mapping is None:
            link_or_copy(lbl, target)
        else:
            remap_label(lbl, target, mapping, stats)
        n += 1
    return n


def pairs_from(images_dir: Path, labels_dir: Path) -> list[tuple[Path, Path | None]]:
    """(image, label) pairs. An image with no label file is a negative in YOLO."""
    out = []
    for img in sorted(images_dir.iterdir()):
        if img.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
            continue
        lbl = labels_dir / f"{img.stem}.txt"
        out.append((img, lbl if lbl.is_file() else None))
    return out


def selftest() -> int:
    """Check the parts that would silently corrupt a dataset if wrong."""
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        root = Path(d)

        # names: both yaml shapes
        inline = root / "a.yaml"
        inline.write_text("nc: 3\nnames: ['plastic bag', 'plastic bottle', 'plastic cup']\n", encoding="utf-8")
        assert read_names(inline) == ["plastic bag", "plastic bottle", "plastic cup"]
        block = root / "b.yaml"
        block.write_text("names:\n  0: plastic_bottle\n  1: plastic_bag_film\npath: x\n", encoding="utf-8")
        assert read_names(block) == ["plastic_bottle", "plastic_bag_film"]
        print("read_names: OK (list form and block form)")

        # The mapping that matters: Roboflow's order is bag, bottle, cup.
        rf_names = ["plastic bag", "plastic bottle", "plastic cup"]
        mapping = {i: CLASS_ID[ROBOFLOW_MAP[n]] for i, n in enumerate(rf_names)}
        assert mapping == {0: 1, 1: 0, 2: 2}, mapping
        print("roboflow mapping: OK (bag->1, bottle->0, cup->2 — indices are NOT identity)")

        # remap_label rewrites ids and rejects bad rows
        stats: Counter = Counter()
        src, dst = root / "s.txt", root / "d.txt"
        src.write_text(
            "0 0.5 0.5 0.2 0.2\n"      # bag   -> 1
            "1 0.25 0.25 0.1 0.1\n"    # bottle-> 0
            "2 0.9 0.9 0.05 0.05\n"    # cup   -> 2
            "1 1.5 0.5 0.2 0.2\n"      # out of range -> dropped
            "0 0.5 0.5\n",             # malformed    -> dropped
            encoding="utf-8",
        )
        remap_label(src, dst, mapping, stats)
        got = [line.split()[0] for line in dst.read_text(encoding="utf-8").splitlines()]
        assert got == ["1", "0", "2"], got
        assert stats["out_of_range_boxes"] == 1 and stats["malformed_rows"] == 1
        print("remap_label: OK (ids remapped, 1 out-of-range and 1 malformed row dropped)")

        # a negative gets a real, empty label file
        (root / "img").mkdir()
        (root / "lbl").mkdir()
        (root / "src.jpg").write_bytes(b"x")
        ingest([(root / "src.jpg", None)], root / "img", root / "lbl", "coco_", None, stats)
        neg = root / "lbl" / "coco_src.txt"
        assert neg.is_file() and neg.stat().st_size == 0
        print("negatives: OK (empty label file written, not a missing one)")

        for name in CLASSES:
            assert not any(f in name for f in FORBIDDEN), name
        print("class list: OK (no person/vehicle class, CLAUDE.md §2.4)")
    print("\nAll self-tests passed.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--taco", type=Path, default=Path("ml/data/yolo"))
    p.add_argument("--roboflow", type=Path, default=Path("ml/data/plastic_waste"))
    p.add_argument("--negatives", type=Path, default=Path("ml/data/negatives/images"))
    p.add_argument("--out", type=Path, default=Path("ml/data/combined"))
    p.add_argument("--holdout", type=Path, default=Path("ml/data/holdout_clean"))
    p.add_argument("--val-negatives", type=int, default=300, help="Negatives kept in val.")
    p.add_argument("--holdout-negatives", type=int, default=300, help="Negatives never trained or validated on.")
    p.add_argument("--val-roboflow", type=int, default=800, help="Roboflow valid images used for val (rest are unused).")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--selftest", action="store_true")
    args = p.parse_args()

    if args.selftest:
        return selftest()

    stats: Counter = Counter()
    rng = random.Random(args.seed)

    if args.out.exists():
        shutil.rmtree(args.out)
    for split in ("train", "val"):
        (args.out / "images" / split).mkdir(parents=True)
        (args.out / "labels" / split).mkdir(parents=True)

    # ---- TACO: already our 5 classes, keep its batch-based split ----------
    taco_train = taco_val = 0
    if (args.taco / "images" / "train").is_dir():
        taco_train = ingest(
            pairs_from(args.taco / "images" / "train", args.taco / "labels" / "train"),
            args.out / "images" / "train", args.out / "labels" / "train", "taco_", None, stats,
        )
        taco_val = ingest(
            pairs_from(args.taco / "images" / "val", args.taco / "labels" / "val"),
            args.out / "images" / "val", args.out / "labels" / "val", "taco_", None, stats,
        )
    else:
        print(f"WARNING: no TACO dataset at {args.taco} — continuing without it.")

    # ---- Roboflow: remap 3 classes onto the 5, BY NAME --------------------
    rf_train = rf_val = 0
    rf_yaml = args.roboflow / "data.yaml"
    if rf_yaml.is_file():
        rf_names = read_names(rf_yaml)
        unknown = [n for n in rf_names if n.lower().strip() not in ROBOFLOW_MAP]
        if unknown:
            raise SystemExit(
                f"Roboflow classes {unknown} are not in ROBOFLOW_MAP. "
                "Add them deliberately — do not let annotations be dropped silently."
            )
        mapping = {i: CLASS_ID[ROBOFLOW_MAP[n.lower().strip()]] for i, n in enumerate(rf_names)}
        print(f"Roboflow classes {rf_names} -> ids {[mapping[i] for i in range(len(rf_names))]}")

        for split in ("train", "test"):  # its own test split joins TRAIN; we score on TACO + holdout
            d = args.roboflow / split
            if d.is_dir():
                rf_train += ingest(
                    pairs_from(d / "images", d / "labels"),
                    args.out / "images" / "train", args.out / "labels" / "train", f"rf{split[0]}_", mapping, stats,
                )
        valid = args.roboflow / "valid"
        if valid.is_dir():
            vp = pairs_from(valid / "images", valid / "labels")
            rng.shuffle(vp)
            rf_val = ingest(
                vp[: args.val_roboflow],
                args.out / "images" / "val", args.out / "labels" / "val", "rfv_", mapping, stats,
            )
    else:
        print(f"WARNING: no Roboflow dataset at {args.roboflow} — continuing without it.")

    # ---- Negatives: the fix for firing on sky / empty scenes --------------
    neg_train = neg_val = 0
    if args.negatives.is_dir():
        negs = sorted(args.negatives.glob("*.jpg"))
        rng.shuffle(negs)
        hold = negs[: args.holdout_negatives]
        val_negs = negs[args.holdout_negatives : args.holdout_negatives + args.val_negatives]
        train_negs = negs[args.holdout_negatives + args.val_negatives :]

        if args.holdout.exists():
            shutil.rmtree(args.holdout)
        args.holdout.mkdir(parents=True)
        for n in hold:
            link_or_copy(n, args.holdout / n.name)

        neg_train = ingest([(n, None) for n in train_negs], args.out / "images" / "train",
                           args.out / "labels" / "train", "neg_", None, stats)
        neg_val = ingest([(n, None) for n in val_negs], args.out / "images" / "val",
                         args.out / "labels" / "val", "neg_", None, stats)
    else:
        print(f"WARNING: no negatives at {args.negatives}. The model will keep firing on empty scenes.")

    # ---- data.yaml (absolute path: Ultralytics' datasets_dir can't hijack it) ----
    root = args.out.resolve()
    names_block = "\n".join(f"  {i}: {n}" for i, n in enumerate(CLASSES))
    (args.out / "data.yaml").write_text(
        "# Built by ml/scripts/build_dataset.py — TACO + Roboflow + background negatives.\n"
        f"path: {root.as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        f"names:\n{names_block}\n",
        encoding="utf-8",
    )

    total_train = taco_train + rf_train + neg_train
    total_val = taco_val + rf_val + neg_val
    print(
        f"\n{'':<14}{'train':>8}{'val':>8}\n"
        f"{'TACO':<14}{taco_train:>8}{taco_val:>8}\n"
        f"{'Roboflow':<14}{rf_train:>8}{rf_val:>8}\n"
        f"{'negatives':<14}{neg_train:>8}{neg_val:>8}\n"
        f"{'TOTAL':<14}{total_train:>8}{total_val:>8}"
    )
    if total_train:
        print(f"\nnegatives are {100 * neg_train / total_train:.1f}% of training images")
    print(f"held out (never trained or validated): {len(list(args.holdout.glob('*.jpg'))) if args.holdout.is_dir() else 0} clean scenes")

    print("\nboxes per class in the merged set:")
    for c in CLASSES:
        print(f"  {c:<20}{stats[f'boxes_{c}']:>8}")
    for key in ("malformed_rows", "out_of_range_boxes", "images_that_became_empty"):
        if stats[key]:
            print(f"  NOTE {key}: {stats[key]}")
    print(f"\nWrote {args.out / 'data.yaml'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

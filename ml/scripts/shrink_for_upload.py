"""Shrink oversized dataset images before uploading to Colab (ML-2 helper).

TACO ships photos up to 6000px / 14MB, but YOLO trains at 640. Those pixels are pure
upload weight: capping the long edge at 1280 takes the PlasticWatch set from ~2.2GB to
a few hundred MB with no effect on training quality.

    python ml/scripts/shrink_for_upload.py --root ml/data/yolo
    python ml/scripts/shrink_for_upload.py --root ml/data/yolo --max-side 960 --dry-run

Labels are YOLO-normalised (0-1), so resizing the image needs NO label change.
Runs in place; re-running is a no-op once everything is under the cap.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps

SUFFIXES = {".jpg", ".jpeg", ".png"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=Path("ml/data/yolo"), help="dataset root to walk")
    ap.add_argument("--max-side", type=int, default=1280, help="cap on the longer edge, in px")
    ap.add_argument("--quality", type=int, default=88, help="JPEG quality for rewritten files")
    ap.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    args = ap.parse_args()

    if not args.root.is_dir():
        raise SystemExit(f"{args.root} not found. Run taco_to_yolo.py first.")

    images = [p for p in args.root.rglob("*") if p.suffix.lower() in SUFFIXES]
    if not images:
        raise SystemExit(f"no images under {args.root}")

    before = sum(p.stat().st_size for p in images)
    touched = 0

    for p in images:
        try:
            with Image.open(p) as raw:
                if max(raw.size) <= args.max_side:
                    continue
                img = ImageOps.exif_transpose(raw).convert("RGB")
        except Exception as exc:  # a corrupt download should not kill the run
            print(f"  skip {p.name}: {exc}")
            continue

        touched += 1
        if args.dry_run:
            continue
        img.thumbnail((args.max_side, args.max_side), Image.LANCZOS)
        img.save(p, "JPEG", quality=args.quality, optimize=True)

    after = sum(p.stat().st_size for p in images)
    mb = lambda b: f"{b / 1e6:,.0f} MB"  # noqa: E731
    verb = "would shrink" if args.dry_run else "shrank"
    print(f"{len(images)} images · {verb} {touched} over {args.max_side}px")
    print(f"total {mb(before)} -> {mb(after)}" if not args.dry_run else f"total now {mb(before)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Evaluate trained weights and print the numbers we are allowed to quote (ML-3).

    python ml/scripts/eval.py --weights backend/weights/best.pt --data ml/data/yolo/data.yaml
    python ml/scripts/eval.py --weights ... --data ... --local ml/data/local/data.yaml

Prints per-class mAP50 / precision / recall for the validation split and, when a local
set is given, the same on it — the honest comparison for the demo: numbers from TACO
do not carry over to photos shot in our own streets.

It also reports the confidence that maximises F1, which is what DETECTOR_CONF_THRESHOLD
should be set to. Nothing here promises an accuracy figure (CLAUDE.md §2 / SPEC §6);
whatever comes out goes into ml/reports/metrics.md verbatim, including the drop.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

CLASSES = [
    "plastic_bottle",
    "plastic_bag_film",
    "plastic_packaging",
    "plastic_other",
    "non_plastic_litter",
]


def best_f1_conf(metrics) -> tuple[float, float] | None:
    """(confidence, mean F1) at the peak of the F1-vs-confidence curve, if available."""
    try:
        for x, y, _xlabel, ylabel in metrics.box.curves_results:
            if "F1" in ylabel:
                mean_f1 = y.mean(0) if getattr(y, "ndim", 1) > 1 else y
                i = int(mean_f1.argmax())
                return float(x[i]), float(mean_f1[i])
    except (AttributeError, IndexError, ValueError):
        return None
    return None


def run(weights: Path, data: Path, imgsz: int, conf: float, label: str) -> None:
    from ultralytics import YOLO  # imported here so --help works without the ML extras

    print(f"\n=== {label}: {data} ===")
    model = YOLO(str(weights))
    m = model.val(data=str(data), imgsz=imgsz, conf=conf, verbose=False)

    print(f"{'class':<20}{'images':>8}{'boxes':>8}{'P':>8}{'R':>8}{'mAP50':>8}{'mAP50-95':>10}")
    names = m.names if isinstance(m.names, dict) else dict(enumerate(m.names))
    for i, c in enumerate(m.ap_class_index):
        p, r, ap50, ap = m.box.class_result(i)
        n_boxes = int(m.nt_per_class[c]) if hasattr(m, "nt_per_class") else -1
        n_imgs = int(m.nt_per_image[c]) if hasattr(m, "nt_per_image") else -1
        print(
            f"{names.get(int(c), int(c)):<20}{n_imgs:>8}{n_boxes:>8}"
            f"{p:>8.3f}{r:>8.3f}{ap50:>8.3f}{ap:>10.3f}"
        )
    mp, mr, map50, map95 = m.box.mean_results()
    print(f"{'all':<20}{'':>8}{'':>8}{mp:>8.3f}{mr:>8.3f}{map50:>8.3f}{map95:>10.3f}")

    peak = best_f1_conf(m)
    if peak:
        print(
            f"F1 peaks at confidence {peak[0]:.2f} (mean F1 {peak[1]:.3f})"
            " -> DETECTOR_CONF_THRESHOLD"
        )

    missing = [n for n in CLASSES if n not in set(names.values())]
    if missing:
        print(
            f"NOTE: no validation boxes for {', '.join(missing)} —"
            " those rows are not evidence of anything."
        )


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--weights", type=Path, required=True)
    ap.add_argument("--data", type=Path, required=True, help="data.yaml from taco_to_yolo.py")
    ap.add_argument("--local", type=Path, help="data.yaml of the local street set (SPEC §5)")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.001, help="low conf: the curves need the tail")
    args = ap.parse_args()

    if not args.weights.is_file():
        raise SystemExit(f"{args.weights} not found — train first (ml/notebooks/train_yolo.ipynb).")
    run(args.weights, args.data, args.imgsz, args.conf, "TACO validation (batch-split)")
    if args.local:
        run(args.weights, args.local, args.imgsz, args.conf, "Local street set")
        print("\nQuote BOTH tables, including the drop on the local set. Never quote one number.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

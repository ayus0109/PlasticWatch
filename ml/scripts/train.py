"""Train YOLO model on the converted TACO dataset (ML-2).

Usage:
    python ml/scripts/train.py --data ml/data/yolo/data.yaml --model yolo11n.pt --epochs 10 --batch 8
    python ml/scripts/train.py --data ml/data/yolo/data.yaml --model yolo11s.pt --epochs 90 --batch 16 --device cuda

Outputs:
    - best.pt copied to backend/weights/best.pt
    - ml/reports/metrics.md with validation results
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
import torch
from ultralytics import YOLO


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=Path("ml/data/yolo/data.yaml"), help="Path to data.yaml")
    parser.add_argument("--model", default="yolo11n.pt", help="Pretrained model base (yolo11n.pt, yolo11s.pt)")
    parser.add_argument("--epochs", type=int, default=10, help="Number of training epochs")
    parser.add_argument("--batch", type=int, default=8, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=640, help="Image size")
    parser.add_argument("--device", default="0" if torch.cuda.is_available() else "cpu", help="Device (cpu, 0, etc.)")
    parser.add_argument("--patience", type=int, default=20, help="Early stopping patience")
    parser.add_argument(
        "--cache",
        default=None,
        choices=["ram", "disk"],
        help="Cache images between epochs. 'ram' is a large speedup on a small set like TACO.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Dataloader workers. Keep low on Windows: process spawn is expensive there.",
    )
    parser.add_argument("--project", default="ml/runs", help="Project directory for runs")
    parser.add_argument("--name", default="plasticwatch", help="Run name")
    parser.add_argument("--output-weights", type=Path, default=Path("backend/weights/best.pt"), help="Destination for best.pt")
    parser.add_argument(
        "--resume",
        type=Path,
        default=None,
        help=(
            "Continue an interrupted run from its last.pt "
            "(e.g. ml/runs/<name>/weights/last.pt). Ultralytics reuses the ORIGINAL "
            "run's arguments, so --epochs/--batch here are ignored."
        ),
    )

    args = parser.parse_args()

    if not args.data.is_file():
        raise SystemExit(f"data.yaml not found at {args.data}. Run taco_to_yolo.py first.")

    if args.resume:
        if not args.resume.is_file():
            raise SystemExit(f"--resume checkpoint not found: {args.resume}")
        print(f"=== Resuming training from {args.resume} ===")
        model = YOLO(str(args.resume))
        results = model.train(resume=True)
        save_dir = Path(results.save_dir) if hasattr(results, "save_dir") else args.resume.parent.parent
        _finish(args, save_dir)
        return 0

    print(f"=== Starting YOLO Training ({args.model}) ===")
    print(f"Data: {args.data}")
    print(f"Epochs: {args.epochs} | Batch: {args.batch} | Imgsz: {args.imgsz} | Device: {args.device}")

    # Load model
    model = YOLO(args.model)

    # Train model
    results = model.train(
        data=str(args.data),
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        device=args.device,
        patience=args.patience,
        project=args.project,
        name=args.name,
        seed=0,
        deterministic=True,
        cache=args.cache if args.cache else False,
        workers=args.workers,
    )

    save_dir = Path(results.save_dir) if hasattr(results, "save_dir") else Path(args.project) / args.name
    _finish(args, save_dir)
    return 0


def _finish(args, save_dir: Path) -> None:
    """Copy the best checkpoint into the app, validate it, and write metrics.md.

    Shared by a fresh run and a --resume run so both leave the repo in the same state.
    """
    best_weights = save_dir / "weights" / "best.pt"

    if best_weights.is_file():
        print(f"\n[+] Training complete! Best weights at: {best_weights}")
        args.output_weights.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best_weights, args.output_weights)
        print(f"[+] Copied best weights to: {args.output_weights}")

        # Validate best weights
        print("\n=== Validating Best Model ===")
        m = YOLO(str(best_weights)).val(data=str(args.data), imgsz=args.imgsz, conf=0.001, verbose=False)
        names = m.names if isinstance(m.names, dict) else dict(enumerate(m.names))

        rows = []
        for i, c in enumerate(m.ap_class_index):
            p, r, ap50, ap = m.box.class_result(i)
            rows.append((names[int(c)], p, r, ap50, ap))
        mp, mr, map50, map95 = m.box.mean_results()
        rows.append(("all", mp, mr, map50, map95))

        print(f"\n{'class':<20}{'P':>8}{'R':>8}{'mAP50':>8}{'mAP50-95':>10}")
        for n, p, r, a50, a in rows:
            print(f"{n:<20}{p:>8.3f}{r:>8.3f}{a50:>8.3f}{a:>10.3f}")

        # Write metrics.md
        reports_dir = Path("ml/reports")
        reports_dir.mkdir(parents=True, exist_ok=True)
        metrics_file = reports_dir / "metrics.md"

        lines = [
            "# Detector Metrics (TACO, " + args.model + ")",
            "",
            f"Weights: `best.pt` - imgsz {args.imgsz} - Epochs {args.epochs}",
            "Split: by TACO batch folder (never random) - see `ml/scripts/taco_to_yolo.py`.",
            "",
            "| class | P | R | mAP50 | mAP50-95 |",
            "|---|---|---|---|---|",
        ]
        for n, p, r, a50, a in rows:
            lines.append(f"| {n} | {p:.3f} | {r:.3f} | {a50:.3f} | {a:.3f} |")
        lines.append("")
        metrics_file.write_text("\n".join(lines), encoding="utf-8")
        print(f"[+] Wrote metrics report to: {metrics_file}")
    else:
        print(f"[!] Warning: Best weights not found at {best_weights}")


if __name__ == "__main__":
    sys.exit(main())

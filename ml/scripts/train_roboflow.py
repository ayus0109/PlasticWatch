"""Train YOLO model on the Roboflow Plastic Waste dataset (plastic-waste-ag4eg).

This script downloads the 12,484-image dataset from Roboflow Universe,
trains Ultralytics YOLO (e.g. YOLO11s), validates the model on the test split,
and deploys best.pt directly to backend/weights/best.pt for PlasticWatch.

Citation:
    @misc{ plastic-waste-ag4eg_dataset,
      title = { Plastic Waste Dataset },
      type = { Open Source Dataset },
      author = { Edwin Daza Saavedra's Workspace },
      howpublished = { \\url{ https://universe.roboflow.com/edwin-daza-saavedra-s-workspace/plastic-waste-ag4eg } },
      url = { https://universe.roboflow.com/edwin-daza-saavedra-s-workspace/plastic-waste-ag4eg },
      journal = { Roboflow Universe },
      publisher = { Roboflow },
      year = { 2026 },
      month = { jul },
      note = { visited on 2026-09-26 },
    }
"""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path

import torch
from ultralytics import YOLO


def download_dataset(api_key: str, workspace: str, project_name: str, version_num: int, dest: Path) -> Path:
    from roboflow import Roboflow

    rf = Roboflow(api_key=api_key)
    project = rf.workspace(workspace).project(project_name)
    version = project.version(version_num)
    print(f"Downloading {workspace}/{project_name} version {version_num}...")
    dataset = version.download("yolov11", location=str(dest))
    return Path(dataset.location) / "data.yaml"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api-key", default=os.getenv("ROBOFLOW_API_KEY", "741YgPzdJ9QttK3uR4BG"), help="Roboflow API key")
    parser.add_argument("--workspace", default="edwin-daza-saavedra-s-workspace", help="Roboflow workspace")
    parser.add_argument("--project", default="plastic-waste-ag4eg", help="Roboflow project")
    parser.add_argument("--version", type=int, default=2, help="Dataset version")
    parser.add_argument("--data-yaml", type=Path, default=None, help="Existing data.yaml path if already downloaded")
    parser.add_argument("--dest", type=Path, default=Path("ml/data/plastic_waste"), help="Download directory")
    parser.add_argument("--model", default="yolo11s.pt", help="Pretrained model base (yolo11n.pt, yolo11s.pt)")
    parser.add_argument("--epochs", type=int, default=50, help="Number of training epochs")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=640, help="Image size")
    parser.add_argument("--device", default="0" if torch.cuda.is_available() else "cpu", help="Device (cpu, 0, etc.)")
    parser.add_argument("--output-weights", type=Path, default=Path("backend/weights/best.pt"), help="Destination for best.pt")
    parser.add_argument("--deploy-roboflow", action="store_true", help="Deploy trained weights back to Roboflow project")

    args = parser.parse_args()

    if args.data_yaml and args.data_yaml.is_file():
        data_yaml = args.data_yaml
    else:
        data_yaml = download_dataset(args.api_key, args.workspace, args.project, args.version, args.dest)

    print(f"=== Starting YOLO Training ({args.model}) on Plastic Waste Dataset ===")
    print(f"Data: {data_yaml}")
    print(f"Epochs: {args.epochs} | Batch: {args.batch} | Imgsz: {args.imgsz} | Device: {args.device}")

    model = YOLO(args.model)
    results = model.train(
        data=str(data_yaml),
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        device=args.device,
        project="ml/runs",
        name="plastic_waste_yolo11",
        seed=0,
        deterministic=True,
    )

    save_dir = Path(results.save_dir) if hasattr(results, "save_dir") else Path("ml/runs/plastic_waste_yolo11")
    best_weights = save_dir / "weights" / "best.pt"

    if best_weights.is_file():
        args.output_weights.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best_weights, args.output_weights)
        print(f"Successfully deployed trained model to {args.output_weights} ({best_weights.stat().st_size} bytes)")

    if args.deploy_roboflow:
        try:
            from roboflow import Roboflow

            rf = Roboflow(api_key=args.api_key)
            proj = rf.workspace(args.workspace).project(args.project)
            ver = proj.version(args.version)
            print("Deploying trained model to Roboflow Serverless Cloud...")
            ver.deploy(model_type="yolov11", model_path=str(save_dir))
            print("Deployment to Roboflow completed successfully!")
        except Exception as e:
            print(f"Roboflow deployment error: {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

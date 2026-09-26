#!/usr/bin/env python3
"""Run inference using Roboflow Serverless Cloud API on waste/litter detection models.

Supports single models (e.g. 'waste-tfpi0/7' or 'garbage-0q3db/10') or comma-separated
multi-model ensembles (e.g. 'waste-tfpi0/7,garbage-0q3db/10').

Usage:
    python scripts/roboflow_infer.py path/to/image.jpg
    python scripts/roboflow_infer.py path/to/image.jpg --model-id "waste-tfpi0/7"
    python scripts/roboflow_infer.py path/to/image.jpg --model-id "waste-tfpi0/7,garbage-0q3db/10"
    python scripts/roboflow_infer.py path/to/image.jpg --api-key YOUR_API_KEY
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DEFAULT_MODELS = "waste-tfpi0/7,garbage-0q3db/10"
DEFAULT_API_URL = "https://serverless.roboflow.com"


def run_inference_sdk(image_path: str, api_key: str, model_id: str, api_url: str = DEFAULT_API_URL):
    """Run inference using official inference-sdk if installed."""
    try:
        from inference_sdk import InferenceConfiguration, InferenceHTTPClient

        client = InferenceHTTPClient(
            api_url=api_url,
            api_key=api_key,
        ).configure(InferenceConfiguration(
            api_key_transport="header"  # header-based auth (inference v1.5.0+)
        ))
        return client.infer(image_path, model_id=model_id)
    except ImportError:
        return None


def run_inference_http(image_path: str, api_key: str, model_id: str, api_url: str = DEFAULT_API_URL):
    """Zero-dependency fallback: runs inference using standard library urllib with Header Bearer auth."""
    url = f"{api_url.rstrip('/')}/{model_id}?format=json"
    with open(image_path, "rb") as f:
        img_bytes = f.read()
    b64_data = base64.b64encode(img_bytes)

    req = urllib.request.Request(
        url,
        data=b64_data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def query_model(image_path: str, api_key: str, model_id: str, api_url: str):
    """Attempt SDK first, falling back to direct HTTP."""
    res = run_inference_sdk(image_path, api_key, model_id, api_url)
    if res is None:
        res = run_inference_http(image_path, api_key, model_id, api_url)
    return model_id, res


def main():
    parser = argparse.ArgumentParser(description="Run Roboflow inference on an image.")
    parser.add_argument("image", help="Path to image file")
    parser.add_argument("--api-key", default=os.getenv("ROBOFLOW_API_KEY"), help="Roboflow API Key (or set ROBOFLOW_API_KEY env)")
    parser.add_argument("--model-id", default=DEFAULT_MODELS, help=f"Roboflow model ID(s), comma-separated (default: {DEFAULT_MODELS})")
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help=f"API URL (default: {DEFAULT_API_URL})")

    args = parser.parse_args()

    if not args.api_key:
        print("Error: Roboflow API key is required. Pass --api-key <KEY> or set ROBOFLOW_API_KEY environment variable.", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.image):
        print(f"Error: Image file not found: {args.image}", file=sys.stderr)
        sys.exit(1)

    model_ids = [m.strip() for m in args.model_id.split(",") if m.strip()]

    print(f"Target image: {args.image}")
    print(f"Models to execute ({len(model_ids)}): {', '.join(model_ids)}")
    print(f"API Endpoint: {args.api_url}")
    print("Authentication: Header Bearer transport ('Authorization: Bearer <KEY>')")
    print("-" * 60)

    results = {}
    if len(model_ids) == 1:
        mid, res = query_model(args.image, args.api_key, model_ids[0], args.api_url)
        results[mid] = res
    else:
        print("Running models concurrently via ThreadPoolExecutor...")
        with ThreadPoolExecutor(max_workers=min(4, len(model_ids))) as executor:
            futures = [
                executor.submit(query_model, args.image, args.api_key, mid, args.api_url)
                for mid in model_ids
            ]
            for fut in as_completed(futures):
                mid, res = fut.result()
                results[mid] = res

    total_detections = 0
    for mid, res in results.items():
        preds = res.get("predictions", []) if isinstance(res, dict) else []
        total_detections += len(preds)
        print(f"\n[Model: {mid}] -> Found {len(preds)} prediction(s):")
        for p in preds:
            cls = p.get("class", "unknown")
            conf = p.get("confidence", 0.0)
            print(f"  - {cls} (confidence: {conf*100:.1f}%) at (x:{p.get('x')}, y:{p.get('y')}, w:{p.get('width')}, h:{p.get('height')})")

    print("\n" + "=" * 60)
    print(f"Execution complete. Total raw predictions across all models: {total_detections}")
    print("Full JSON Payload:")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

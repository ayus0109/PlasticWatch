#!/usr/bin/env python3
"""Run inference using Roboflow Serverless Cloud API on model 'garbage-litter-detector/1'.

Usage:
    python scripts/roboflow_infer.py path/to/image.jpg
    python scripts/roboflow_infer.py path/to/image.jpg --api-key YOUR_API_KEY
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

DEFAULT_MODEL_ID = "garbage-litter-detector/1"
DEFAULT_API_URL = "https://serverless.roboflow.com"


def run_inference_sdk(image_path: str, api_key: str, model_id: str = DEFAULT_MODEL_ID, api_url: str = DEFAULT_API_URL):
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


def run_inference_http(image_path: str, api_key: str, model_id: str = DEFAULT_MODEL_ID, api_url: str = DEFAULT_API_URL):
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


def main():
    parser = argparse.ArgumentParser(description="Run Roboflow inference on an image.")
    parser.add_argument("image", help="Path to image file")
    parser.add_argument("--api-key", default=os.getenv("ROBOFLOW_API_KEY"), help="Roboflow API Key (or set ROBOFLOW_API_KEY env)")
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID, help=f"Roboflow model ID (default: {DEFAULT_MODEL_ID})")
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help=f"API URL (default: {DEFAULT_API_URL})")

    args = parser.parse_args()

    if not args.api_key:
        print("Error: Roboflow API key is required. Pass --api-key <KEY> or set ROBOFLOW_API_KEY environment variable.", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.image):
        print(f"Error: Image file not found: {args.image}", file=sys.stderr)
        sys.exit(1)

    print(f"Running inference on: {args.image}")
    print(f"Model: {args.model_id}")
    print(f"Endpoint: {args.api_url}")
    print("Auth: Header Bearer transport")

    # Try SDK first, fall back to standard HTTP
    result = run_inference_sdk(args.image, args.api_key, args.model_id, args.api_url)
    if result is None:
        print("(inference-sdk not installed or build dependencies unavailable; using direct HTTPS header transport)")
        result = run_inference_http(args.image, args.api_key, args.model_id, args.api_url)

    print("\n--- Predictions Result ---")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

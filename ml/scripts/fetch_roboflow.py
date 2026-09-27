"""Download a Roboflow Universe dataset in YOLO format, using only the stdlib.

    set ROBOFLOW_API_KEY=...   (or put it in backend/.env)
    python ml/scripts/fetch_roboflow.py --out ml/data/plastic_waste

The `roboflow` pip package pulls in a large dependency tree for two HTTP calls, so
this talks to the export API directly (CLAUDE.md §3: no new dependencies).

The API key is read from the environment or backend/.env and is NEVER printed, not
even in an error message — it would otherwise end up in a log or a screenshot.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

API = "https://api.roboflow.com"


def read_key() -> str:
    """ROBOFLOW_API_KEY from the environment, else from backend/.env or .env."""
    key = os.getenv("ROBOFLOW_API_KEY", "").strip()
    if key:
        return key
    for env_file in (Path("backend/.env"), Path(".env")):
        if not env_file.is_file():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "ROBOFLOW_API_KEY":
                key = value.strip().strip('"').strip("'")
                if key:
                    return key
    raise SystemExit(
        "No ROBOFLOW_API_KEY found. Set it in the environment or backend/.env.\n"
        "Get one from https://app.roboflow.com/settings/api"
    )


def export_link(key: str, workspace: str, project: str, version: int, fmt: str) -> str:
    """Ask Roboflow to export the version; it may need a few tries while it generates."""
    url = f"{API}/{workspace}/{project}/{version}/{fmt}?api_key={key}"
    for attempt in range(1, 31):
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                body = json.load(resp)
        except urllib.error.HTTPError as exc:
            # 401/403 carry the key in the request; say what failed, never the key.
            raise SystemExit(f"Roboflow rejected the request (HTTP {exc.code}). Check the API key.") from None
        link = (body.get("export") or {}).get("link")
        if link:
            return link
        print(f"  export still generating (attempt {attempt})…", flush=True)
        time.sleep(10)
    raise SystemExit("Roboflow did not return a download link in time.")


def short_name(name: str) -> str:
    """Shorten a Roboflow entry to `<dir>/<hash><ext>`.

    Roboflow exports names like
      train/images/perak-malaysia-december-…-residential-236410611_webp_jpg.rf.<32 hex>.jpg
    which blow past Windows' 260-character path limit inside a deep project folder.
    The `.rf.<hash>` part is already unique, and an image and its label share it, so
    cutting everything before it keeps the pairing intact and the path short.
    """
    head, _, base = name.rpartition("/")
    stem, sep, ext = base.rpartition(".")
    if not sep or ".rf." not in stem:
        return name
    return f"{head}/{stem.split('.rf.')[-1]}.{ext}" if head else f"{stem.split('.rf.')[-1]}.{ext}"


def download(link: str, dest: Path) -> Path:
    zip_path = dest.with_suffix(".zip")
    dest.mkdir(parents=True, exist_ok=True)
    if zip_path.is_file():
        print(f"  reusing {zip_path} ({zip_path.stat().st_size / 1e6:.0f} MB)", flush=True)
    else:
        print(f"  downloading to {zip_path}", flush=True)
        part = zip_path.with_suffix(".zip.part")
        with urllib.request.urlopen(link, timeout=300) as resp, open(part, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while chunk := resp.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r  {done / 1e6:7.1f} / {total / 1e6:.1f} MB", end="", flush=True)
        print()
        part.rename(zip_path)

    print(f"  unzipping into {dest}", flush=True)
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            target = dest / short_name(info.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
    zip_path.unlink()
    return dest


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", default="edwin-daza-saavedra-s-workspace")
    p.add_argument("--project", default="plastic-waste-ag4eg")
    p.add_argument("--version", type=int, default=2)
    p.add_argument("--format", default="yolov11")
    p.add_argument("--out", type=Path, default=Path("ml/data/plastic_waste"))
    p.add_argument("--force", action="store_true", help="Re-download even if it is already there.")
    args = p.parse_args()

    if (args.out / "data.yaml").is_file() and not args.force:
        print(f"Already present: {args.out}/data.yaml (use --force to re-download)")
        return 0
    if args.force and args.out.exists():
        shutil.rmtree(args.out)

    print(f"Roboflow {args.workspace}/{args.project} v{args.version} as {args.format}", flush=True)
    link = export_link(read_key(), args.workspace, args.project, args.version, args.format)
    download(link, args.out)

    yaml = args.out / "data.yaml"
    if not yaml.is_file():
        raise SystemExit(f"Downloaded, but no data.yaml under {args.out}")
    counts = {
        split: len(list((args.out / split / "images").glob("*")))
        for split in ("train", "valid", "test")
        if (args.out / split / "images").is_dir()
    }
    print(f"Done: {counts}")
    print(yaml.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())

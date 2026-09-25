"""Download the TACO images listed in its COCO annotations (ML-1).

TACO ships annotations only; the photos live on Flickr, and some URLs are dead or
rate-limited (SPEC §5). This downloader is therefore resumable: files that already
exist with a plausible size are skipped, failures are retried, and whatever is still
missing is written to a CSV so a rerun can pick it up.

    python ml/scripts/download_taco.py --out ml/data/taco --annotations <path|url>
    python ml/scripts/download_taco.py --out ml/data/taco --limit 20 --dry-run

Nothing here is used at runtime by the app: it prepares a training set offline.
The annotations file is the source of truth for file names AND for the batch folders
that taco_to_yolo.py splits on, so keep it next to the images.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ANNOTATIONS_URLS = [
    "https://cdn.jsdelivr.net/gh/pedropro/TACO@master/data/annotations.json",
    "https://raw.githubusercontent.com/pedropro/TACO/master/data/annotations.json",
]
MIN_BYTES = 2048  # smaller than this is an error page, not a photo
RETRIES = 3
TIMEOUT_S = 30
USER_AGENT = "PlasticWatch-dataset-fetch/0.1 (hackathon project; contact via repo)"


def load_annotations(source: str | None = None) -> dict:
    if source and not source.startswith(("http://", "https://")):
        return json.loads(Path(source).read_text(encoding="utf-8"))

    urls = [source] if source else ANNOTATIONS_URLS
    last_err = None
    for url in urls:
        if not url:
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                return json.load(r)
        except Exception as exc:
            last_err = exc
            continue
    raise RuntimeError(f"Failed to load annotations from all sources. Last error: {last_err}")


def image_url(img: dict) -> str | None:
    """TACO images carry flickr_url / flickr_640_url; prefer the smaller one."""
    return img.get("flickr_640_url") or img.get("flickr_url") or img.get("coco_url")


def fetch(url: str, dest: Path) -> tuple[bool, str]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:  # noqa: S310
                data = r.read()
            if len(data) < MIN_BYTES:
                return False, f"too small ({len(data)} bytes)"
            dest.write_bytes(data)
            return True, "ok"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            if attempt == RETRIES:
                return False, f"{type(exc).__name__}: {exc}"
            time.sleep(2 * attempt)  # Flickr rate-limits; back off
    return False, "unreachable"


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--out", type=Path, default=Path("ml/data/taco"), help="dataset root")
    ap.add_argument("--annotations", default=None, help="annotations.json path or URL")
    ap.add_argument("--limit", type=int, default=0, help="download at most N images (0 = all)")
    ap.add_argument("--workers", type=int, default=4, help="parallel downloads (be gentle)")
    ap.add_argument("--dry-run", action="store_true", help="list what would be downloaded")
    args = ap.parse_args()

    ann = load_annotations(args.annotations)
    images = ann["images"]
    if args.limit:
        images = images[: args.limit]
    print(f"{len(images)} image(s) in the annotations; writing to {args.out}")

    # Keep annotations beside the images: taco_to_yolo.py needs both.
    args.out.mkdir(parents=True, exist_ok=True)
    local_ann = args.out / "annotations.json"
    if not args.dry_run and not local_ann.exists():
        local_ann.write_text(json.dumps(ann), encoding="utf-8")

    todo, skipped = [], 0
    for img in images:
        dest = args.out / img["file_name"]  # e.g. batch_1/000006.jpg
        if dest.is_file() and dest.stat().st_size >= MIN_BYTES:
            skipped += 1
            continue
        url = image_url(img)
        if url is None:
            todo.append((img, dest, None))
        else:
            todo.append((img, dest, url))
    print(f"{skipped} already on disk, {len(todo)} to fetch")

    if args.dry_run:
        for img, _dest, url in todo[:20]:
            print(f"  {img['file_name']:24} <- {url or 'NO URL IN ANNOTATIONS'}")
        if len(todo) > 20:
            print(f"  … and {len(todo) - 20} more")
        return 0

    failures: list[tuple[str, str]] = []
    done = 0

    def work(item):
        img, dest, url = item
        if url is None:
            return img["file_name"], False, "no url in annotations"
        ok, why = fetch(url, dest)
        return img["file_name"], ok, why

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for name, ok, why in pool.map(work, todo):
            done += 1
            if not ok:
                failures.append((name, why))
            if done % 25 == 0 or done == len(todo):
                print(f"  {done}/{len(todo)} fetched, {len(failures)} failed")

    if failures:
        report = args.out / "download_failures.csv"
        with report.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["file_name", "reason"])
            w.writerows(failures)
        print(f"{len(failures)} image(s) failed — see {report}. Rerunning retries only those.")
    print(f"done: {len(todo) - len(failures)} downloaded, {skipped} already present")
    return 0


if __name__ == "__main__":
    sys.exit(main())

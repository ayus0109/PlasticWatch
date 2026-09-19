"""Image quality gates: blur + brightness (SPEC §14, USERFLOW quality gate).

Blur is the variance of the 4-neighbour Laplacian of the greyscale image (the same
kernel as OpenCV's Laplacian with ksize=1). Images are first resized so the longest
side is QUALITY_MAX_SIDE, which makes the threshold resolution-independent — the raw
variance of a large sharp photo is much higher than a small one.

Thresholds come from config. numpy is used for the convolution; it is already a hard
dependency of imagehash, so nothing new is added to the stack.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps

from app.config import get_settings


def _prepared_grey(img: Image.Image) -> np.ndarray:
    """EXIF-rotated, size-normalised greyscale as float64."""
    img = ImageOps.exif_transpose(img)
    max_side = get_settings().QUALITY_MAX_SIDE
    if max(img.size) > max_side:
        img = img.copy()
        img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return np.asarray(img.convert("L"), dtype=np.float64)


def blur_score(img: Image.Image) -> float:
    """Variance of the Laplacian. Higher = sharper."""
    g = _prepared_grey(img)
    if g.shape[0] < 3 or g.shape[1] < 3:
        return 0.0
    lap = g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:] - 4.0 * g[1:-1, 1:-1]
    return float(lap.var())


def brightness(img: Image.Image) -> float:
    """Mean luminance, 0 (black) to 255 (white)."""
    return float(_prepared_grey(img).mean())


def is_low_quality(img: Image.Image) -> tuple[bool, dict[str, Any]]:
    """(True if the photo should be rejected, flags explaining why)."""
    s = get_settings()
    blur = blur_score(img)
    light = brightness(img)
    flags = {
        "blur_score": round(blur, 2),
        "blur_ok": blur >= s.BLUR_MIN_VARIANCE,
        "brightness": round(light, 2),
        "brightness_ok": s.BRIGHTNESS_MIN <= light <= s.BRIGHTNESS_MAX,
    }
    return not (flags["blur_ok"] and flags["brightness_ok"]), flags


def check_file(path: str | Path) -> tuple[bool, dict[str, Any]]:
    with Image.open(path) as img:
        return is_low_quality(img)

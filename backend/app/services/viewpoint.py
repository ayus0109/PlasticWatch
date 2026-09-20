"""Viewpoint match: does an after-photo show the same place as the before photo?

SPEC §14: ORB matches. ORB keypoints on both photos -> Lowe ratio test -> RANSAC
homography. The score is the share of geometrically consistent matches among the
smaller keypoint set, so litter that was cleared away (and took its keypoints with
it) does not count against the match. Both a score floor and an inlier floor must
pass; a photo of a different place fails both by a wide margin.

This checks the PLACE, never people: ORB finds corners, it recognises nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from app.config import get_settings

LOWE_RATIO = 0.75
RANSAC_REPROJ_PX = 5.0
MIN_GOOD_MATCHES = 8  # a homography needs at least 4; fewer than 8 is noise


@dataclass(frozen=True)
class ViewpointResult:
    score: float  # 0..1
    inliers: int

    @property
    def ok(self) -> bool:
        s = get_settings()
        return self.score >= s.VIEWPOINT_MIN_MATCH and self.inliers >= s.VIEWPOINT_MIN_INLIERS


def _grey(path: str | Path) -> np.ndarray:
    side = get_settings().VIEWPOINT_MAX_SIDE
    with Image.open(path) as raw:
        img = ImageOps.exif_transpose(raw).convert("L")
    img.thumbnail((side, side))
    return np.asarray(img)


def match(before_path: str | Path, after_path: str | Path) -> ViewpointResult:
    """ORB viewpoint match between two photos on disk."""
    orb = cv2.ORB_create(nfeatures=get_settings().VIEWPOINT_ORB_FEATURES)
    kp_a, des_a = orb.detectAndCompute(_grey(before_path), None)
    kp_b, des_b = orb.detectAndCompute(_grey(after_path), None)
    if des_a is None or des_b is None or min(len(kp_a), len(kp_b)) < MIN_GOOD_MATCHES:
        return ViewpointResult(0.0, 0)

    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(des_a, des_b, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < LOWE_RATIO * p[1].distance]
    if len(good) < MIN_GOOD_MATCHES:
        return ViewpointResult(0.0, 0)

    src = np.float32([kp_a[g.queryIdx].pt for g in good])
    dst = np.float32([kp_b[g.trainIdx].pt for g in good])
    _, mask = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_REPROJ_PX)
    inliers = int(mask.sum()) if mask is not None else 0
    return ViewpointResult(round(inliers / min(len(kp_a), len(kp_b)), 4), inliers)

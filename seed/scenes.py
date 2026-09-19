"""Procedural litter scenes for the SIMULATED demo (CLAUDE.md §2.2).

Draws a ground texture with bottles, bags/film, packaging, other plastic and
non-plastic litter (cans, paper, leaves). Because we draw each object we know its
exact box, so the demo's "detections" land on the objects instead of at random.
Everything this module produces is simulated — never present it as a real photo or
a real model's output. No people, vehicles or licence plates are ever drawn
(CLAUDE.md §2.4).

make_scene(seed, n_plastic, n_other) -> (PIL.Image, [detection dicts])
Deterministic for a given seed.
"""

from __future__ import annotations

import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1024, 768

PLASTIC = ["plastic_bottle", "plastic_bag_film", "plastic_packaging", "plastic_other"]

# Object size multiplier: litter should fill a phone photo of a pile, not dot it.
SCALE = 1.35


def _ground(rng: random.Random) -> Image.Image:
    """Soil / asphalt texture. Seeded numpy noise: fast and deterministic."""
    base = rng.choice([(96, 92, 84), (112, 104, 90), (84, 88, 86), (120, 110, 94)])
    noise = np.random.default_rng(rng.getrandbits(32)).normal(0, 16, (H, W, 1))
    arr = np.clip(np.array(base, dtype=np.float32)[None, None, :] + noise, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGB")
    d = ImageDraw.Draw(img)
    if rng.random() < 0.6:  # a kerb / drain edge across the frame
        y = rng.randint(90, 200)
        d.rectangle([0, y, W, y + rng.randint(28, 46)], fill=(150, 148, 140))
        d.line([0, y, W, y], fill=(70, 70, 66), width=3)
    if rng.random() < 0.5:  # a patch of weeds
        for _ in range(140):
            x, y = rng.randrange(W), rng.randrange(H)
            d.line(
                [x, y, x + rng.randint(-6, 6), y - rng.randint(8, 22)], fill=(70, 110, 52), width=2
            )
    return img.filter(ImageFilter.GaussianBlur(0.8))


def _rot(points, cx, cy, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    return [
        (cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca) for x, y in points
    ]


def _box(points):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return max(0, min(xs)), max(0, min(ys)), min(W, max(xs)), min(H, max(ys))


def _bottle(d, rng, cx, cy):
    L, R = rng.randint(90, 150) * SCALE, rng.randint(16, 24) * SCALE
    ang = rng.uniform(0, math.pi)
    body = [
        (cx - L / 2, cy - R),
        (cx + L / 2 - 18, cy - R),
        (cx + L / 2 - 18, cy + R),
        (cx - L / 2, cy + R),
    ]
    neck = [
        (cx + L / 2 - 18, cy - R * 0.45),
        (cx + L / 2, cy - R * 0.45),
        (cx + L / 2, cy + R * 0.45),
        (cx + L / 2 - 18, cy + R * 0.45),
    ]
    colour = rng.choice([(190, 220, 230), (120, 170, 120), (150, 190, 225), (230, 235, 238)])
    d.polygon(_rot(body, cx, cy, ang), fill=colour, outline=(60, 70, 75))
    d.polygon(_rot(neck, cx, cy, ang), fill=colour, outline=(60, 70, 75))
    cap = _rot(
        [
            (cx + L / 2, cy - R * 0.5),
            (cx + L / 2 + 9, cy - R * 0.5),
            (cx + L / 2 + 9, cy + R * 0.5),
            (cx + L / 2, cy + R * 0.5),
        ],
        cx,
        cy,
        ang,
    )
    d.polygon(cap, fill=rng.choice([(30, 90, 200), (220, 40, 40), (240, 240, 240)]))
    band = _rot(
        [(cx - L / 5, cy - R), (cx + L / 6, cy - R), (cx + L / 6, cy + R), (cx - L / 5, cy + R)],
        cx,
        cy,
        ang,
    )
    d.polygon(band, fill=rng.choice([(210, 60, 50), (40, 120, 200), (250, 200, 40)]))
    return _box(_rot(body, cx, cy, ang) + cap)


def _bag(d, rng, cx, cy):
    r = rng.randint(40, 75) * SCALE
    pts = [
        (
            cx + math.cos(t) * r * rng.uniform(0.6, 1.15),
            cy + math.sin(t) * r * rng.uniform(0.55, 1.1),
        )
        for t in [i * 2 * math.pi / 11 for i in range(11)]
    ]
    d.polygon(
        pts,
        fill=rng.choice([(232, 234, 236), (40, 40, 44), (90, 140, 200), (200, 220, 205)]),
        outline=(120, 120, 120),
    )
    for _ in range(4):
        a, b = rng.choice(pts), rng.choice(pts)
        d.line([a, (cx, cy), b], fill=(150, 150, 150), width=1)
    return _box(pts)


def _packet(d, rng, cx, cy):
    w, h = rng.randint(60, 110) * SCALE, rng.randint(40, 70) * SCALE
    ang = rng.uniform(0, math.pi)
    rect = _rot(
        [
            (cx - w / 2, cy - h / 2),
            (cx + w / 2, cy - h / 2),
            (cx + w / 2, cy + h / 2),
            (cx - w / 2, cy + h / 2),
        ],
        cx,
        cy,
        ang,
    )
    d.polygon(
        rect,
        fill=rng.choice([(240, 190, 30), (220, 50, 60), (40, 160, 90), (130, 60, 170)]),
        outline=(50, 50, 50),
    )
    stripe = _rot(
        [(cx - w / 2, cy - 6), (cx + w / 2, cy - 6), (cx + w / 2, cy + 6), (cx - w / 2, cy + 6)],
        cx,
        cy,
        ang,
    )
    d.polygon(stripe, fill=(250, 250, 250))
    return _box(rect)


def _cup(d, rng, cx, cy):
    r = rng.randint(18, 28) * SCALE
    d.ellipse(
        [cx - r, cy - r * 0.7, cx + r, cy + r * 0.7],
        fill=(245, 245, 245),
        outline=(90, 90, 90),
        width=2,
    )
    d.ellipse([cx - r * 0.6, cy - r * 0.4, cx + r * 0.6, cy + r * 0.4], fill=(200, 200, 205))
    d.line([cx, cy, cx + r * 1.6, cy - r * 1.3], fill=(230, 60, 90), width=4)  # straw
    return cx - r, cy - r * 1.4, cx + r * 1.7, cy + r * 0.7


def _can(d, rng, cx, cy):
    L, R = rng.randint(50, 70) * SCALE, rng.randint(14, 18) * SCALE
    ang = rng.uniform(0, math.pi)
    body = _rot(
        [(cx - L / 2, cy - R), (cx + L / 2, cy - R), (cx + L / 2, cy + R), (cx - L / 2, cy + R)],
        cx,
        cy,
        ang,
    )
    d.polygon(
        body, fill=rng.choice([(170, 175, 180), (200, 40, 40), (40, 90, 170)]), outline=(40, 40, 40)
    )
    return _box(body)


def _paper(d, rng, cx, cy):
    s = rng.randint(35, 60) * SCALE
    # Points around the centre by angle, so the sheet can never collapse to a sliver.
    pts = [
        (
            cx + math.cos(t) * s * rng.uniform(0.6, 1.0),
            cy + math.sin(t) * s * rng.uniform(0.45, 0.8),
        )
        for t in [i * 2 * math.pi / 5 + rng.uniform(-0.3, 0.3) for i in range(5)]
    ]
    d.polygon(pts, fill=(236, 230, 214), outline=(160, 150, 130))
    return _box(pts)


DRAW = {
    "plastic_bottle": _bottle,
    "plastic_bag_film": _bag,
    "plastic_packaging": _packet,
    "plastic_other": _cup,
}


def make_scene(seed: int, n_plastic: int, n_other: int = 2) -> tuple[Image.Image, list[dict]]:
    rng = random.Random(seed)
    img = _ground(rng)
    d = ImageDraw.Draw(img)
    dets: list[dict] = []
    cells = [(c, r) for c in range(6) for r in range(4)]
    rng.shuffle(cells)
    items = [rng.choice(PLASTIC) for _ in range(n_plastic)] + ["non_plastic_litter"] * n_other
    for kind, (c, r) in zip(items, cells, strict=False):
        cx = (c + 0.5) * W / 6 + rng.uniform(-40, 40)
        cy = (r + 0.5) * H / 4 + rng.uniform(-30, 30)
        if kind == "non_plastic_litter":
            x1, y1, x2, y2 = (_can if rng.random() < 0.5 else _paper)(d, rng, cx, cy)
        else:
            x1, y1, x2, y2 = DRAW[kind](d, rng, cx, cy)
        dets.append(
            {
                "class_name": kind,
                # Plausible, deterministic "model" confidences — simulated, not calibrated.
                "confidence": round(rng.uniform(0.52, 0.93), 3),
                "x1": round(x1, 1),
                "y1": round(y1, 1),
                "x2": round(x2, 1),
                "y2": round(y2, 1),
            }
        )
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    return img, dets

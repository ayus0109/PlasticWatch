"""Procedural litter scenes for the SIMULATED demo (CLAUDE.md §2.2).

Draws a ground texture with bottles, bags/film, packaging, other plastic and
non-plastic litter (cans, paper, leaves). Because we draw each object we know its
exact box, so the demo's "detections" land on the objects instead of at random.
Everything this module produces is simulated — never present it as a real photo or
a real model's output. No people, vehicles or licence plates are ever drawn
(CLAUDE.md §2.4).

make_scene(seed, n_plastic, n_other) -> (PIL.Image, [detection dicts])
Deterministic for a given seed. The street itself (paving joints, kerb, drain grate)
depends only on the seed, so make_scene(seed, 0, 0) is the SAME spot after a
cleanup — which is what the before/after viewpoint check (SPEC §14) needs.
retake() / close_up() re-photograph a scene and carry its boxes along.
"""

from __future__ import annotations

import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

W, H = 1024, 768

PLASTIC = ["plastic_bottle", "plastic_bag_film", "plastic_packaging", "plastic_other"]

# Object size multiplier: litter should fill a phone photo of a pile, not dot it.
SCALE = 1.35


def _paving(img: Image.Image, street: random.Random) -> None:
    """Irregular paving stones + cracks: the fixed texture a real street has, so an
    after-photo can be matched to the before photo once the litter is gone."""
    cols, rows = street.randint(6, 9), street.randint(4, 6)
    cw, ch = W / cols, H / rows

    def corner(i: int, j: int) -> tuple[float, float]:
        jx = street.uniform(-0.28, 0.28) * cw if 0 < i < cols else 0.0
        jy = street.uniform(-0.28, 0.28) * ch if 0 < j < rows else 0.0
        return i * cw + jx, j * ch + jy

    v = [[corner(i, j) for j in range(rows + 1)] for i in range(cols + 1)]
    shades = Image.new("L", img.size, 128)
    sd = ImageDraw.Draw(shades)
    for i in range(cols):
        for j in range(rows):
            quad = [v[i][j], v[i + 1][j], v[i + 1][j + 1], v[i][j + 1]]
            sd.polygon(quad, fill=128 + street.randint(-14, 14))
    img.paste(Image.blend(img, shades.convert("RGB"), 0.18))

    d = ImageDraw.Draw(img)
    joint = (58, 55, 50)
    for i in range(cols + 1):
        for j in range(rows + 1):
            if i < cols:
                d.line([v[i][j], v[i + 1][j]], fill=joint, width=4)
            if j < rows:
                d.line([v[i][j], v[i][j + 1]], fill=joint, width=4)
    for _ in range(street.randint(2, 4)):  # cracks
        x, y, a = (
            street.uniform(0, W),
            street.uniform(0, H),
            street.uniform(0, 2 * math.pi),
        )
        pts = [(x, y)]
        for _ in range(street.randint(6, 12)):
            a += street.uniform(-0.7, 0.7)
            x += math.cos(a) * street.uniform(12, 30)
            y += math.sin(a) * street.uniform(12, 30)
            pts.append((x, y))
        d.line(pts, fill=(48, 46, 42), width=2)


def _grate(img: Image.Image, street: random.Random) -> None:
    """A storm-drain grate: a strong, fixed landmark."""
    d = ImageDraw.Draw(img)
    gx, gy = street.uniform(80, W - 260), street.uniform(60, H - 160)
    d.rectangle([gx, gy, gx + 180, gy + 90], fill=(52, 52, 54), outline=(30, 30, 30), width=4)
    for k in range(1, 9):
        d.line([gx + k * 20, gy + 10, gx + k * 20, gy + 80], fill=(22, 22, 24), width=6)


def _ground(rng: random.Random, seed: int) -> Image.Image:
    """Soil / asphalt texture. Seeded numpy noise: fast and deterministic.

    The street furniture draws from its own generator, so adding it never changed
    where the litter lands for a given seed."""
    street = random.Random(seed ^ 0x5EED)
    base = rng.choice([(96, 92, 84), (112, 104, 90), (84, 88, 86), (120, 110, 94)])
    noise = np.random.default_rng(rng.getrandbits(32)).normal(0, 16, (H, W, 1))
    arr = np.clip(np.array(base, dtype=np.float32)[None, None, :] + noise, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGB")
    _paving(img, street)
    _grate(img, street)
    d = ImageDraw.Draw(img)
    if rng.random() < 0.6:  # a kerb / drain edge across the frame
        y = rng.randint(90, 200)
        d.rectangle([0, y, W, y + rng.randint(28, 46)], fill=(150, 148, 140))
        d.line([0, y, W, y], fill=(70, 70, 66), width=3)
    if rng.random() < 0.5:  # a patch of weeds
        for _ in range(140):
            x, y = rng.randrange(W), rng.randrange(H)
            d.line(
                [x, y, x + rng.randint(-6, 6), y - rng.randint(8, 22)],
                fill=(70, 110, 52),
                width=2,
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
        [
            (cx - L / 5, cy - R),
            (cx + L / 6, cy - R),
            (cx + L / 6, cy + R),
            (cx - L / 5, cy + R),
        ],
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
        [
            (cx - w / 2, cy - 6),
            (cx + w / 2, cy - 6),
            (cx + w / 2, cy + 6),
            (cx - w / 2, cy + 6),
        ],
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
        [
            (cx - L / 2, cy - R),
            (cx + L / 2, cy - R),
            (cx + L / 2, cy + R),
            (cx - L / 2, cy + R),
        ],
        cx,
        cy,
        ang,
    )
    d.polygon(
        body,
        fill=rng.choice([(170, 175, 180), (200, 40, 40), (40, 90, 170)]),
        outline=(40, 40, 40),
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
    img = _ground(rng, seed)
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


# ---------------------------------------------------------------------------
# Re-photographing a scene (after-photos). Boxes are mapped with the pixels.
# ---------------------------------------------------------------------------


def _map_boxes(dets: list[dict], fx, min_visible: float = 0.4) -> list[dict]:
    """Map each box's corners through fx, clip to the frame, drop mostly-cut boxes."""
    out = []
    for det in dets:
        x1, y1 = fx(det["x1"], det["y1"])
        x2, y2 = fx(det["x2"], det["y2"])
        cx1, cy1, cx2, cy2 = max(0, x1), max(0, y1), min(W, x2), min(H, y2)
        full = max(1e-9, (x2 - x1) * (y2 - y1))
        if cx2 <= cx1 or cy2 <= cy1 or (cx2 - cx1) * (cy2 - cy1) / full < min_visible:
            continue
        box = [round(v, 1) for v in (cx1, cy1, cx2, cy2)]
        out.append({**det, "x1": box[0], "y1": box[1], "x2": box[2], "y2": box[3]})
    return out


def retake(img: Image.Image, dets: list[dict], seed: int) -> tuple[Image.Image, list[dict]]:
    """The same spot photographed again: a small shift, zoom and exposure change."""
    rng = random.Random(seed ^ 0xAF7E)
    dx, dy = rng.uniform(-14, 14), rng.uniform(-10, 10)
    zoom = rng.uniform(1.0, 1.06)
    cx, cy = W / 2, H / 2
    # Output (x', y') samples input ((x' - cx - dx) / zoom + cx, ...).
    data = (1 / zoom, 0, cx - (cx + dx) / zoom, 0, 1 / zoom, cy - (cy + dy) / zoom)
    out = img.transform((W, H), Image.AFFINE, data, Image.BICUBIC, fillcolor=(96, 92, 84))
    out = ImageEnhance.Brightness(out).enhance(rng.uniform(0.94, 1.08))
    return out, _map_boxes(
        dets, lambda x, y: ((x - cx) * zoom + cx + dx, (y - cy) * zoom + cy + dy)
    )


def close_up(img: Image.Image, dets: list[dict], seed: int, frac: float = 0.62):
    """A closer photo of the middle of the spot (the second after-photo, SPEC §14).

    A real close-up is shot at full resolution, not upscaled: fresh sensor grain keeps
    it as sharp as a real photo, so it is judged by the quality gate like one."""
    rng = random.Random(seed ^ 0xC105)
    cw, ch = W * frac, H * frac
    x0 = (W - cw) / 2 + rng.uniform(-60, 60)
    y0 = (H - ch) / 2 + rng.uniform(-40, 40)
    out = img.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch))).resize(
        (W, H), Image.BICUBIC
    )
    grain = np.random.default_rng(rng.getrandbits(32)).normal(0, 9, (H, W, 1))
    out = Image.fromarray(
        np.clip(np.asarray(out, dtype=np.float32) + grain, 0, 255).astype(np.uint8)
    )
    sx, sy = W / cw, H / ch
    return out, _map_boxes(dets, lambda x, y: ((x - x0) * sx, (y - y0) * sy))

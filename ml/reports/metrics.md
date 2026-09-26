# Detector metrics — TACO, YOLO11s

Weights: `ml/runs/yolo11s_taco_gpu/weights/best.pt` · imgsz 640 · batch 8 · AdamW (auto)
Hardware: RTX 3050 6GB (CUDA), PyTorch 2.11+cu128, Ultralytics 8.3.253.
Split: **by TACO batch folder, never random** (`ml/scripts/taco_to_yolo.py`) — batches are
repeated shoots of the same place, so a random split would leak near-duplicates into
validation and inflate every number below.

Validation set: 340 images · 1,017 instances.

## Current model

**Trained 90 of a planned 150 epochs** — the run was interrupted, not early-stopped. The
numbers below are the best checkpoint at that point, so they are a floor, not a ceiling.

| class | P | R | mAP50 | mAP50-95 |
|---|---|---|---|---|
| plastic_bottle | 0.346 | 0.407 | 0.304 | 0.210 |
| plastic_bag_film | 0.256 | 0.388 | 0.202 | 0.135 |
| plastic_packaging | 0.300 | 0.273 | 0.214 | 0.177 |
| plastic_other | 0.375 | 0.247 | 0.222 | 0.168 |
| non_plastic_litter | 0.368 | 0.387 | 0.303 | 0.217 |
| **all** | **0.329** | **0.340** | **0.249** | **0.181** |

## Against the previous run

| | previous | current | change |
|---|---|---|---|
| model | yolo11n | yolo11s | larger backbone |
| epochs | 1 | 90 | — |
| imgsz | 320 | 640 | — |
| device | CPU | RTX 3050 | — |
| **mAP50 (all)** | **0.041** | **0.249** | **6.1x** |
| precision (all) | 0.006 | 0.329 | 55x |

The previous entry was a 1-epoch CPU smoke test, so this is a first real result rather than a
tuning win.

## Reading these honestly

- **mAP50 0.249 is modest**, and consistent with what ~1,160 training images of cluttered
  real-world litter supports. It is not a production detector.
- Per-class spread is narrow (0.202–0.304): no class is broken, none is strong.
- `plastic_packaging` holds up better than its 141 training boxes suggest (0.214), but it has
  the lowest recall of the plastic classes — it misses more than it mislabels.
- These are detector metrics on TACO photographs. They say nothing about performance on Indian
  street scenes, which are not represented in the training data.
- The product is designed so this is survivable: two independent reporters plus a human
  verification gate sit between any detection and any action (CLAUDE.md §1).

## To improve, in order of expected effect

1. Finish the run — 60 epochs remain and the curve had not flattened.
2. Add locally-photographed street waste. Data is the binding constraint, not architecture.
3. Feed authority verify/reject decisions back as labels.
4. Calibrate confidence so the Low/Medium/High tiers are statistically grounded rather than
   fixed thresholds.

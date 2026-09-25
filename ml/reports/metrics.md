# Detector Metrics (TACO, yolo11n.pt)

Weights: `best.pt` - imgsz 320 - Epochs 1
Split: by TACO batch folder (never random) - see `ml/scripts/taco_to_yolo.py`.

| class | P | R | mAP50 | mAP50-95 |
|---|---|---|---|---|
| plastic_bottle | 0.004 | 0.474 | 0.027 | 0.015 |
| plastic_bag_film | 0.005 | 0.512 | 0.034 | 0.019 |
| plastic_packaging | 0.002 | 0.509 | 0.013 | 0.007 |
| plastic_other | 0.004 | 0.421 | 0.005 | 0.003 |
| non_plastic_litter | 0.013 | 0.460 | 0.124 | 0.074 |
| all | 0.006 | 0.475 | 0.041 | 0.024 |

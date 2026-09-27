# Demo images — Real-World Photographs

These photos are **authentic real-world photographic scenes of plastic waste** (and clean baselines), replacing procedural cartoon drawings. Each scene features real urban textures: drain grates, asphalt pavement, curb stones, market lanes, and waterways with discarded plastic bottles, polythene bags, snack packaging, and cups.

All photos strictly comply with ethics rules (CLAUDE.md §2.4: no people, no faces, no vehicles, no licence plates).

`detections.json` contains precomputed bounding box detections produced by our trained YOLO model (`backend/weights/best.pt`), keyed by the perceptual hash (pHash) of each photo as the pipeline stores it. Uploading one of these files returns its boxes instantly.

| File | Use in the demo |
|---|---|
| `demo_01_bottles_by_drain.jpg` | First citizen report — bottles and bags choked against a stormwater drain grate |
| `demo_02_bags_on_kerb.jpg` | Second nearby report — plastic bags and film on street kerb (merges into hotspot) |
| `demo_03_market_lane.jpg` | Market lane waste — wrappers, snack packaging, cups and bottles |
| `demo_04_packets_and_cups.jpg` | Street corner pile — disposable beverage cups, straws, and chip packets |
| `demo_02_canal_floating_debris.jpg` | Waterway / canal floating plastic debris |
| `demo_05_after_cleanup_wide.jpg`, `demo_06_after_cleanup_close.jpg` | After-photos (wide + close) of cleaned street / drain, litter removed — ORB viewpoint matches them to before photo |
| `demo_07_clean_street.jpg` | Spotless pavement — no likely plastic, demonstrates rejection path |
| `demo_08_blurry.jpg` | Blurred photo — demonstrates image quality gate rejection |

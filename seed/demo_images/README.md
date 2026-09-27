# Demo images — SIMULATED

These photos are **procedurally drawn litter scenes**, not photographs. Each scene has fixed street furniture (paving joints, cracks, a drain grate) so an after-photo of the same spot can be matched to its before photo. They were generated
by `seed/scenes.py` via `python seed/build_demo_assets.py`, so we know exactly where every
bottle, bag and packet is — `detections.json` holds those boxes, keyed by the perceptual
hash (pHash) of each photo as the pipeline stores it. Uploading one of these files returns
its boxes instantly, so the live demo never waits on inference.

Everything here is simulated demo data (CLAUDE.md §2.2): the app watermarks the annotated
image "SIMULATED DETECTION" and flags the report `is_simulated`.

| File | Use in the demo |
|---|---|
| `demo_01_bottles_by_drain.jpg` | First citizen report — a heavy pile |
| `demo_02_bags_on_kerb.jpg` | Second nearby report — merges into the first |
| `demo_03_market_lane.jpg`, `demo_04_packets_and_cups.jpg` | Spare reports |
| `demo_05_after_cleanup_wide.jpg`, `demo_06_after_cleanup_close.jpg` | After-photos (wide + close) of hotspot **H02**'s street, litter removed — upload them at H02's cleanup stop; the ORB viewpoint check matches them to H02's latest before photo |
| `demo_07_clean_street.jpg` | No likely plastic — shows the rejection path |
| `demo_08_blurry.jpg` | Too blurry — shows the quality gate |

**Replace these with the team's own local photo set** (SPEC §5: 60–100 photos shot in the
demo area, **no faces, no vehicle number plates**) once it exists. Real photos go through
the real detector; only this synthetic set has precomputed boxes.

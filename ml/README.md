# ML track — detector training (runs OUTSIDE the app)

The backend never blocks on this: `services/detector.py` is stub-first and the whole
pipeline is demoable with `DETECTOR_MODE=stub` (SPEC §6). Everything here prepares and
measures the real model, and it runs on a GPU box or Colab, not in the API container.

```bash
# 1. images (resumable; TACO photos live on Flickr and some URLs are dead)
python ml/scripts/download_taco.py --out ml/data/taco
python ml/scripts/download_taco.py --out ml/data/taco --limit 20 --dry-run   # look first

# 2. COCO -> YOLO, 60 TACO categories -> the 5 frozen classes, split by BATCH
python ml/scripts/taco_to_yolo.py --taco ml/data/taco --out ml/data/yolo
python ml/scripts/taco_to_yolo.py --selftest    # tiny synthetic set; no download needed

# 3. train (ml/notebooks/train_yolo.ipynb on Colab GPU) -> best.pt + metrics.md

# 4. measure, including the drop on our own photos
python ml/scripts/eval.py --weights backend/weights/best.pt \
    --data ml/data/yolo/data.yaml --local ml/data/local/data.yaml
```

`ml/data/`, `ml/runs/` and `ml/weights/` are gitignored — datasets and weights are never
committed. Trained weights go to `backend/weights/best.pt`, which is also gitignored.

## The 5 classes (frozen, SPEC §6)

`plastic_bottle` · `plastic_bag_film` · `plastic_packaging` · `plastic_other` ·
`non_plastic_litter`. The first four are what the app calls **likely plastic** — a
judgement that comes from `scripts/class_map.csv`, not from TACO.

**No person, vehicle or licence-plate class may ever be added** (CLAUDE.md §2.4).
`taco_to_yolo.py` aborts if a category name looks like one.

## OPEN ITEM — `class_map.csv` needs two reviewers (SPEC §20 item 3)

The mapping is a material honesty decision: it decides what the app calls plastic.
16 of the 60 rows are marked `needs_review=yes` because the material cannot be told from
a photo or the item is a composite — cartons and paper cups (plastic-lined), blister
packs, rope, shoes, squeezable tubes, "unlabeled litter", and **cigarettes** (the filter
is cellulose acetate, a plastic; currently mapped to `non_plastic_litter`, and it is
TACO's largest category, so this one choice moves every number).

Two people check the rows against the real category names in the downloaded
`annotations.json`, then record the decision here. `taco_to_yolo.py` **fails** on a
category it does not know rather than silently dropping annotations, so a renamed or new
TACO category can't quietly shrink the training set.

## Reporting rules

Per-class mAP50 / precision / recall, measured, from `eval.py` or the notebook — plus the
drop on the local street set, and ten failure images. **Never promise an accuracy figure.**
Results belong in `ml/reports/metrics.md` (written by the notebook), quoted as they are.

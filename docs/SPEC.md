# docs/SPEC.md — PlasticWatch source of truth

Reorganised from PART B. **No decisions changed.** Section numbers match the original spec so
stage prompts can say "read SPEC §11". Anything the team must still decide is in §20 OPEN ITEMS.

---

## §0 Context
Hackathon PS-08 "PlasticWatch: AI-GIS Detection and Prioritisation of Plastic Waste Hotspots."
Track: Climate, Water & Circularity. SDG 11/12/14. Dataset: TACO.

The system must: process sample images/reports; classify **likely** plastic presence; map detections;
merge duplicate reports; rank hotspots by severity, recurrence and proximity to sensitive locations
(drains, water); include confidence; and never treat unverified citizen images as conclusive evidence
of responsibility. Stretch: before/after, routing, trend, ward dashboards.

**Novelty (careful wording):** photo complaints, AI litter detection, hotspot mapping, proximity-to-water
and routing are NOT new. What we combine is: report-level **evidence grading**, **merge-based recurrence**,
**impact ranked separately from evidence**, a **human verification gate**, **before/after closure with
false-clean protection**, and **non-attribution by design**. Claim only: "we found no existing system
combining these." Reference solutions (Swachhata, OpenLitterMap, Litterati, CleanSight AI, The Ocean
Cleanup ~68.7% precision in Jakarta, MDPI Community Watch which we deliberately differ from by NOT
attributing responsibility) are logged in `docs/architecture.md`.

## §1 Honesty & ethics (mirrored in CLAUDE.md §2 — that copy governs)
Survive a mediocre detector · "likely plastic" · flag simulated data (`is_simulated` + badge) ·
no attribution · no person/vehicle/plate detection · human gate for Verified/Resolved/False-positive ·
absence ≠ clean · confidence shown as tier · weights are tunable proposals.

## §2 Scope — WILL build
| ID | Feature | Tier |
|----|---------|------|
| F1 | Citizen report: photo + location (browser GPS → EXIF → map-pin fallback) + optional note | P0 |
| F2 | AI detection: boxes, classes, confidence, plastic count, area fraction, annotated image | P0 |
| F3 | Duplicate merge into hotspots (radius + time + pHash), reopen-on-recurrence | P0 |
| F4 | Geo-context: distance to drain/water/school/hospital/market; ward lookup | P0 |
| F5 | Two-axis scoring (Impact + Evidence) with explanation card | P0 |
| F6 | Authority map: priority markers, evidence styling, heatmap, filters, time slider | P0 |
| F7 | Verification queue, status machine, audit log | P0 |
| F8 | Dashboard: 6 KPI cards + 4 charts | P0 (trim to KPIs if short) |
| F9 | Cleanup task + optimised route for top-N verified hotspots; team view | P1 |
| F10 | Before/after with anti-false-clean checks + authority confirmation | P1 |
| F11 | Seed + reset script (simulated 45-day history) | P0 (demo depends on it) |

**Cut line (2–3 day build):** F1–F7 + F11 + KPI-only F8. Drop F9/F10 (describe as designed, not built).

## §3 Scope — will NOT build
See CLAUDE.md §8.

## §4 Tech stack
See CLAUDE.md §3 for the exact choices. Reasons/alternatives (Plain HTML+Leaflet, Chart.js, Flask,
SQLite+Shapely, Roboflow API, nearest-neighbour only, Supabase/Cloudinary) are documented; **do not
switch without editing this file**. Notes: Ultralytics is AGPL-3.0 (fine for hackathon; mention in
future scope). **OPEN ITEM:** current ORS free quota for `/optimization` (older source said ~500/day;
recheck) — cache the demo route.

## §5 Datasets
- **TACO:** 1,500 images, 4,784 annotations, 60 categories (28 super), COCO format, phone photos,
  hosted on Flickr (slow/broken downloads — start Day 0). No predefined split. Many small objects
  (most cigarettes <64×64 px). Check per-image licences. **No geolocation → assigned coords are simulated (`is_simulated=true`).**
- **Own local set (60–100 imgs)** shot by the team in the demo area, **no faces/plates.** Uses:
  generalisation test set, demo scenes, honesty slide.
- **OSM via Overpass, pulled ONCE and stored:** waterways/drains, water bodies, schools, hospitals,
  markets, ward boundaries. Attribution "© OpenStreetMap contributors". If drain coverage is thin,
  digitise 10–20 nala lines with `source='manual'`. **No Overpass calls at runtime.**
- **Optional P2 SALSA** only if baseline works by Day 2.

## §6 AI model
YOLO11s, detection only, `imgsz=640`. Fall back to `yolo11n` if CPU inference > ~2 s/img. Train on
Colab (~80–100 epochs, default augs). **5 classes** collapsed from TACO's 60 via `class_map.csv`:
`plastic_bottle`, `plastic_bag_film`, `plastic_packaging`, `plastic_other`, `non_plastic_litter`.
The four plastic classes = "plastic-likely". **OPEN ITEM:** two people review the mapping against real
category names in `annotations.json`. Split by **TACO batch tags**, not randomly. Threshold from the
F1-vs-confidence curve on validation (~0.25–0.4); below it → `not_detected`. Report real mAP50/precision/
recall per class; show the drop on the local set; keep 10 failure images; do not promise an accuracy figure.

**Frozen detector contract (Day 1):**
```json
{
  "plastic_count": 11,
  "plastic_area_frac": 0.12,
  "report_confidence": 0.71,
  "detections": [{"class_name":"plastic_bottle","confidence":0.83,
                  "x1":10,"y1":20,"x2":110,"y2":220,"area_frac":0.02}],
  "annotated_jpg_path": "uploads/annotated/abc.jpg",
  "ai_status": "detected"
}
```
`report_confidence` = mean of top-3 plastic-likely confidences. `plastic_area_frac` = sum of plastic box
areas / image area, **capped at 1.0**. `detector.py` is **stub-first**: fixed fake output until
`weights/best.pt` exists, chosen by `DETECTOR_MODE` env.

## §7 Database schema (10 tables)
Geometry SRID 4326, GiST indexes, distances via `::geography`. **There is deliberately no column for a
responsible party.** Tables (see original spec for full column lists — reproduce verbatim in
`sql/schema.sql`): `users, wards, geo_features, reports, detections, hotspots, hotspot_events (audit log),
cleanup_tasks, task_stops, before_after`.
Key columns to preserve exactly: `reports.is_simulated bool default false`,
`reports.location_source ('browser'|'exif'|'pin')`, `reports.image_phash text`,
`hotspots.score_breakdown jsonb`, `hotspots.priority_band text`, `hotspots.status text`,
`hotspot_events(from_status,to_status,reason,note,actor_id)`.

## §8 API (REST, FastAPI)
| Method + path | Role | Purpose |
|---|---|---|
| POST /auth/demo-login | any | pick a seeded user, get token |
| POST /detect (P1) | citizen | preview detection without saving |
| POST /reports | citizen | multipart image+lat+lon+accuracy+source+note → detect→dedupe→context→score; returns report, detections, hotspot summary, merged flag |
| GET /reports/mine, /reports/{id} | citizen | own reports + status |
| GET /hotspots | authority | GeoJSON; filters: status, band, ward, min_evidence, as_of |
| GET /hotspots/{id} | authority | score breakdown, reports, events (evidence ledger) |
| POST /hotspots/{id}/verify | authority | `{decision: verify \| reject \| false_positive, reason?, note?}` |
| GET /geo/layers?kind=, GET /wards | any | GeoJSON layers; ward stats |
| POST /tasks | authority | `{hotspot_ids[], team_id, depot}` → optimised route (verified hotspots only) |
| GET /tasks, /tasks/{id} | authority, team | task + stops |
| POST /tasks/{id}/stops/{sid}/arrive | team | mark arrival (within 50 m) |
| POST /tasks/{id}/stops/{sid}/after | team | upload 2 after-photos → before/after record + verdict |
| POST /before-after/{id}/review | authority | `{decision: confirm_resolved \| reject, note?}` |
| GET /analytics/summary, /trend?days=, /wards | authority | dashboard data |
| POST /admin/reset-demo | authority | reseed demo state |

Every hotspot mutation writes `hotspot_events`. Illegal transition → 409. Role violation → 403.
Tasks reject non-verified hotspots. (Enum values for the two `{decision:...}` bodies are completed in
Issues found — freeze them in `schemas.py`.)

## §9 Frontend pages (~9)
**Login** role picker (demo accounts). **Citizen:** `/report` (camera/gallery, location capture, pin
fallback, result card w/ annotated image + confidence tier + status), `/my-reports`. **Authority:**
`/map` (main), `/hotspots/:id` (score bars, evidence ledger timeline, verify/reject), `/queue`,
`/tasks`, `/dashboard`. **Team:** `/team/tasks`, `/team/tasks/:id` (route map, stop list, after-photo
upload, verdict).
Design: neutral bg, 4-step priority ramp, dashed outline for unverified/weak-evidence, "simulated demo
data" badge, persistent non-attribution note. (UI polish direction in CLAUDE.md §9 + Stage 8/9.)

## §10 GIS
Prep once: Overpass → GeoJSON → QGIS sanity → `load_geo.py` into PostGIS. Distances at hotspot
create/update: nearest-feature per kind with `ST_Distance(a::geography,b::geography)` + KNN `<->`; store
on the hotspot row (never per-request). Ward: `ST_Contains`. Map: priority markers, dashed ring when
evidence weak, heatmap weighted by Impact, drain/water toggles, ward choropleth, filter panel, hotspot
circle via `ST_MinimumBoundingCircle` of members. Time slider: `GET /hotspots?as_of=T` recomputes score
using only reports with `created_at <= T`. Route: decode ORS geometry or straight lines in fallback.
Validation: distances vs QGIS at 5 points, **±5 m tolerance**.

## §11 Scoring (all factors normalised 0–1)
- **Severity S** = `0.6·min(1,n/15) + 0.4·min(1,a/0.25)`; n=plastic count, a=area frac; averaged over the hotspot's **latest 3 reports**.
- **Recurrence R** = `min(1,(D + 2·C)/8)`; D=distinct report days in last 60, C=times returned after Resolved.
- **Sensitivity Se** = `min(1, 0.75·max(prox_drain,prox_water) + 0.25·max(prox_school,prox_hospital,prox_market))`; `prox(d)=1 if d≤50 m, 0 if d≥300 m, linear between`.
- **Persistence P** = `min(1, days_open/14)`.
- **Impact** = `100 × (0.35·S + 0.25·R + 0.30·Se + 0.10·P)`.
- **Evidence Ev** = `0.5·mean_report_confidence + 0.3·min(1,unique_reporters/3) + 0.2·reporter_reliability`. Human-verified → `Ev = 1.0` labelled "human-verified".
- **Bands** (freeze as half-open intervals — see Issues): Impact ≥70 Critical, [50,70) High, [30,50) Medium, <30 Low. Evidence <0.4 Low, [0.4,0.75) Moderate, ≥0.75 Strong.
- **Why two axes:** ranking uses Impact; Evidence controls what the system may *claim* and who must look, so a confident-but-wrong model can't inflate severity.

**GOLDEN TEST (must pass, do NOT round intermediates):**
n=11,a=0.12 → S=0.632. D=4,C=1 → R=0.75. drain 25 m, market 120 m → Se=0.93. open 6 days → P=0.4286.
`round(Impact,1) == 73.1`. Evidence: conf 0.71, 3 reporters, reliability 0.5 → `round(Ev,3) == 0.755` (Strong).
Store `score_breakdown` jsonb: each factor's value, weight, contribution (for the explanation card).

## §12 Duplicate detection
```
on new report R (point, time, phash):
 1. if pHash within Hamming ≤6 of an existing report image:
      mark duplicate_of; attach to that hotspot; do NOT count as new unique evidence
 2. radius = 30 m (widen up to 75 m if GPS accuracy worse; flag "low location accuracy")
 3. candidates = hotspots (status != false_positive) with ST_DWithin(geom,R,radius);
      a Resolved hotspot within 90 days counts as a candidate
 4. if candidates: pick nearest → attach R; recompute centroid+radius;
      if was Resolved: reopen, recurrence_returns += 1;
      same reporter within 24 h counts once toward unique_reporters
    else: create new hotspot (status ai_detected)
 5. rescore (recompute context distances only if centroid moved materially)
 6. promote to needs_verification when unique_reporters ≥ 2 OR Evidence ≥ 0.6
```
Two radii: ~30 m to merge reports; ~100–200 m only for dashboard area grouping. Merging two nearby
hotspots is P2.

## §13 Verification workflow
`ai_detected → needs_verification → verified → cleanup_scheduled → cleanup_completed → resolved`, with
`false_positive` reachable from the first two states and from `verified` by an authority. Only an
authority moves a hotspot to verified / false_positive / resolved. Cleanup tasks accept **verified** only.
Reject reasons: `not_plastic, no_waste_visible, wrong_location, duplicate, already_cleaned, other`.
Every transition writes `hotspot_events`.

## §14 Before/after workflow
Team arrives (app checks within 50 m). Upload **2 after-photos** (one wide, one close). Backend runs
quality gates (blur via Laplacian variance, brightness), the detector, and viewpoint match vs before
(ORB matches). `reduction_ratio = 1 − (after plastic area / before plastic area)`; also compare counts;
use the **worse** of the two after-photos. Verdict: `likely_cleaned` (≥80% reduction **and** ≤1 detection),
`partial` (40–80%), `not_cleaned` (<40%), `inconclusive` (failed quality/location/viewpoint). **System
never auto-resolves** — authority sees before/after side by side and confirms/rejects; only confirm →
resolved. Resolved hotspots stay on the map; a new nearby report reopens + raises recurrence.

## §15 Folder structure
See CLAUDE.md §4.

## §16 Milestones (contract-first: freeze OpenAPI stubs, detect() shape, GeoJSON shapes on Day 1)
M0 repo/compose/schema/demo-area/TACO-download (`make up` works) · M1 OpenAPI stubs+fixtures, FE shell on
mocks (map renders fixtures) · M2 baseline YOLO + detector contract + geo layers (detector returns JSON) ·
M3 POST /reports e2e (golden = 73.1) · M4 verification queue + status machine + detail (P0 path clickable) ·
M5 seed/reset + time slider + dashboard (one-command reset). **Cut line.** M6 tasks+routing+team · M7
before/after · M8 polish + local-set eval (3 clean dry runs) · M9 deck/README/backup video/hosted backup.

## §17 Testing strategy
ML: precision/recall/F1/mAP50 per class on val + local set; plastic-vs-non-plastic confusion; 10 failure
images. Scoring: pytest golden (73.1 and 0.755). Dedupe: parametrised (10/25/45 m, same-reporter repeat,
pHash dup, low-accuracy GPS, reopen after resolve). Workflow: illegal transitions → 409; non-authority
verify → 403; tasks reject unverified. GIS: distances vs QGIS at 5 points ±5 m. Before/after: fixtures for
each verdict incl. blurred + wrong-location. E2E: scripted demo dry run ≥3× from fresh reset. Failure
drills: ORS down (greedy fallback), detector slow (precomputed cache), no internet (cached tiles/screenshot).

## §18 Deployment
Primary: local docker-compose (PostGIS + API) + frontend build on the demo laptop. Phones need HTTPS for
geo/camera → Cloudflare/ngrok tunnel, or demo citizen upload from the laptop. Backup hosted: DB on Supabase
(verify free-tier PostGIS), API on a free container host (export ONNX for small RAM / sleeping instances),
frontend on Vercel/Netlify. Insurance: record a 2-minute screen capture of the full flow.

## §19 Demo flow + team task lists
5-min flow: problem/GVP framing → live citizen upload (annotated + tier + "AI-detected") → second nearby
report merges (recurrence↑, Impact jumps, score card explains) → authority queue, verify one + reject a
non-plastic one (the human gate) → build task from top verified, show route, switch to team view → after-
photos, verdict + side-by-side, authority confirms, dashboard updates → honest slide (real metrics, local-
set drop, simulated geotags, non-attribution, future scope). Pre-seeded: ~60 reports, ~15 hotspots, 45 days,
3–4 wards, all simulated. Person A–E task lists → see CLAUDE_CODE_GUIDE.md "Parallel work map".

## §20 OPEN ITEMS (team must decide — wire to config/env until then)
1. **Demo area / city** (blocks G1 → OSM data, wards, seed). Set `DEMO_AREA_BBOX` + `DEMO_AREA_NAME` in `.env`.
2. **Build duration / team size** (plan assumes 5 people, ~6 days; cut line in §2).
3. **TACO class-map review** vs real category names (`ml/scripts/class_map.csv`).
4. **Current ORS free-tier quota** for `/optimization` — set `ORS_DAILY_QUOTA`, cache demo route.
5. **OSM drain/nala coverage** in chosen area — digitise manually if thin (`source='manual'`).
6. **Hosted backup platform** (only if a public link is required).

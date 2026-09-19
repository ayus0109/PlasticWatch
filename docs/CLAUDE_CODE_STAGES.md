# Claude Code — Staged Build Prompts (PlasticWatch PS-08)

Paste one fenced block at a time into Claude Code. **Do the stages in order** — each depends only on
earlier ones. Every block starts by forcing **plan mode**: Claude Code proposes a short plan and waits
for your "go" before editing, then implements, runs the checks, and summarises.

**Before Stage 0:** copy `CLAUDE.md` to the repo root and `docs/SPEC.md` into `docs/`. Then `/clear`
and start Stage 0.

> Convention used in every block:
> - **Goal** — one sentence.
> - **Context to read** — files to open first.
> - **Exact tasks / Files / Constraints / Acceptance criteria (runnable) / Do NOT** — as labelled.
> - Acceptance criteria are always a command, test, curl, or specific UI behaviour — never "works well".

---

## Stage 0 — Kickoff: scaffold + docker-compose + PostGIS

```text
PLAN MODE FIRST: present a short plan and wait for my approval before editing. Then implement, run the acceptance checks, and give a 5-line summary.

Goal: Scaffold the PlasticWatch monorepo so every teammate gets an identical base with one command.

Context to read: CLAUDE.md (all), docs/SPEC.md §7 (schema tables), §15/§4 (folders), §16 (M0).

Exact tasks:
1. Create the folder tree exactly as CLAUDE.md §4 (empty __init__.py / .gitkeep where needed).
2. docker-compose.yml with two services: `db` (image postgis/postgis:16-3.4, POSTGRES_* from env, volume, port 5432) and `api` (build ./backend, depends_on db healthy, port 8000, mounts backend for reload).
3. backend/Dockerfile (python:3.11-slim, install requirements, uvicorn). requirements.txt: fastapi, uvicorn[standard], sqlalchemy, psycopg[binary], pydantic-settings, python-multipart, imagehash, pillow, ultralytics, ruff, pytest, httpx.
4. backend/app/config.py: pydantic-settings Settings reading DATABASE_URL, DETECTOR_MODE (default "stub"), DEMO_AREA_BBOX, DEMO_AREA_NAME, ORS_API_KEY, ORS_DAILY_QUOTA, DEDUPE_RADIUS_M=30, DEDUPE_RADIUS_MAX_M=75, GPS_ACCURACY_WIDEN_M=30, PHASH_HAMMING_MAX=6, REOPEN_WINDOW_DAYS=90. (These are the SPEC OPEN ITEMS + tunables — all from env.)
5. backend/app/db.py: SQLAlchemy Core engine + a get_conn dependency.
6. backend/app/sql/schema.sql: `CREATE EXTENSION IF NOT EXISTS postgis;` then ALL 10 tables from SPEC §7 with the exact columns listed there, SRID 4326 geometry, GiST indexes on every geom, and CHECK constraints named in the spec. NO "responsible party" column anywhere.
7. backend/app/main.py: FastAPI app, `GET /health` returns {"status":"ok","postgis": <bool from `SELECT postgis_version()`>}. On startup, run schema.sql if tables absent.
8. .env.example (every config key with placeholder + comments pointing to OPEN ITEMS), .gitignore (weights/, .env, uploads/, __pycache__, node_modules, *.pt), README.md (quickstart), Makefile with the targets in CLAUDE.md §6.

Files to create: docker-compose.yml, backend/Dockerfile, backend/requirements.txt, backend/app/{config,db,main}.py, backend/app/sql/schema.sql, .env.example, .gitignore, Makefile, README.md.

Constraints: no business logic yet. Everything tunable comes from config.py/env. Keep schema.sql a faithful transcription of SPEC §7 — do not invent columns.

Acceptance criteria (runnable):
- `cp .env.example .env && make up` starts both containers with no error.
- `curl -s localhost:8000/health` → `{"status":"ok","postgis":true}`.
- `docker compose exec db psql -U <user> -d <db> -c "\dt"` lists all 10 tables.
- `make down` stops cleanly.

Do NOT: add auth, endpoints beyond /health, ORM models, or any detector code. Do NOT commit .env or weights.
```

---

## Stage 1 — API contract + schemas + demo auth (contract-first)

```text
PLAN MODE FIRST: short plan, wait for approval, then implement + run checks + summarise.

Goal: Freeze the OpenAPI surface, Pydantic schemas, fixtures, and role-based demo auth so frontend and backend can work in parallel.

Context to read: CLAUDE.md §5, docs/SPEC.md §8 (endpoints), §6 (detector contract), §9 (pages), §13 (statuses).

Exact tasks:
1. backend/app/schemas.py: Pydantic models for every request/response in SPEC §8, plus the frozen DetectorOutput (SPEC §6). Define Enums: HotspotStatus (ai_detected, needs_verification, verified, cleanup_scheduled, cleanup_completed, resolved, false_positive), VerifyDecision (verify, reject, false_positive), RejectReason (not_plastic, no_waste_visible, wrong_location, duplicate, already_cleaned, other), ReviewDecision (confirm_resolved, reject), PriorityBand (low, medium, high, critical), EvidenceBand (low, moderate, strong), LocationSource (browser, exif, pin).
2. backend/app/routers/{auth,reports,hotspots,geo,tasks,before_after,analytics}.py: every SPEC §8 path as a stub returning a matching fixture. Register all routers in main.py.
3. backend/app/deps.py: demo auth — POST /auth/demo-login takes a seeded user id/role, returns a signed token (itsdangerous or plain HMAC); a `require_role(*roles)` dependency returns 403 on mismatch.
4. backend/fixtures/*.json: realistic example payloads for hotspots (GeoJSON FeatureCollection), a report result, a hotspot detail with score_breakdown, geo layers, analytics summary. Mark simulated fixtures with is_simulated=true.
5. Freeze the GeoJSON layer shapes for /hotspots and /geo/layers and document them at the top of geo.py + hotspots.py as a comment "FROZEN CONTRACT — do not change without a stage".

Files: backend/app/schemas.py, backend/app/deps.py, backend/app/routers/*.py, backend/fixtures/*.json.

Constraints: stubs only — no DB reads yet, return fixtures. Response models must exactly match schemas (FastAPI response_model on every route). Non-attribution: no field names about a responsible party.

Acceptance criteria (runnable):
- `curl -s localhost:8000/openapi.json | python -c "import sys,json;print(len(json.load(sys.stdin)['paths']))"` ≥ 16 paths.
- Visit /docs — all endpoints present with schemas.
- `curl -s -X POST localhost:8000/hotspots/x/verify` as a citizen token → HTTP 403; as authority → 200.
- `curl -s localhost:8000/hotspots` returns valid GeoJSON FeatureCollection (properties include priority_band, evidence_score, is_simulated).

Do NOT: implement scoring/dedupe/detection. Do NOT touch the DB. Do NOT change schema.sql.
```

---

## Stage 2 — GIS load + geo-context service

```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.

Goal: Load geo features + wards into PostGIS and compute per-kind nearest distances + ward lookup, tested against known values.

Context to read: docs/SPEC.md §5 (OSM once, no runtime Overpass), §10 (GIS), §20 items 1 & 5 (demo area + drains OPEN ITEMS).

Exact tasks:
1. gis/processed/: commit a SMALL sample GeoJSON set (a few drains, one water body, a school/hospital/market, one ward polygon) with fields kind, name, source, so the stage runs offline before real OSM data exists. Real Overpass output drops in here later unchanged.
2. gis/load_geo.py: read gis/processed/*.geojson + gis/wards.geojson → insert into geo_features and wards (ST_SetSRID(...,4326)). Idempotent (truncate+load or upsert). Uses DATABASE_URL from env.
3. backend/app/services/geo_context.py: `nearest_distances(conn, point) -> {d_drain_m,d_water_m,d_school_m,d_hospital_m,d_market_m}` using ST_Distance(::geography) ordered by `<->`; `ward_for(conn, point)` via ST_Contains. Returns None per kind if no feature of that kind loaded.
4. backend/tests/test_geo_context.py: load the sample set into a test DB, assert distances to hand-computed values within ±5 m and the correct ward id.
5. Makefile: `make load-geo` target.

Files: gis/processed/*.geojson, gis/wards.geojson, gis/load_geo.py, backend/app/services/geo_context.py, backend/tests/test_geo_context.py, Makefile update.

Constraints: NO Overpass/HTTP calls at runtime. Distances computed once (this service is called at hotspot create/update only). All coords SRID 4326.

Acceptance criteria (runnable):
- `make load-geo` inserts rows: `psql ... -c "SELECT kind,count(*) FROM geo_features GROUP BY kind"` shows expected counts.
- `make test -- backend/tests/test_geo_context.py` (or `pytest backend/tests/test_geo_context.py`) passes with ±5 m tolerance.

Do NOT: call Overpass at runtime, recompute distances per API request, or hard-code the demo bbox (read DEMO_AREA_BBOX).
```

---

## Stage 3 — Detector service (stub-first) + quality gates

```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.

Goal: Implement the frozen detector contract as a deterministic STUB so the whole pipeline is testable before real weights exist.

Context to read: docs/SPEC.md §6 (contract + stub-first), CLAUDE.md §2 (honesty) + §5 (stub-first).

Exact tasks:
1. backend/app/services/detector.py: `run_detection(image_path) -> DetectorOutput`. If DETECTOR_MODE=="stub" (default): return deterministic fake output derived from a hash of the filename (varied but repeatable) — always valid against the contract, ai_status in {detected,not_detected}. If "real": load weights/best.pt via Ultralytics, map classes via class_map, compute plastic_count, plastic_area_frac (capped at 1.0), report_confidence (mean of top-3 plastic-likely; if <3 detections, mean of available; if 0, 0.0), write annotated jpg. NEVER emit person/vehicle/plate classes.
2. backend/app/services/quality.py: `blur_score(img)` (Laplacian variance), `brightness(img)`, `is_low_quality(img)->(bool, flags)`. Thresholds from config.
3. backend/tests/test_detector_contract.py: assert stub output has exactly the contract keys with correct types, area_frac in [0,1], and is deterministic for a given filename.

Files: backend/app/services/detector.py, backend/app/services/quality.py, backend/tests/test_detector_contract.py.

Constraints: stub must not require any model download. The "real" branch may be written but is not exercised until Stage/track ML-3 produces weights. Output copy uses "likely plastic" semantics — no class named just "plastic".

Acceptance criteria (runnable):
- `DETECTOR_MODE=stub pytest backend/tests/test_detector_contract.py` passes.
- In a python shell: two calls to run_detection("uploads/x.jpg") return identical dicts (deterministic).

Do NOT: block on weights, add segmentation/CLIP, or detect people/vehicles/plates.
```

---

## Stage 4 — Dedupe service + scenario tests

```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.

Goal: Merge duplicate reports into hotspots by pHash + radius + time, with reopen-on-recurrence, exactly per SPEC §12.

Context to read: docs/SPEC.md §12 (algorithm — implement verbatim), §7 (reports/hotspots columns), config keys from Stage 0.

Exact tasks:
1. backend/app/services/dedupe.py: `assign_report(conn, report) -> DedupeResult{hotspot_id, merged: bool, reopened: bool, duplicate_of: uuid|None}` implementing the 6 steps of §12: pHash Hamming ≤ PHASH_HAMMING_MAX → duplicate_of + attach + not new evidence; radius DEDUPE_RADIUS_M widening to DEDUPE_RADIUS_MAX_M when gps_accuracy_m > GPS_ACCURACY_WIDEN_M (flag low accuracy); ST_DWithin candidates excluding false_positive; Resolved within REOPEN_WINDOW_DAYS is a candidate; nearest wins; attach + recompute centroid/radius (ST_MinimumBoundingCircle of members); reopen + recurrence_returns+=1 if was Resolved; same reporter within 24 h counts once toward unique_reporters; else create hotspot status=ai_detected.
2. backend/tests/test_dedupe.py: parametrised scenarios — reports at 10/25/45 m from an existing hotspot (10 & 25 merge at 30 m radius, 45 does not); same-reporter repeat within 24 h (unique_reporters unchanged); pHash duplicate (duplicate_of set, no new evidence); low-accuracy GPS widens radius; report near a Resolved hotspot within window reopens it (recurrence_returns increments).

Files: backend/app/services/dedupe.py, backend/tests/test_dedupe.py.

Constraints: pure functions over a DB connection; no HTTP. Do not count pHash duplicates or same-reporter-<24h as new unique evidence. Recompute geo-context only if centroid moved materially (leave a TODO hook calling geo_context in Stage 6).

Acceptance criteria (runnable):
- `pytest backend/tests/test_dedupe.py` — all parametrised cases pass, including the reopen and low-accuracy cases.

Do NOT: implement scoring here, merge two existing hotspots (P2), or change §12 thresholds in code (use config).
```

---

## Stage 5 — Scoring service + golden test

```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.

Goal: Implement two-axis scoring exactly per SPEC §11 and pass the golden test to the specified precision.

Context to read: docs/SPEC.md §11 (formulas + golden test + "do NOT round intermediates").

Exact tasks:
1. backend/app/services/scoring.py: pure functions severity(reports), recurrence(D,C), sensitivity(dists), persistence(days_open), impact(...), evidence(mean_conf,unique_reporters,reliability, human_verified: bool). `score_hotspot(...)` returns impact, evidence, priority_band, evidence_band, and a score_breakdown dict {factor:{value,weight,contribution}}. Bands are HALF-OPEN: Impact ≥70 critical, [50,70) high, [30,50) medium, <30 low; Evidence <0.4 low, [0.4,0.75) moderate, ≥0.75 strong. Human-verified forces evidence=1.0 with label "human-verified". Keep full float precision; round only for display/band edges as specified.
2. backend/tests/test_scoring.py: the golden case — n=11,a=0.12 → S≈0.632; D=4,C=1 → R=0.75; drain 25 m + market 120 m → Se=0.93; open 6 days → P≈0.4286; assert round(impact,1)==73.1 and band==critical. Evidence conf 0.71 / 3 reporters / reliability 0.5 → assert round(evidence,3)==0.755 and band==strong. Add a prox() boundary test (50 m→1, 300 m→0, 175 m→0.5).

Files: backend/app/services/scoring.py, backend/tests/test_scoring.py.

Constraints: no DB in scoring.py (takes plain numbers/lists). Weights live as named module constants mirroring SPEC §11 with a comment "tunable proposal".

Acceptance criteria (runnable):
- `pytest backend/tests/test_scoring.py` passes: `round(impact,1)==73.1`, `round(evidence,3)==0.755`, correct bands, prox boundaries correct.

Do NOT: round intermediate factors before combining (it breaks 73.1). Do NOT publish weights as fact in UI.
```

---

## Stage 6 — POST /reports end-to-end + read endpoints (stub detector)

```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.

Goal: Wire the full pipeline detect→dedupe→context→score→persist behind POST /reports, and serve the read endpoints from the DB.

Context to read: docs/SPEC.md §8 (reports + hotspots read), §11, §12, §10; services from Stages 2–5.

Exact tasks:
1. routers/reports.py: POST /reports (multipart image+lat+lon+accuracy+source+note) → save image + pHash → run_detection (stub) → assign_report (dedupe) → if centroid moved, geo_context.nearest_distances + ward_for on the hotspot → score_hotspot → persist report, detections, hotspot (with score_breakdown, priority_band), write hotspot_events row for creation/attach. Return {report, detections, hotspot summary, merged flag, low_accuracy flag}. GET /reports/mine, GET /reports/{id}.
2. routers/hotspots.py: GET /hotspots → GeoJSON with filters status/band/ward/min_evidence/as_of (as_of recomputes score using only reports created_at<=T, with D/days_open/persistence measured relative to T). GET /hotspots/{id} → breakdown + reports + events (evidence ledger). Set is_simulated on the hotspot response if any member report is simulated.
3. routers/geo.py: GET /geo/layers?kind=, GET /wards from DB (GeoJSON). Replace the Stage 1 fixtures for these routes with real DB reads.
4. backend/tests/test_reports_e2e.py: POST a report, then a second within 25 m → response merged=true, hotspot report_count=2; craft inputs so a hotspot reproduces the golden Impact 73.1.

Files: routers/reports.py, routers/hotspots.py, routers/geo.py, backend/tests/test_reports_e2e.py, uploads/ handling in main.py (StaticFiles).

Constraints: geo-context computed once at create/update (never per GET). Time-slider as_of must not mutate stored rows (compute on the fly). Keep detector on stub (DETECTOR_MODE=stub).

Acceptance criteria (runnable):
- `curl -F image=@backend/fixtures/sample.jpg -F lat=.. -F lon=.. -F accuracy=8 -F source=browser localhost:8000/reports` → 200 with merged=false, a new hotspot id.
- Second nearby curl → merged=true and GET /hotspots/{id} shows report_count=2.
- `pytest backend/tests/test_reports_e2e.py` passes incl. the 73.1 reproduction.
- `curl "localhost:8000/hotspots?band=critical"` returns only critical features.

Do NOT: recompute distances per request, mutate rows during as_of queries, or wire real weights.
```

---

## Stage 7 — Verification workflow + status machine + audit log

```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.

Goal: Enforce the SPEC §13 status machine with a human gate, audit every transition, and reject illegal/role-violating actions.

Context to read: docs/SPEC.md §13 (state machine + reject reasons), §8 (verify endpoint), §7 (hotspot_events).

Exact tasks:
1. backend/app/services/workflow.py: `ALLOWED_TRANSITIONS` map per §13; `transition(conn, hotspot, to_status, actor, reason, note)` validates the edge (else raise a 409-mapped error), checks actor role (authority for verified/false_positive/resolved), writes a hotspot_events row, updates status. Verified forces evidence label "human-verified" (evidence=1.0 via scoring).
2. routers/hotspots.py: POST /hotspots/{id}/verify with body {decision, reason?, note?} → maps verify→verified, reject→(needs_verification stays / or false_positive per decision), false_positive→false_positive. Illegal transition → 409; non-authority → 403; unknown reason → 422.
3. backend/tests/test_workflow.py: assert every illegal transition → 409; citizen verify → 403; authority verify ai_detected→verified writes exactly one event; false_positive from verified allowed; resolved only via §14 path (not directly here).

Files: backend/app/services/workflow.py, routers/hotspots.py update, backend/tests/test_workflow.py.

Constraints: no auto-transitions anywhere. Only human authority actions change to verified/false_positive/resolved. Every mutation writes hotspot_events.

Acceptance criteria (runnable):
- `pytest backend/tests/test_workflow.py` — all pass (409 on illegal, 403 on role, event rows written).
- `curl -X POST .../hotspots/{id}/verify -d '{"decision":"verify"}'` as authority → status verified + a new event visible in GET /hotspots/{id}.

Do NOT: allow any code path to auto-verify or auto-resolve. Do NOT let tasks accept non-verified hotspots (enforce when Stage P1-A lands).
```

---

## Stage 8 — Frontend shell + map + citizen report (design system starts here)

```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.

Goal: Stand up the React app against the REAL API with a strong, non-templated design system, and ship the citizen report flow + authority map.

Context to read: CLAUDE.md §9 (design language), docs/SPEC.md §9 (pages), §6 (tier), §10 (map layers), honesty rules §2.

Exact tasks:
1. frontend: Vite + React + React Router + Tailwind scaffold. frontend/src/api/client.ts typed against openapi.json. frontend/src/lib/theme.ts: design tokens — priority ramp (Low #64748b, Medium #f59e0b, High #f97316, Critical #ef4444), spacing scale, radii, elevation, light+dark. Global shell: top bar, role indicator, persistent non-attribution footer chip, simulated-data badge component.
2. Login: role picker calling /auth/demo-login (citizen/authority/team seeded users).
3. Citizen /report: capture (camera/gallery), location capture browser GPS → EXIF fallback → map-pin drop; POST /reports; result card with annotated image, confidence TIER (Low/Med/High) beside the number, status chip, "low location accuracy" note when flagged. /my-reports list with status.
4. Authority /map (main): Leaflet + OSM tiles, hotspot markers coloured by priority_band, DASHED ring + lower opacity for weak-evidence/unverified, solid + glow for human-verified, leaflet.heat toggle weighted by Impact, drain/water layer toggles, ward choropleth toggle, filter panel (status/band/ward/min_evidence), time slider hitting ?as_of=. Simulated badge on simulated markers.
5. Polish per CLAUDE.md §9: skeleton loaders, empty + error states for map/list, animated score/tier reveal via Tailwind transitions, marker hover lift, keyboard focus rings. Colour never the sole signal (band label/icon on markers + legend).

Files: frontend/src/{main.tsx, App.tsx, lib/theme.ts, api/client.ts, store/auth.ts, components/*, pages/Login,Report,MyReports,Map}.

Constraints: only the fixed stack + Tailwind (framer-motion allowed ONLY if you note it in SPEC §4; otherwise CSS/Tailwind transitions). Never show raw confidence without a tier. Keep the non-attribution note visible on authority views.

Acceptance criteria (runnable):
- `cd frontend && npm run dev` → Login → pick authority → /map renders live hotspots from the API.
- Submit a citizen report → result card shows annotated image + a Low/Med/High tier + status; it appears in /my-reports.
- Toggling the heatmap and a drain layer changes the map; dragging the time slider changes visible hotspots.
- Weak-evidence hotspots render with a dashed ring; simulated ones show the badge.
- `npm run build` succeeds.

Do NOT: invent endpoints, show confidence without a tier, add features not in SPEC §2, or drop the non-attribution note.
```

---

## Stage 9 — Authority detail + queue + dashboard

```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.

Goal: Ship the hotspot detail (explanation + evidence ledger + human gate), the verification queue, and the dashboard.

Context to read: docs/SPEC.md §9, §11 (score_breakdown), §13 (verify/reject), §8 (analytics). Stage 7 endpoints.

Exact tasks:
1. /hotspots/:id: animated score-breakdown bars (each factor value×weight from score_breakdown), Impact vs Evidence shown as two distinct axes, evidence ledger timeline from hotspot_events, verify/reject actions (reject reason dropdown from SPEC §13). "Human-verified" badge when applicable. Explanation card in plain language ("Critical because it recurs and sits 25 m from a drain").
2. /queue: list of needs_verification hotspots sorted by Impact, quick verify/reject inline, optimistic UI + refetch.
3. /dashboard: 6 KPI cards + 4 Recharts charts (SPEC §8 analytics/summary,trend,wards). If time-boxed, render KPIs first and stub charts behind a flag (KPI-only cut is allowed by SPEC §2).
4. Empty/loading/error states for all three; skeletons; error toast on 409/403 with a human-readable message.

Files: frontend/src/pages/{HotspotDetail,Queue,Dashboard}.tsx, components/{ScoreBars,EvidenceLedger,KpiCard,charts/*}.

Constraints: verify/reject must call the real endpoint and reflect the new status + a new ledger event. Never display a responsible party. Confidence always as a tier.

Acceptance criteria (runnable):
- On /hotspots/:id, clicking Verify (as authority) flips status to verified and a new event appears in the ledger without reload-from-scratch.
- Rejecting requires a reason; submitting a citizen token → 403 surfaced as a friendly error.
- /dashboard KPI cards populate from /analytics/summary; at least the KPI row renders with real numbers.
- Score bars visibly animate and sum to the shown Impact.

Do NOT: fabricate analytics, allow verify without authority role, or auto-resolve.
```

---

## Stage 10 — Seed/reset + time-machine demo + polish (P0 finish line)

```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.

Goal: One-command reproducible demo state (45-day simulated history) plus the reliability polish that makes a live demo safe.

Context to read: docs/SPEC.md §5 (simulated rule), §19 (demo flow + pre-seed counts), §17 (failure drills), §18 (deploy).

Exact tasks:
1. seed/scenario.json + seed/seed_demo.py: ~60 reports, ~15 hotspots across 3–4 wards over 45 days, with recurrence arcs (some reopened), spread over statuses, ALL is_simulated=true, using stub detections or precomputed detection JSON. Uses geo features from Stage 2. POST /admin/reset-demo (authority) wipes + reseeds.
2. seed/demo_images/: a handful of committed demo images. Precompute + cache their detector output so the live demo never waits on inference (detector cache keyed by pHash).
3. routing safety hook: if ORS is unavailable/over ORS_DAILY_QUOTA, the app must still work (greedy fallback stub is fine here; full routing is P1-A). Cache one demo route in seed data.
4. Global polish: consistent empty/error/loading states, offline map tile fallback note, a "SIMULATED DEMO DATA" banner while seeded data is present, and the persistent non-attribution note on every authority page.
5. docs/demo-script.md: the 5-minute flow from §19 as a click-by-click runbook.

Files: seed/seed_demo.py, seed/scenario.json, seed/demo_images/*, routers/admin.py (reset-demo), detector cache in services/detector.py, docs/demo-script.md, Makefile `reset-demo`.

Constraints: seeded geotags are simulated and flagged everywhere. Reset must be idempotent and finish in seconds. No live external calls required for the core demo.

Acceptance criteria (runnable):
- `make reset-demo` reseeds and prints counts (~60 reports / ~15 hotspots); the map shows them with simulated badges.
- Dragging the time slider changes hotspot scores/visibility consistent with as_of.
- Run the docs/demo-script.md flow start-to-finish 3× from a fresh reset with no errors.
- With ORS disabled (unset ORS_API_KEY), the app still loads and no page crashes.

Do NOT: seed any non-simulated geotags, require internet for the core flow, or auto-resolve seeded hotspots.
```

---

## Optional P1 stages (build ONLY after the P0 cut line)

### Stage P1-A — Cleanup tasks + optimised route + team view (F9)
```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.
Goal: Build tasks over VERIFIED hotspots with an ORS-optimised route + greedy fallback, and the team pages.
Context: SPEC §8 (tasks/stops), §10 (route drawing), §4 (ORS OPEN ITEM), §7 (cleanup_tasks/task_stops).
Tasks: services/routing.py (ORS /optimization; on error or over ORS_DAILY_QUOTA → greedy nearest-neighbour; cache demo route); POST /tasks (verified-only, else 409), GET /tasks,/tasks/{id}; team /team/tasks + /team/tasks/:id with route map + stop list + arrive (within 50 m). When a task is created, transition member hotspots to cleanup_scheduled via workflow (audited).
Acceptance: `curl -X POST /tasks` with a non-verified hotspot → 409; with verified ids → 200 + route_geojson; with ORS unset → greedy route still returned; team page draws the route and lists stops.
Do NOT: accept non-verified hotspots; recompute geo per request; hard-code ORS quota (use env).
```

### Stage P1-B — Before/after closure with false-clean protection (F10)
```text
PLAN MODE FIRST: short plan, wait, implement, run checks, summarise.
Goal: After-photo capture → quality + viewpoint checks → verdict → authority confirm (only confirm resolves).
Context: SPEC §14 (verdict rules), §6 (detector), §7 (before_after).
Tasks: services/before_after.py (2 after-photos, quality gates from Stage 3, ORB viewpoint match vs before, reduction_ratio = 1 − after_area/before_area using the WORSE of the two after-photos, verdict likely_cleaned/partial/not_cleaned/inconclusive per §14); POST /tasks/{id}/stops/{sid}/after; POST /before-after/{id}/review (confirm_resolved → workflow transition to resolved [audited], reject → stays). Authority UI: side-by-side before/after + verdict + confirm/reject.
Tests: fixtures for each verdict incl. a blurred photo (→inconclusive) and a wrong-location photo (→inconclusive); assert the system never sets resolved without a confirm review.
Acceptance: `pytest backend/tests/test_before_after.py` passes all four verdicts + the two inconclusive guards; confirming in the UI moves the hotspot to resolved with a ledger event; it stays on the map and a new nearby report reopens it (recurrence↑).
Do NOT: auto-resolve on a good verdict; treat absence of detections as proof of cleanliness.
```

---

## ML Track (runs OUTSIDE Claude Code — Colab / local GPU)

These are separate because training doesn't happen inside the app repo. Use them as standalone prompts /
scripts. The backend never blocks on them thanks to the stub detector (Stage 3).

### ML-1 — TACO downloader + TACO→YOLO conversion
```text
Write ml/scripts/download_taco.py (resume-able, handles broken Flickr URLs, logs failures) and
ml/scripts/taco_to_yolo.py that converts TACO COCO annotations to YOLO format using ml/scripts/class_map.csv
(TACO's 60 categories → 5 classes: plastic_bottle, plastic_bag_film, plastic_packaging, plastic_other,
non_plastic_litter). Split by TACO BATCH TAGS (not random) to avoid near-duplicate leakage. Emit
data.yaml. Print per-class counts. Add a --dry-run. Do NOT map any person/vehicle/plate category.
Acceptance: running on a small sample produces YOLO labels + data.yaml with 5 classes and a batch-based
train/val split; per-class counts printed. Two teammates must review class_map.csv (SPEC §20 item 3).
```

### ML-2 — Training notebook
```text
Write ml/notebooks/train_yolo.ipynb: Ultralytics YOLO11s, imgsz=640, ~80–100 epochs, default augs, on the
converted dataset (data.yaml). Log mAP50 / precision / recall PER CLASS on validation; plot the
F1-vs-confidence curve and pick the operating threshold (~0.25–0.4); export best.pt (+ optional ONNX for
the hosted backup). Save 10 failure images. Write ml/reports/metrics.md with real numbers and the drop on
the local street set. Fallback to yolo11n if inference > ~2 s/img on CPU. Do NOT promise an accuracy figure.
Acceptance: notebook runs end-to-end on Colab GPU and produces best.pt + metrics.md + failure images.
```

### ML-3 — Real detector swap-in + eval
```text
Flip services/detector.py "real" branch to load ml weights (weights/best.pt) behind DETECTOR_MODE=real,
honouring the EXACT frozen contract from SPEC §6 (same keys/types the stub emits). Write ml/scripts/eval.py
to reproduce metrics.md numbers on the val + local set. Verify the pipeline (POST /reports) works
unchanged with DETECTOR_MODE=real. Do NOT change the contract shape.
Acceptance: with weights present and DETECTOR_MODE=real, POST /reports returns a real annotated image and
all Stage 6/7 tests still pass; eval.py prints per-class metrics.
```

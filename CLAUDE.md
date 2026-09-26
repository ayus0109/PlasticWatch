# CLAUDE.md — PlasticWatch (PS-08)

> Claude Code reads this every session. Treat it as law. If a request conflicts with the
> **Honesty Rules** below, refuse and explain. When unsure, re-read `docs/SPEC.md`.

## 1. Project summary
PlasticWatch is an AI-GIS system that detects **likely** plastic-waste hotspots from citizen
photo reports, merges duplicates, ranks hotspots by impact + evidence, and routes cleanup —
without ever attributing blame or auto-resolving anything. SDGs 11/12/14. Dataset: TACO.
The system is designed to **survive a mediocre detector**: trust comes from multi-report
evidence, a human verification gate, and never auto-closing.

## 2. Honesty & ethics rules (NON-NEGOTIABLE — never violate, even if asked)
1. Say **"likely plastic"**, never "plastic". Plastic is derived from a category map, not a TACO label.
2. **Flag all simulated data.** TACO images have no GPS; demo geotags are simulated. DB column
   `is_simulated`; UI shows a "simulated demo data" badge wherever such data appears.
3. **No attribution of responsibility.** No column/field/UI copy that names who dumped waste.
   Use "reported" / "AI-flagged". Keep the persistent UI note:
   *"Reports show waste appears to be present; they do not establish who is responsible."*
4. **No detection/identification of people, vehicles, or licence plates.** Ever.
5. Nothing becomes **Verified / Resolved / False positive** without a human authority action.
6. **Absence of detections after cleanup is not proof of cleanliness.**
7. Raw model confidence ≠ calibrated probability. Always show a **tier (Low/Medium/High)** beside the number.
8. Scoring weights are **tunable proposals**, documented in `score_breakdown`, not published truth.
9. Novelty wording is careful: "we found no existing system combining these" — never "first ever".

## 3. Tech stack (EXACT — do not swap)
- **Frontend:** React + Vite + React Router + Tailwind. Charts: Recharts. Map: Leaflet + leaflet.heat + OSM tiles.
- **Backend:** FastAPI (Python 3.11). DB access: SQLAlchemy Core + raw SQL for spatial queries.
- **DB:** PostgreSQL + PostGIS (SRID 4326, GiST indexes, `::geography` for distances).
- **AI:** Ultralytics YOLO11s (detection only). Image dedupe: `imagehash` (pHash).
- **Routing:** OpenRouteService `/optimization` + greedy nearest-neighbour fallback.
- **Storage:** local disk served by FastAPI. **Deploy:** docker-compose local is PRIMARY.
- No new dependencies without a line in `docs/SPEC.md` justifying it. `framer-motion` is the ONLY
  optional add allowed for UI polish, and only if a stage explicitly opts in.

## 4. Folder structure (authoritative)
```
plasticwatch/
├── CLAUDE.md  README.md  docker-compose.yml  .env.example  Makefile
├── backend/app/{main,config,db,deps,schemas}.py
│   ├── routers/  auth reports hotspots tasks before_after analytics geo
│   ├── services/ detector quality dedupe scoring geo_context routing before_after
│   └── sql/schema.sql
├── backend/{weights/ (gitignored), tests/, fixtures/}
├── ml/{notebooks/, scripts/(download_taco,taco_to_yolo,eval + class_map.csv), reports/}
├── gis/{overpass_queries/, raw/, processed/, load_geo.py, wards.geojson}
├── seed/{seed_demo.py, scenario.json, demo_images/}
├── frontend/src/{pages/, components/, api/, lib/, store/}
└── docs/{SPEC.md, CLAUDE_CODE_STAGES.md, CLAUDE_CODE_GUIDE.md, architecture.md, demo-script.md}
```

## 5. Coding conventions
- **Contract-first.** The `detect()` return shape (SPEC §6), OpenAPI stubs, and GeoJSON layer
  shapes are FROZEN on Day 1. Do not change a frozen contract without an explicit stage saying so.
- **Stub-first backend.** `services/detector.py` returns fixed fake JSON until real `weights/best.pt`
  exists, selected by env `DETECTOR_MODE=stub|real`. The full pipeline must be testable with the stub.
- Keep files small and single-purpose. Prefer boring, well-known patterns over cleverness.
- Every spatial distance is computed **once** at hotspot create/update and stored on the row.
  Never recompute geo-context per request.
- All tunable numbers (radii, thresholds, weights, ORS quota, demo area bbox) live in `config.py` /
  `.env`, never hard-coded in logic. OPEN ITEMS (SPEC §20) MUST read from config/env.
- Pydantic for all request/response models. Illegal state transitions → HTTP 409. Role violations → 403.
- Python: type hints + `ruff`. TS/React: functional components, hooks, no class components.

## 6. Commands
```bash
make up            # docker compose up -d (postgres+postgis, api)   → PRIMARY dev entrypoint
make down          # stop stack
make schema        # apply backend/app/sql/schema.sql
make seed          # python seed/seed_demo.py
make reset-demo    # wipe + reseed simulated demo state
make test          # backend: pytest -q
make lint          # ruff check backend
cd frontend && npm run dev     # Vite dev server
cd frontend && npm run build   # production build for the demo laptop
```
Health check: `curl localhost:8000/health` → `{"status":"ok","postgis":true}`.

## 7. Definition of Done (every task)
- [ ] Acceptance criteria in the stage prompt pass as a **runnable check** (command/test/curl/UI behaviour).
- [ ] New logic has a test where SPEC requires one (scoring golden, dedupe scenarios, workflow 409/403, GIS ±5 m).
- [ ] No Honesty Rule (§2) violated in code, copy, DB, or API.
- [ ] `make test` and `make lint` pass. No secrets committed. `weights/`, real `.env`, uploads gitignored.
- [ ] Any OPEN ITEM touched is read from config/env and noted in the stage summary.
- [ ] Short summary written: what changed, how it was verified, what's next.

## 8. Do NOT build (out of scope)
Native mobile app · OTP / SMS / third-party SSO · notifications/email/push ·
segmentation / SAM / Grounding DINO · CLIP (P2 only) · learned reporter reliability (static 0.5) ·
trend-prediction models · satellite/drone/CCTV pipelines · **any person/vehicle/licence-plate detection** ·
websockets (use polling) · multi-city · i18n · payments/rewards/blockchain · hotspot polygons (circle only).

**Amended:** email/password auth WAS built (`routers/auth.py`, `auth_utils.py`) — register,
login, `/me`, PBKDF2-HMAC-SHA256 with a per-user salt, stdlib only so §3 still holds. The
seeded demo users and role switcher remain, so a demo never needs an account. This entry
previously forbade it and was out of step with the code; OTP and external SSO stay out.
P1 (tasks/routing F9, before/after F10) are built ONLY after the P0 cut line (F1–F7 + F11 + KPI F8).

## 9. Design language (for "great UI/UX" within the fixed stack)
Neutral canvas, one confident accent, data does the talking. Details in SPEC §9 + Stage 8/9.
- **Priority ramp (4 steps):** Low `#64748b` · Medium `#f59e0b` · High `#f97316` · Critical `#ef4444`.
- **Evidence styling:** weak/unverified hotspots = **dashed** ring + reduced fill opacity; human-verified = solid + subtle glow.
- **Simulated badge:** amber pill, dashed border, "SIMULATED". **Non-attribution note:** persistent footer chip on authority views.
- Tokens in `frontend/src/lib/theme.ts` (colors, spacing scale, radius, shadow). Support light + dark.
- Micro-interactions via Tailwind transitions only (animate score bars filling, marker hover lift, tab
  underline slide, skeleton shimmer). Every list/map/chart needs deliberate loading / empty / error states.
- Accessibility: never encode meaning in colour alone (pair band colour with a label/icon); focus rings; hit targets ≥40px.

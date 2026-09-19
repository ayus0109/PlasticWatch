# PlasticWatch (PS-08)

AI-GIS detection and prioritisation of **likely** plastic-waste hotspots from citizen photo
reports. Reports are graded by evidence, merged into hotspots, ranked by impact, and cleared
only after a human authority verifies and confirms. SDGs 11/12/14. Dataset: TACO.

> **Reports show waste appears to be present; they do not establish who is responsible.**

The honesty and ethics rules in [CLAUDE.md](CLAUDE.md) §2 govern all code, copy, DB columns and
API fields. They are non-negotiable — read them before contributing.

---

## Quickstart

Requires **Docker Desktop** (running). Nothing else is needed for the backend.

```bash
cp .env.example .env     # then edit DEMO_AREA_* when the team picks a city
make up                  # builds + starts postgis and the api
curl -s localhost:8000/health
```

Expected: `{"status":"ok","postgis":true}`. Interactive API docs at <http://localhost:8000/docs>.

Verify the schema landed — all 10 tables:

```bash
docker compose exec db psql -U plasticwatch -d plasticwatch -c "\dt"
```

Stop the stack:

```bash
make down
```

### On Windows (no `make`)

`make` is not installed with Git for Windows. Use the raw commands:

| Target | Equivalent |
|---|---|
| `make up` | `docker compose up -d --build` |
| `make down` | `docker compose down` |
| `make schema` | `docker compose exec -T db psql -U plasticwatch -d plasticwatch < backend/app/sql/schema.sql` |
| `make seed` | `docker compose exec api python seed/seed_demo.py` |
| `make reset-demo` | `docker compose exec api python seed/seed_demo.py --reset` |
| `make test` | `docker compose exec api pytest -q` |
| `make lint` | `docker compose exec api ruff check .` |

`make seed` / `make reset-demo` refer to `seed/seed_demo.py`, which arrives in a later stage.

### Frontend

```bash
cd frontend && npm run dev     # Vite dev server
cd frontend && npm run build   # production build for the demo laptop
```

The frontend app is scaffolded in a later stage; `frontend/src/` currently holds the folder
structure only.

---

## What's in the box

| Path | Purpose |
|---|---|
| `docker-compose.yml` | `db` (postgis/postgis:16-3.4) + `api` (FastAPI, hot reload) |
| `backend/app/config.py` | every tunable, read from env — no hard-coded radii or weights |
| `backend/app/db.py` | SQLAlchemy **Core** engine + `get_conn` dependency (no ORM) |
| `backend/app/sql/schema.sql` | the 10 tables of SPEC §7, SRID 4326, GiST indexes |
| `backend/app/main.py` | app wiring, schema bootstrap on startup, `GET /health` |
| `backend/app/schemas.py` | **frozen API contract** — every request/response model + the SPEC §6 detector output |
| `backend/app/deps.py` | demo auth (HMAC-signed role token) + `require_role` → 403 |
| `backend/app/routers/` | every SPEC §8 endpoint |
| `backend/fixtures/` | simulated example payloads (all `is_simulated: true`) |

### Demo auth

There is no real authentication (CLAUDE.md §8). The login page lists seeded accounts from
`GET /auth/demo-users`; `POST /auth/demo-login` with `{"role": "authority"}` (or a `user_id`)
returns a bearer token. Send it as `Authorization: Bearer <token>`. A role mismatch is a 403.

### Database

Ten tables (SPEC §7): `users`, `wards`, `geo_features`, `hotspots`, `reports`, `detections`,
`hotspot_events`, `cleanup_tasks`, `task_stops`, `before_after`.

Geometry is SRID 4326 throughout; distances use `::geography`; every geometry column has a
GiST index. The schema is applied automatically the first time the API starts against an empty
database, and `schema.sql` is idempotent.

**There is deliberately no column anywhere naming a responsible party.** Reports whose
geolocation is fabricated for the demo carry `reports.is_simulated = true` — TACO images have
no GPS, so all seeded geotags are simulated. A hotspot counts as simulated when any of its
reports is; the API returns that flag and the UI badges it.

Nothing reaches Verified, Resolved or False-positive without a human action. Every hotspot
status change writes a `hotspot_events` row whose `actor_id` records the human who acted, and
`before_after.review_decision` stays NULL until an authority confirms the cleanup.

### Configuration

All tunables live in `.env` (see `.env.example`). Two entries are **OPEN ITEMS** the team must
still decide (SPEC §20):

- `DEMO_AREA_BBOX` / `DEMO_AREA_NAME` — the demo city. Blocks the OSM pull, wards and seeding.
- `ORS_DAILY_QUOTA` — confirm the current OpenRouteService free-tier `/optimization` quota.

`DETECTOR_MODE` stays `stub` until real weights exist; the full pipeline must stay demoable on
the stub.

---

## Repo layout

```
backend/app/{main,config,db}.py    routers/  services/  sql/schema.sql
backend/{weights,tests,fixtures}/  ml/{notebooks,scripts,reports}/
gis/{overpass_queries,raw,processed}/   seed/   frontend/src/
docs/{SPEC,USERFLOW,CLAUDE_CODE_STAGES,CLAUDE_CODE_GUIDE}.md
```

`backend/weights/`, `.env`, `uploads/` and `node_modules/` are gitignored.

## Docs

- [CLAUDE.md](CLAUDE.md) — project law: honesty rules, stack, conventions, scope
- [docs/SPEC.md](docs/SPEC.md) — source of truth: schema, API, scoring, workflows
- [docs/USERFLOW.md](docs/USERFLOW.md) — citizen and authority journeys
- [docs/CLAUDE_CODE_STAGES.md](docs/CLAUDE_CODE_STAGES.md) — staged build prompts
- [docs/CLAUDE_CODE_GUIDE.md](docs/CLAUDE_CODE_GUIDE.md) — parallel work map, day plan

## Attribution

Geo data © OpenStreetMap contributors. Detection uses Ultralytics YOLO (AGPL-3.0).

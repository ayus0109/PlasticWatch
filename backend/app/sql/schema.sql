-- PlasticWatch schema — 10 tables. Faithful transcription of docs/SPEC.md §7.
-- Idempotent: safe to re-run.
--
-- HONESTY CONSTRAINTS ENCODED HERE (CLAUDE.md §2 — non-negotiable):
--   * There is deliberately NO column anywhere naming a responsible party. Reports
--     record that waste appears to be present, never who put it there.
--   * reports.is_simulated marks every row whose geolocation is fabricated for the
--     demo (TACO images carry no GPS). A hotspot is "simulated" when any member
--     report is — derived in the query, not stored, so §7 stays faithful.
--   * Nothing reaches verified / false_positive / resolved without a human action.
--     The acting human is recorded in hotspot_events.actor_id, which §8 requires on
--     EVERY hotspot mutation; before_after.reviewed_by + review_decision stay NULL
--     until an authority confirms. The system never auto-resolves.
--   * Detection classes cover litter only. No person, vehicle or licence-plate class
--     may ever be added to detections.class_name.
--
-- Geometry is SRID 4326; distances are computed with ::geography.
-- Every geometry column has a GiST index.

CREATE EXTENSION IF NOT EXISTS postgis;


-- 1. wards -------------------------------------------------------------------
-- wards(id serial PK, name, geom geometry(MultiPolygon,4326))
CREATE TABLE IF NOT EXISTS wards (
    id      serial PRIMARY KEY,
    name    text NOT NULL,
    geom    geometry(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wards_geom ON wards USING GIST (geom);


-- 2. users -------------------------------------------------------------------
-- users(id uuid PK, name, role CHECK in ('citizen','authority','team'),
--       ward_id FK→wards null, reliability real default 0.5, created_at)
CREATE TABLE IF NOT EXISTS users (
    id              uuid PRIMARY KEY,
    name            text NOT NULL,
    email           text,
    hashed_password text,
    role            text NOT NULL
                    CHECK (role IN ('citizen', 'authority', 'team')),
    ward_id         integer REFERENCES wards (id),
    -- Static 0.5; learned reporter reliability is out of scope (CLAUDE.md §8).
    reliability     real NOT NULL DEFAULT 0.5,
    is_simulated    boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_simulated boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;


-- 3. geo_features ------------------------------------------------------------
-- geo_features(id serial PK, kind CHECK in (...), name, source ('osm'|'manual'),
--              geom geometry(Geometry,4326))
-- Pulled from Overpass ONCE and stored; no Overpass calls at runtime (SPEC §5).
-- Mixed geometry: drains are lines, water bodies polygons, amenities points.
CREATE TABLE IF NOT EXISTS geo_features (
    id      serial PRIMARY KEY,
    kind    text NOT NULL
            CHECK (kind IN ('drain', 'water', 'school', 'hospital', 'market')),
    name    text,
    -- 'manual' = digitised by the team where OSM drain coverage is thin (SPEC §20.5).
    source  text NOT NULL DEFAULT 'osm'
            CHECK (source IN ('osm', 'manual')),
    geom    geometry(Geometry, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_geo_features_geom ON geo_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_geo_features_kind ON geo_features (kind);


-- 4. hotspots ----------------------------------------------------------------
-- hotspots(id serial PK, geom geometry(Point,4326), radius_m real, ward_id FK,
--          status text, first_reported_at, last_reported_at,
--          report_count int, unique_reporters int, recurrence_returns int,
--          d_drain_m, d_water_m, d_school_m, d_hospital_m, d_market_m real,
--          severity, recurrence, sensitivity, persistence real,
--          impact_score real, evidence_score real, priority_band text,
--          score_breakdown jsonb, scored_at)
-- A hotspot is a circle (centroid + radius), never a polygon (CLAUDE.md §8).
-- Geo-context distances are computed ONCE at create/update and stored on the row —
-- never recomputed per request (SPEC §10).
CREATE TABLE IF NOT EXISTS hotspots (
    id                  serial PRIMARY KEY,
    geom                geometry(Point, 4326) NOT NULL,
    radius_m            real,
    ward_id             integer REFERENCES wards (id),

    -- Status machine (SPEC §13). Only an authority may set verified,
    -- false_positive or resolved.
    status              text NOT NULL DEFAULT 'ai_detected'
                        CHECK (status IN (
                            'ai_detected',
                            'needs_verification',
                            'verified',
                            'cleanup_scheduled',
                            'cleanup_completed',
                            'resolved',
                            'false_positive'
                        )),

    first_reported_at   timestamptz,
    last_reported_at    timestamptz,

    report_count        integer NOT NULL DEFAULT 0,
    unique_reporters    integer NOT NULL DEFAULT 0,
    recurrence_returns  integer NOT NULL DEFAULT 0,

    -- Stored geo-context (SPEC §10). NULL = not yet computed.
    d_drain_m           real,
    d_water_m           real,
    d_school_m          real,
    d_hospital_m        real,
    d_market_m          real,

    -- The four Impact factors, each normalised 0–1 (SPEC §11).
    severity            real,
    recurrence          real,
    sensitivity         real,
    persistence         real,

    impact_score        real,
    evidence_score      real,
    priority_band       text
                        CHECK (priority_band IN ('low', 'medium', 'high', 'critical')),
    -- Per-factor value / weight / contribution for the explanation card. The weights
    -- are tunable proposals, not published truth (CLAUDE.md §2.8).
    score_breakdown     jsonb,
    scored_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_hotspots_geom ON hotspots USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_hotspots_geog ON hotspots USING GIST ((geom::geography));
CREATE INDEX IF NOT EXISTS idx_hotspots_status ON hotspots (status);
CREATE INDEX IF NOT EXISTS idx_hotspots_ward ON hotspots (ward_id);


-- 5. reports -----------------------------------------------------------------
-- reports(id uuid PK, reporter_id FK→users, hotspot_id FK→hotspots null,
--         duplicate_of FK→reports null, image_path, image_phash text,
--         geom geometry(Point,4326), gps_accuracy_m real,
--         location_source ('browser'|'exif'|'pin'), captured_at, created_at, note,
--         ai_status ('detected'|'not_detected'|'error'), report_confidence real,
--         plastic_count int, plastic_area_frac real, severity real,
--         is_simulated bool default false)
-- A citizen report records that waste appears to be present at a location — it does
-- not establish who is responsible (CLAUDE.md §2.3).
CREATE TABLE IF NOT EXISTS reports (
    id                  uuid PRIMARY KEY,
    reporter_id         uuid NOT NULL REFERENCES users (id),
    hotspot_id          integer REFERENCES hotspots (id),
    -- Set when pHash matched an existing image: attached as evidence but NOT counted
    -- as new unique evidence (SPEC §12 step 1).
    duplicate_of        uuid REFERENCES reports (id),

    image_path          text NOT NULL,
    -- Perceptual hash for duplicate images (SPEC §12, Hamming <= 6).
    image_phash         text,

    geom                geometry(Point, 4326) NOT NULL,
    gps_accuracy_m      real,
    location_source     text NOT NULL
                        CHECK (location_source IN ('browser', 'exif', 'pin')),

    captured_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    note                text,
    reporter_name       text,
    reporter_phone      text,

    -- Frozen detector contract (SPEC §6). "likely plastic" counts, never "plastic".
    ai_status           text
                        CHECK (ai_status IN ('detected', 'not_detected', 'error')),
    report_confidence   real,
    plastic_count       integer,
    plastic_area_frac   real,
    -- Per-report Severity S (SPEC §11); the hotspot averages the latest 3.
    severity            real,

    -- TACO images have no GPS; demo geotags are fabricated (CLAUDE.md §2.2).
    is_simulated        boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_reports_geom ON reports USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_reports_geog ON reports USING GIST ((geom::geography));
CREATE INDEX IF NOT EXISTS idx_reports_hotspot ON reports (hotspot_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at);


-- 6. detections --------------------------------------------------------------
-- detections(id serial PK, report_id FK→reports, class_name, confidence real,
--            x1,y1,x2,y2 real, area_frac real)
-- Five classes collapsed from TACO's 60; the four plastic_* classes are
-- "plastic-likely". NEVER add a person, vehicle or licence-plate class (CLAUDE.md §2.4).
CREATE TABLE IF NOT EXISTS detections (
    id          serial PRIMARY KEY,
    report_id   uuid NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
    class_name  text NOT NULL
                CHECK (class_name IN (
                    'plastic_bottle',
                    'plastic_bag_film',
                    'plastic_packaging',
                    'plastic_other',
                    'non_plastic_litter'
                )),
    -- Raw model confidence. NOT a calibrated probability — the UI must show a
    -- Low/Medium/High tier beside it (CLAUDE.md §2.7).
    confidence  real NOT NULL,
    x1          real NOT NULL,
    y1          real NOT NULL,
    x2          real NOT NULL,
    y2          real NOT NULL,
    area_frac   real
);

CREATE INDEX IF NOT EXISTS idx_detections_report ON detections (report_id);


-- 7. hotspot_events ----------------------------------------------------------
-- hotspot_events(id serial PK, hotspot_id FK, actor_id FK→users null,
--                from_status, to_status, reason, note, created_at)   -- audit log
-- EVERY hotspot mutation writes a row here (SPEC §8). actor_id is the human who
-- acted, or NULL for system transitions (e.g. ai_detected on create). This is the
-- record of the human verification gate.
CREATE TABLE IF NOT EXISTS hotspot_events (
    id          serial PRIMARY KEY,
    hotspot_id  integer NOT NULL REFERENCES hotspots (id) ON DELETE CASCADE,
    actor_id    uuid REFERENCES users (id),
    from_status text,
    to_status   text NOT NULL,
    -- Reject reasons frozen in SPEC §13; NULL for non-reject transitions.
    reason      text
                CHECK (reason IS NULL OR reason IN (
                    'not_plastic',
                    'no_waste_visible',
                    'wrong_location',
                    'duplicate',
                    'already_cleaned',
                    'other'
                )),
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hotspot_events_hotspot ON hotspot_events (hotspot_id);
CREATE INDEX IF NOT EXISTS idx_hotspot_events_created_at ON hotspot_events (created_at);


-- 8. cleanup_tasks -----------------------------------------------------------
-- cleanup_tasks(id serial PK, created_by FK→users, assigned_team FK→users,
--               status ('planned'|'in_progress'|'done'), depot geometry(Point,4326),
--               route_geojson jsonb, route_distance_m, route_duration_s, created_at)
-- Routes cover VERIFIED hotspots only (SPEC §8/§13).
CREATE TABLE IF NOT EXISTS cleanup_tasks (
    id                serial PRIMARY KEY,
    created_by        uuid REFERENCES users (id),
    assigned_team     uuid REFERENCES users (id),
    status            text NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned', 'in_progress', 'done')),
    depot             geometry(Point, 4326),
    -- ORS /optimization geometry, or straight lines from the greedy fallback (SPEC §10).
    route_geojson     jsonb,
    route_distance_m  real,
    route_duration_s  real,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleanup_tasks_depot ON cleanup_tasks USING GIST (depot);
CREATE INDEX IF NOT EXISTS idx_cleanup_tasks_team ON cleanup_tasks (assigned_team);


-- 9. task_stops --------------------------------------------------------------
-- task_stops(id serial PK, task_id FK, hotspot_id FK, seq int,
--            arrived_at, completed_at)
CREATE TABLE IF NOT EXISTS task_stops (
    id            serial PRIMARY KEY,
    task_id       integer NOT NULL REFERENCES cleanup_tasks (id) ON DELETE CASCADE,
    hotspot_id    integer NOT NULL REFERENCES hotspots (id),
    seq           integer NOT NULL,
    arrived_at    timestamptz,
    completed_at  timestamptz,
    UNIQUE (task_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_task_stops_task ON task_stops (task_id);
CREATE INDEX IF NOT EXISTS idx_task_stops_hotspot ON task_stops (hotspot_id);


-- 10. before_after -----------------------------------------------------------
-- before_after(id serial PK, task_stop_id FK, before_report_id FK→reports,
--              after_image_paths text[], before_count int, before_area real,
--              after_count int, after_area real, reduction_ratio real,
--              quality_flags jsonb, viewpoint_match real,
--              verdict ('likely_cleaned'|'partial'|'not_cleaned'|'inconclusive'),
--              reviewed_by FK→users null, review_decision text null, created_at)
-- The system computes a verdict but NEVER auto-resolves: reviewed_by and
-- review_decision stay NULL until an authority inspects the photos side by side
-- (CLAUDE.md §2.5). Absence of detections after cleanup is not proof of
-- cleanliness (CLAUDE.md §2.6).
CREATE TABLE IF NOT EXISTS before_after (
    id                 serial PRIMARY KEY,
    task_stop_id       integer REFERENCES task_stops (id),
    before_report_id   uuid REFERENCES reports (id),

    -- Two after-photos: one wide, one close (SPEC §14).
    after_image_paths  text[],

    before_count       integer,
    before_area        real,
    after_count        integer,
    after_area         real,
    -- 1 - (after plastic area / before plastic area), using the WORSE after-photo.
    reduction_ratio    real,

    -- Blur / brightness / location / viewpoint gate results (SPEC §14).
    quality_flags      jsonb,
    -- ORB viewpoint match against the before image.
    viewpoint_match    real,

    verdict            text
                       CHECK (verdict IN (
                           'likely_cleaned',
                           'partial',
                           'not_cleaned',
                           'inconclusive'
                       )),

    -- Human approval gate — both NULL until an authority reviews (CLAUDE.md §2.5).
    reviewed_by        uuid REFERENCES users (id),
    review_decision    text
                       CHECK (review_decision IS NULL OR review_decision IN (
                           'confirm_resolved',
                           'reject'
                       )),

    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_before_after_stop ON before_after (task_stop_id);
CREATE INDEX IF NOT EXISTS idx_before_after_report ON before_after (before_report_id);

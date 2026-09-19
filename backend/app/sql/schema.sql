-- PlasticWatch schema — 10 tables (SPEC §7). Idempotent: safe to re-run.
--
-- HONESTY CONSTRAINTS ENCODED HERE (CLAUDE.md §2 — non-negotiable):
--   * There is deliberately NO column anywhere naming a responsible party. Reports
--     record that waste appears to be present, never who put it there.
--   * is_simulated marks every row whose geolocation or identity is fabricated for
--     the demo (TACO images carry no GPS).
--   * Columns that only a human authority may fill (verified_by, resolved_at,
--     review_decision, reviewed_by) are nullable with no default — nothing reaches
--     verified / resolved / false_positive without a human action.
--   * Detection classes cover litter only. No person, vehicle or licence-plate class
--     may ever be added to detections.class_name.
--
-- Geometry is SRID 4326 throughout; distances are computed with ::geography.
-- Every geometry column has a GiST index.

CREATE EXTENSION IF NOT EXISTS postgis;


-- 1. users -------------------------------------------------------------------
-- Seeded demo accounts only (no real auth — CLAUDE.md §8).
CREATE TABLE IF NOT EXISTS users (
    id              bigserial PRIMARY KEY,
    name            text        NOT NULL,
    role            text        NOT NULL
                    CHECK (role IN ('citizen', 'authority', 'team')),
    -- Static 0.5 for the hackathon; learned reliability is out of scope (SPEC §11).
    reliability     numeric(4, 3) NOT NULL DEFAULT 0.5
                    CHECK (reliability >= 0 AND reliability <= 1),
    ward_id         bigint,
    is_simulated    boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);


-- 2. wards -------------------------------------------------------------------
-- Administrative boundaries from OSM, pulled once (SPEC §5). Ward lookup = ST_Contains.
CREATE TABLE IF NOT EXISTS wards (
    id              bigserial PRIMARY KEY,
    name            text        NOT NULL,
    code            text,
    geom            geometry(MultiPolygon, 4326) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wards_geom ON wards USING GIST (geom);

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS fk_users_ward;
ALTER TABLE users
    ADD CONSTRAINT fk_users_ward FOREIGN KEY (ward_id) REFERENCES wards (id);


-- 3. geo_features ------------------------------------------------------------
-- Drains, water bodies, schools, hospitals, markets. Pulled from Overpass ONCE and
-- stored; no Overpass calls at runtime (SPEC §5). Mixed geometry types, so the column
-- is generic: drains are lines, water bodies polygons, amenities points.
CREATE TABLE IF NOT EXISTS geo_features (
    id              bigserial PRIMARY KEY,
    kind            text        NOT NULL
                    CHECK (kind IN ('drain', 'water', 'school', 'hospital', 'market')),
    name            text,
    -- 'manual' = digitised by the team where OSM drain coverage is thin (SPEC §20.5).
    source          text        NOT NULL DEFAULT 'osm'
                    CHECK (source IN ('osm', 'manual')),
    osm_id          text,
    geom            geometry(Geometry, 4326) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_geo_features_geom ON geo_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_geo_features_kind ON geo_features (kind);


-- 4. hotspots ----------------------------------------------------------------
-- A hotspot is a circle (centroid + radius), never a polygon (CLAUDE.md §8).
-- Geo-context distances are computed ONCE at create/update and stored on the row —
-- never recomputed per request (SPEC §10).
CREATE TABLE IF NOT EXISTS hotspots (
    id                  bigserial PRIMARY KEY,
    geom                geometry(Point, 4326) NOT NULL,
    radius_m            numeric(8, 2) NOT NULL DEFAULT 0,

    -- Status machine (SPEC §13). Only an authority may set verified,
    -- false_positive or resolved.
    status              text        NOT NULL DEFAULT 'ai_detected'
                        CHECK (status IN (
                            'ai_detected',
                            'needs_verification',
                            'verified',
                            'cleanup_scheduled',
                            'cleanup_completed',
                            'resolved',
                            'false_positive'
                        )),

    -- Two-axis scoring (SPEC §11). Impact ranks; Evidence controls what may be claimed.
    impact_score        numeric(5, 2)
                        CHECK (impact_score >= 0 AND impact_score <= 100),
    priority_band       text
                        CHECK (priority_band IN ('low', 'medium', 'high', 'critical')),
    evidence_score      numeric(4, 3)
                        CHECK (evidence_score >= 0 AND evidence_score <= 1),
    evidence_band       text
                        CHECK (evidence_band IN ('low', 'moderate', 'strong')),
    -- Per-factor value / weight / contribution for the explanation card. The weights
    -- are tunable proposals, not published truth (CLAUDE.md §2.8).
    score_breakdown     jsonb,

    -- Evidence counters (SPEC §11/§12)
    report_count        integer     NOT NULL DEFAULT 0,
    unique_reporters    integer     NOT NULL DEFAULT 0,
    recurrence_returns  integer     NOT NULL DEFAULT 0,

    first_reported_at   timestamptz,
    last_reported_at    timestamptz,
    resolved_at         timestamptz,

    -- Stored geo-context (SPEC §10). NULL = not yet computed.
    ward_id             bigint      REFERENCES wards (id),
    dist_drain_m        numeric(10, 2),
    dist_water_m        numeric(10, 2),
    dist_school_m       numeric(10, 2),
    dist_hospital_m     numeric(10, 2),
    dist_market_m       numeric(10, 2),

    -- Human verification gate (CLAUDE.md §2.5) — NULL until an authority acts.
    verified_by         bigint      REFERENCES users (id),
    verified_at         timestamptz,

    is_simulated        boolean     NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hotspots_geom ON hotspots USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_hotspots_geog ON hotspots USING GIST ((geom::geography));
CREATE INDEX IF NOT EXISTS idx_hotspots_status ON hotspots (status);
CREATE INDEX IF NOT EXISTS idx_hotspots_ward ON hotspots (ward_id);


-- 5. reports -----------------------------------------------------------------
-- A citizen report. Records that waste appears to be present at a location — it does
-- not establish who is responsible (CLAUDE.md §2.3).
CREATE TABLE IF NOT EXISTS reports (
    id                      bigserial PRIMARY KEY,
    user_id                 bigint      NOT NULL REFERENCES users (id),

    image_path              text        NOT NULL,
    annotated_image_path    text,
    -- Perceptual hash for duplicate images (SPEC §12 step 1, Hamming <= 6).
    image_phash             text,

    lat                     double precision NOT NULL,
    lon                     double precision NOT NULL,
    geom                    geometry(Point, 4326) NOT NULL,
    gps_accuracy_m          numeric(8, 2),
    location_source         text        NOT NULL
                            CHECK (location_source IN ('browser', 'exif', 'pin')),
    -- Set when GPS accuracy forced the dedupe radius to widen (SPEC §12 step 2).
    low_location_accuracy   boolean     NOT NULL DEFAULT false,

    note                    text,

    -- Frozen detector contract (SPEC §6). "likely plastic" counts, never "plastic".
    plastic_count           integer,
    plastic_area_frac       numeric(5, 4)
                            CHECK (plastic_area_frac >= 0 AND plastic_area_frac <= 1),
    report_confidence       numeric(4, 3)
                            CHECK (report_confidence >= 0 AND report_confidence <= 1),
    ai_status               text
                            CHECK (ai_status IN ('detected', 'not_detected', 'error')),

    hotspot_id              bigint      REFERENCES hotspots (id),
    -- Set when pHash matched an existing image: attached as evidence but NOT counted
    -- as new unique evidence (SPEC §12 step 1).
    duplicate_of_report_id  bigint      REFERENCES reports (id),

    -- TACO images have no GPS; demo geotags are fabricated (CLAUDE.md §2.2).
    is_simulated            boolean     NOT NULL DEFAULT false,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_geom ON reports USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_reports_geog ON reports USING GIST ((geom::geography));
CREATE INDEX IF NOT EXISTS idx_reports_hotspot ON reports (hotspot_id);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at);


-- 6. detections --------------------------------------------------------------
-- One row per box from the detector (SPEC §6). Five classes collapsed from TACO's 60;
-- the four plastic_* classes are "plastic-likely".
-- NEVER add a person, vehicle or licence-plate class here (CLAUDE.md §2.4).
CREATE TABLE IF NOT EXISTS detections (
    id              bigserial PRIMARY KEY,
    report_id       bigint      NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
    class_name      text        NOT NULL
                    CHECK (class_name IN (
                        'plastic_bottle',
                        'plastic_bag_film',
                        'plastic_packaging',
                        'plastic_other',
                        'non_plastic_litter'
                    )),
    -- Raw model confidence. NOT a calibrated probability — the UI must show a
    -- Low/Medium/High tier beside it (CLAUDE.md §2.7).
    confidence      numeric(4, 3) NOT NULL
                    CHECK (confidence >= 0 AND confidence <= 1),
    x1              numeric(10, 2) NOT NULL,
    y1              numeric(10, 2) NOT NULL,
    x2              numeric(10, 2) NOT NULL,
    y2              numeric(10, 2) NOT NULL,
    area_frac       numeric(5, 4)
                    CHECK (area_frac >= 0 AND area_frac <= 1),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_detections_report ON detections (report_id);


-- 7. hotspot_events ----------------------------------------------------------
-- Audit log: EVERY hotspot mutation writes a row here (SPEC §8). actor_id is the human
-- who acted, or NULL for system-generated transitions (e.g. ai_detected on create).
CREATE TABLE IF NOT EXISTS hotspot_events (
    id              bigserial PRIMARY KEY,
    hotspot_id      bigint      NOT NULL REFERENCES hotspots (id) ON DELETE CASCADE,
    from_status     text,
    to_status       text        NOT NULL,
    -- Reject reasons frozen in SPEC §13; NULL for non-reject transitions.
    reason          text
                    CHECK (reason IS NULL OR reason IN (
                        'not_plastic',
                        'no_waste_visible',
                        'wrong_location',
                        'duplicate',
                        'already_cleaned',
                        'other'
                    )),
    note            text,
    actor_id        bigint      REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hotspot_events_hotspot ON hotspot_events (hotspot_id);
CREATE INDEX IF NOT EXISTS idx_hotspot_events_created_at ON hotspot_events (created_at);


-- 8. cleanup_tasks -----------------------------------------------------------
-- An optimised cleanup route over VERIFIED hotspots only (SPEC §8/§13).
CREATE TABLE IF NOT EXISTS cleanup_tasks (
    id                  bigserial PRIMARY KEY,
    team_id             bigint      NOT NULL REFERENCES users (id),
    created_by          bigint      REFERENCES users (id),
    depot               geometry(Point, 4326),
    status              text        NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    -- ORS /optimization geometry, or straight lines from the greedy fallback (SPEC §10).
    route_geom          geometry(LineString, 4326),
    route_source        text
                        CHECK (route_source IN ('ors', 'greedy')),
    total_distance_m    numeric(12, 2),
    total_duration_s    integer,
    created_at          timestamptz NOT NULL DEFAULT now(),
    started_at          timestamptz,
    completed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cleanup_tasks_depot ON cleanup_tasks USING GIST (depot);
CREATE INDEX IF NOT EXISTS idx_cleanup_tasks_route ON cleanup_tasks USING GIST (route_geom);
CREATE INDEX IF NOT EXISTS idx_cleanup_tasks_team ON cleanup_tasks (team_id);


-- 9. task_stops --------------------------------------------------------------
-- One stop per hotspot on a route, in visit order.
CREATE TABLE IF NOT EXISTS task_stops (
    id                  bigserial PRIMARY KEY,
    task_id             bigint      NOT NULL REFERENCES cleanup_tasks (id) ON DELETE CASCADE,
    hotspot_id          bigint      NOT NULL REFERENCES hotspots (id),
    seq                 integer     NOT NULL,
    status              text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'arrived', 'completed', 'skipped')),
    arrived_at          timestamptz,
    -- Distance from the hotspot when the team marked arrival (SPEC §8: within 50 m).
    arrival_distance_m  numeric(10, 2),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (task_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_task_stops_task ON task_stops (task_id);
CREATE INDEX IF NOT EXISTS idx_task_stops_hotspot ON task_stops (hotspot_id);


-- 10. before_after -----------------------------------------------------------
-- Cleanup evidence (SPEC §14). The system computes a verdict but NEVER auto-resolves:
-- review_decision stays NULL until an authority inspects the photos side by side.
-- Absence of detections after cleanup is not proof of cleanliness (CLAUDE.md §2.6).
CREATE TABLE IF NOT EXISTS before_after (
    id                      bigserial PRIMARY KEY,
    hotspot_id              bigint      NOT NULL REFERENCES hotspots (id) ON DELETE CASCADE,
    task_stop_id            bigint      REFERENCES task_stops (id),
    before_report_id        bigint      REFERENCES reports (id),

    -- Two after-photos: one wide, one close (SPEC §14).
    after_image_wide_path   text,
    after_image_close_path  text,

    after_plastic_count     integer,
    after_plastic_area_frac numeric(5, 4)
                            CHECK (after_plastic_area_frac >= 0 AND after_plastic_area_frac <= 1),
    -- 1 - (after plastic area / before plastic area), using the WORSE after-photo.
    reduction_ratio         numeric(5, 4),
    -- ORB viewpoint match against the before image.
    viewpoint_match_score   numeric(5, 4),
    quality_ok              boolean,

    verdict                 text
                            CHECK (verdict IN (
                                'likely_cleaned',
                                'partial',
                                'not_cleaned',
                                'inconclusive'
                            )),

    -- Human approval gate — NULL until an authority reviews (CLAUDE.md §2.5).
    review_decision         text
                            CHECK (review_decision IS NULL OR review_decision IN (
                                'confirm_resolved',
                                'reject'
                            )),
    reviewed_by             bigint      REFERENCES users (id),
    reviewed_at             timestamptz,
    review_note             text,

    submitted_by            bigint      REFERENCES users (id),
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_before_after_hotspot ON before_after (hotspot_id);
CREATE INDEX IF NOT EXISTS idx_before_after_stop ON before_after (task_stop_id);

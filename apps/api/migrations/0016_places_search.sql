-- 0016_places_search: lot 7 places (organisation locations) and universal search history.
-- Forward-only. Never edit an applied migration: add a new one.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('search', 'Recherche universelle et lieux (organisations autour d''un point)', true, false);

-- Organisation location (ADR-019: plain double precision + bounding-box index, PostGIS later).
-- Coordinates come from the organisation only; no user position is ever stored.
ALTER TABLE organizations
  ADD COLUMN lat double precision,
  ADD COLUMN lng double precision,
  ADD COLUMN location_label text,
  ADD CONSTRAINT organizations_location_check CHECK (
    (lat IS NULL AND lng IS NULL AND location_label IS NULL)
    OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)),
  ADD CONSTRAINT organizations_location_label_check CHECK (location_label IS NULL OR char_length(location_label) BETWEEN 1 AND 120);
CREATE INDEX organizations_geo_idx ON organizations (lat, lng) WHERE lat IS NOT NULL AND status = 'active' AND visibility = 'public';

-- Search history: private to its owner, at most 50 rows per user (enforced by the service).
CREATE TABLE search_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      text NOT NULL CONSTRAINT search_history_query_check CHECK (char_length(query) BETWEEN 1 AND 100),
  scope      text NOT NULL CONSTRAINT search_history_scope_check CHECK (scope IN ('all', 'users', 'orgs', 'products', 'posts')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_history_user_idx ON search_history (user_id, created_at DESC, id DESC);

-- Absent row = history enabled (default).
CREATE TABLE search_settings (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  history_enabled boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Trigram indexes when pg_trgm is available; otherwise searches fall back to plain ILIKE scans.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX users_display_name_trgm_idx ON users USING gin (lower(display_name) gin_trgm_ops);
  CREATE INDEX organizations_name_trgm_idx ON organizations USING gin (lower(name) gin_trgm_ops);
  CREATE INDEX posts_body_trgm_idx ON posts USING gin (lower(body) gin_trgm_ops) WHERE deleted_at IS NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable (%), search uses sequential ILIKE', SQLERRM;
END $$;

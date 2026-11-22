-- Places imported from OpenStreetMap (ODbL): source and stable key, so the import is idempotent
-- and never touches organisations created by users (source IS NULL).
ALTER TABLE organizations
  ADD COLUMN source text CHECK (source IN ('osm')),
  ADD COLUMN osm_type text CHECK (osm_type IN ('node', 'way', 'relation')),
  ADD COLUMN osm_id bigint,
  ADD CONSTRAINT organizations_osm_key_check CHECK ((source = 'osm') = (osm_id IS NOT NULL AND osm_type IS NOT NULL));
CREATE UNIQUE INDEX organizations_osm_key_idx ON organizations (osm_type, osm_id) WHERE source = 'osm';

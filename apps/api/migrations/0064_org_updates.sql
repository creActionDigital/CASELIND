-- 0064_org_updates: actualites de l'organisation (publications, promotions, evenements) sur la vitrine publique (CDC §5). Signalables (cible 'org_update'). Forward-only.
CREATE TABLE org_updates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind       text NOT NULL CONSTRAINT org_updates_kind_check CHECK (kind IN ('post', 'promo', 'event')),
  title      text NOT NULL CONSTRAINT org_updates_title_check CHECK (char_length(title) BETWEEN 1 AND 80),
  body       text NOT NULL CONSTRAINT org_updates_body_check CHECK (char_length(body) BETWEEN 1 AND 1000),
  starts_at  timestamptz,
  ends_at    timestamptz,
  place      text CONSTRAINT org_updates_place_check CHECK (place IS NULL OR char_length(place) BETWEEN 1 AND 120),
  hidden     boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_updates_event_start_check CHECK (kind <> 'event' OR starts_at IS NOT NULL),
  CONSTRAINT org_updates_dates_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX org_updates_org_idx ON org_updates (org_id, created_at DESC);

-- Liste complete de 0045 plus 'org_update'.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job', 'mission', 'course', 'course_review', 'scholarship', 'org_update'));

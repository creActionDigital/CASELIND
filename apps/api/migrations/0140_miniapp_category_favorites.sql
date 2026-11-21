-- 0140_miniapp_category_favorites: categorie du catalogue des mini-apps et favoris par utilisateur. Forward-only.
ALTER TABLE miniapps ADD COLUMN category text
  CONSTRAINT miniapps_category_check CHECK (category IS NULL OR category IN
    ('restaurants', 'hotels', 'ticketing', 'education', 'health', 'realestate', 'jobs', 'services', 'events', 'insurance', 'finance', 'administration'));
CREATE INDEX miniapps_category_idx ON miniapps (category, created_at DESC, id DESC) WHERE status = 'published';

CREATE TABLE miniapp_favorites (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id     uuid NOT NULL REFERENCES miniapps(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_id)
);

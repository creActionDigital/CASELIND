-- 0049_listing_visits: lot 15c visit appointments for classified ads. Forward-only. Deleted with the ad or the account.
CREATE TABLE listing_visits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  visitor_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  message      text NOT NULL DEFAULT '' CONSTRAINT listing_visits_message_check CHECK (length(message) <= 300),
  place        text CONSTRAINT listing_visits_place_check CHECK (place IS NULL OR length(place) BETWEEN 1 AND 200),
  status       text NOT NULL DEFAULT 'requested' CONSTRAINT listing_visits_status_check CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- At most one open (requested or confirmed) visit per visitor and ad.
CREATE UNIQUE INDEX listing_visits_open_uniq ON listing_visits (listing_id, visitor_id) WHERE status IN ('requested', 'confirmed');
CREATE INDEX listing_visits_visitor_idx ON listing_visits (visitor_id, created_at DESC);
CREATE INDEX listing_visits_listing_idx ON listing_visits (listing_id, created_at DESC);

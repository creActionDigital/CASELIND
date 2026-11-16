-- 0046_listing_alerts: lot 15b classified-ad alerts. Forward-only. Private to their owner, deleted with the account.
CREATE TABLE listing_alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  q          text CONSTRAINT listing_alerts_q_check CHECK (q IS NULL OR length(q) BETWEEN 1 AND 100),
  city       text CONSTRAINT listing_alerts_city_check CHECK (city IS NULL OR length(city) BETWEEN 1 AND 80),
  kind       text CONSTRAINT listing_alerts_kind_check CHECK (kind IS NULL OR kind IN ('property_rent', 'property_sale', 'roommate', 'vehicle', 'used_item', 'lost', 'found')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_alerts_criteria_check CHECK (q IS NOT NULL OR city IS NOT NULL OR kind IS NOT NULL)
);
CREATE INDEX listing_alerts_user_idx ON listing_alerts (user_id, created_at);

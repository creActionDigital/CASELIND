-- 0027_listings: lot 15 classified ads (property, vehicles, used goods, lost and found). Forward-only.
-- No payment, no verification partner: contact goes through CASELIND messaging, the ad states its own limits.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('listings', 'Petites annonces : immobilier, véhicules, occasion, objets perdus/trouvés', true, false);

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing'));

ALTER TABLE media_assets DROP CONSTRAINT media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('avatar', 'post', 'message', 'story', 'org_logo', 'org_banner', 'product', 'document', 'kyc_document', 'listing'));

CREATE TABLE listings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CONSTRAINT listings_kind_check
                 CHECK (kind IN ('property_rent', 'property_sale', 'roommate', 'vehicle', 'used_item', 'lost', 'found')),
  title        text NOT NULL CONSTRAINT listings_title_check CHECK (length(title) BETWEEN 3 AND 120),
  description  text NOT NULL DEFAULT '' CONSTRAINT listings_description_check CHECK (length(description) <= 2000),
  price_minor  bigint CONSTRAINT listings_price_check CHECK (price_minor IS NULL OR price_minor >= 0),
  currency     char(3) CONSTRAINT listings_currency_check CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  city         text NOT NULL CONSTRAINT listings_city_check CHECK (length(city) BETWEEN 2 AND 80),
  latitude     double precision CONSTRAINT listings_lat_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude    double precision CONSTRAINT listings_lng_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  status       text NOT NULL DEFAULT 'active' CONSTRAINT listings_status_check CHECK (status IN ('active', 'closed')),
  hidden       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listings_price_pair CHECK ((price_minor IS NULL) = (currency IS NULL)),
  CONSTRAINT listings_point_pair CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX listings_feed_idx ON listings (created_at DESC, id DESC) WHERE status = 'active' AND NOT hidden;
CREATE INDEX listings_owner_idx ON listings (owner_id, created_at DESC);

CREATE TABLE listing_media (
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  media_id   uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position   integer NOT NULL CONSTRAINT listing_media_position_check CHECK (position >= 0),
  PRIMARY KEY (listing_id, media_id)
);

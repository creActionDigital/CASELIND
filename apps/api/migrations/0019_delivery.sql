-- 0019_delivery: lot 8. Delivery zones and fees per organisation, one delivery per order to deliver,
-- append-only delivery events, proof by code, last courier position, courier rating.
-- Forward-only. Never edit an applied migration: add a new one.
-- No external carrier: couriers are members of the organisation (role `delivery`) or the seller itself.

CREATE TABLE delivery_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL CONSTRAINT delivery_zones_name_check CHECK (length(name) BETWEEN 1 AND 80),
  -- Normalised by the API (lower case, no accents, trimmed): matched against the order address city or second line.
  areas       text[] NOT NULL CONSTRAINT delivery_zones_areas_check CHECK (cardinality(areas) BETWEEN 1 AND 50),
  -- {"CDF": 5000, "USD": 300}: fee per currency in minor units.
  fees        jsonb NOT NULL CONSTRAINT delivery_zones_fees_check CHECK (jsonb_typeof(fees) = 'object' AND fees <> '{}'::jsonb),
  eta_minutes integer NOT NULL CONSTRAINT delivery_zones_eta_check CHECK (eta_minutes BETWEEN 5 AND 20160),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_zones_org_idx ON delivery_zones (org_id, created_at, id);
CREATE TRIGGER delivery_zones_set_updated_at BEFORE UPDATE ON delivery_zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Orders: how the order is fulfilled and what the delivery costs (included in total_minor).
-- Compatibility: existing orders were all delivered to an address: default 'delivery', fee 0, no delivery row.
ALTER TABLE orders ADD COLUMN fulfillment text NOT NULL DEFAULT 'delivery'
  CONSTRAINT orders_fulfillment_check CHECK (fulfillment IN ('delivery', 'pickup'));
ALTER TABLE orders ADD COLUMN delivery_fee_minor bigint NOT NULL DEFAULT 0
  CONSTRAINT orders_delivery_fee_check CHECK (delivery_fee_minor >= 0);
ALTER TABLE orders ADD COLUMN delivery_zone_id uuid REFERENCES delivery_zones(id) ON DELETE SET NULL;

CREATE TABLE deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id),
  org_id            uuid NOT NULL REFERENCES organizations(id),
  buyer_id          uuid NOT NULL REFERENCES users(id),
  courier_id        uuid REFERENCES users(id),
  status            text NOT NULL DEFAULT 'pending'
                      CONSTRAINT deliveries_status_check
                      CHECK (status IN ('pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned')),
  -- Proof by code: the code itself is derived on demand from (server key, id, nonce) so the buyer can see it;
  -- only its keyed hash is stored. Resetting the proof changes the nonce.
  proof_nonce       text NOT NULL,
  proof_hash        text NOT NULL,
  proof_attempts    integer NOT NULL DEFAULT 0 CONSTRAINT deliveries_proof_attempts_check CHECK (proof_attempts BETWEEN 0 AND 5),
  proof_locked_at   timestamptz,
  -- Courier position: optional, with the courier's consent, last point only, in transit only.
  location_consent  boolean NOT NULL DEFAULT false,
  last_lat          double precision CONSTRAINT deliveries_lat_check CHECK (last_lat BETWEEN -90 AND 90),
  last_lng          double precision CONSTRAINT deliveries_lng_check CHECK (last_lng BETWEEN -180 AND 180),
  last_location_at  timestamptz,
  estimated_minutes integer,
  failure_reason    text,
  rating            smallint CONSTRAINT deliveries_rating_check CHECK (rating BETWEEN 1 AND 5),
  rating_comment    text,
  rated_at          timestamptz,
  assigned_at       timestamptz,
  picked_up_at      timestamptz,
  delivered_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deliveries_order_unique UNIQUE (order_id),
  CONSTRAINT deliveries_courier_check CHECK (courier_id IS NOT NULL OR status IN ('pending', 'failed', 'returned')),
  CONSTRAINT deliveries_location_check CHECK (
    (last_lat IS NULL) = (last_lng IS NULL) AND (last_lat IS NULL) = (last_location_at IS NULL)
    AND (last_lat IS NULL OR status = 'in_transit')
  ),
  CONSTRAINT deliveries_rating_status_check CHECK (rating IS NULL OR status = 'delivered')
);
CREATE INDEX deliveries_org_idx ON deliveries (org_id, created_at DESC, id DESC);
CREATE INDEX deliveries_org_status_idx ON deliveries (org_id, status, created_at DESC, id DESC);
CREATE INDEX deliveries_courier_idx ON deliveries (courier_id, created_at DESC, id DESC) WHERE courier_id IS NOT NULL;
CREATE INDEX deliveries_buyer_idx ON deliveries (buyer_id, created_at DESC, id DESC);
CREATE TRIGGER deliveries_set_updated_at BEFORE UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only history. No position, no code, no address here.
CREATE TABLE delivery_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id   uuid NOT NULL REFERENCES deliveries(id),
  kind          text NOT NULL CONSTRAINT delivery_events_kind_check CHECK (kind IN ('status', 'assignment', 'incident', 'proof')),
  from_status   text,
  status        text NOT NULL,
  actor_kind    text NOT NULL CONSTRAINT delivery_events_actor_check CHECK (actor_kind IN ('buyer', 'org', 'courier', 'system')),
  actor_user_id uuid REFERENCES users(id),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_events_delivery_idx ON delivery_events (delivery_id, created_at, id);

CREATE FUNCTION delivery_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER delivery_events_no_update_delete BEFORE UPDATE OR DELETE ON delivery_events
  FOR EACH ROW EXECUTE FUNCTION delivery_events_append_only();

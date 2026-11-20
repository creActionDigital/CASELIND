-- 0079_courier_requests: on-demand courier outside any order (parcels and documents; cahier 9).
-- Forward-only. No money transits: cash to the courier; fee_estimate_minor is computed by the server (distance
-- and mobility tariffs). Coordinates and labels of both points, and the note, are visible to the courier only
-- after acceptance (before: coordinates rounded to 3 decimals, no label). proof_* mirrors the delivery code.
CREATE TABLE courier_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               text NOT NULL CONSTRAINT courier_requests_kind_check CHECK (kind IN ('parcel', 'document')),
  size               text CONSTRAINT courier_requests_size_check CHECK (size IS NULL OR size IN ('small', 'medium', 'large')),
  pickup_lat         double precision NOT NULL CONSTRAINT courier_requests_pickup_lat_check CHECK (pickup_lat BETWEEN -90 AND 90),
  pickup_lng         double precision NOT NULL CONSTRAINT courier_requests_pickup_lng_check CHECK (pickup_lng BETWEEN -180 AND 180),
  pickup_label       text NOT NULL CONSTRAINT courier_requests_pickup_label_check CHECK (char_length(pickup_label) <= 160),
  dropoff_lat        double precision NOT NULL CONSTRAINT courier_requests_dropoff_lat_check CHECK (dropoff_lat BETWEEN -90 AND 90),
  dropoff_lng        double precision NOT NULL CONSTRAINT courier_requests_dropoff_lng_check CHECK (dropoff_lng BETWEEN -180 AND 180),
  dropoff_label      text NOT NULL CONSTRAINT courier_requests_dropoff_label_check CHECK (char_length(dropoff_label) <= 160),
  note               text CONSTRAINT courier_requests_note_check CHECK (note IS NULL OR char_length(note) <= 300),
  currency           char(3) NOT NULL,
  fee_estimate_minor bigint NOT NULL CONSTRAINT courier_requests_fee_check CHECK (fee_estimate_minor >= 0),
  distance_km        double precision NOT NULL CONSTRAINT courier_requests_distance_check CHECK (distance_km >= 0),
  status             text NOT NULL DEFAULT 'requested' CONSTRAINT courier_requests_status_check
                       CHECK (status IN ('requested', 'accepted', 'picked_up', 'delivered', 'cancelled', 'expired')),
  courier_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  proof_nonce        text NOT NULL,
  proof_hash         text NOT NULL,
  proof_attempts     integer NOT NULL DEFAULT 0 CONSTRAINT courier_requests_attempts_check CHECK (proof_attempts BETWEEN 0 AND 5),
  proof_locked_until timestamptz,
  location_consent   boolean NOT NULL DEFAULT false,
  last_lat           double precision,
  last_lng           double precision,
  last_location_at   timestamptz,
  requester_rating   smallint CONSTRAINT courier_requests_requester_rating_check CHECK (requester_rating BETWEEN 1 AND 5),
  courier_rating     smallint CONSTRAINT courier_requests_courier_rating_check CHECK (courier_rating BETWEEN 1 AND 5),
  scheduled_for      timestamptz,
  expires_at         timestamptz NOT NULL,
  accepted_at        timestamptz,
  picked_up_at       timestamptz,
  delivered_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courier_requests_requester_idx ON courier_requests (requester_id, created_at DESC, id DESC);
CREATE INDEX courier_requests_courier_idx ON courier_requests (courier_id, created_at DESC, id DESC) WHERE courier_id IS NOT NULL;
CREATE INDEX courier_requests_open_idx ON courier_requests (expires_at, id) WHERE status = 'requested';
CREATE TRIGGER courier_requests_set_updated_at BEFORE UPDATE ON courier_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

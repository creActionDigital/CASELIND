-- 0022_mobility: lot 11 taxi and moto-taxi rides. Forward-only.
-- No operator is integrated: drivers are registered CASELIND users, fares are estimates, payment is cash to the driver (ADR-017).

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('mobility', 'Mobilité : courses de taxi et moto-taxi, profil chauffeur, partage du trajet', true, false);

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride'));

CREATE TABLE mobility_drivers (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_kind     text NOT NULL CONSTRAINT mobility_drivers_kind_check CHECK (vehicle_kind IN ('moto', 'car')),
  comfort          boolean NOT NULL DEFAULT false,
  make             text NOT NULL,
  plate            text NOT NULL,
  color            text NOT NULL,
  photo_media_id   uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  zone             text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CONSTRAINT mobility_drivers_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  decision_reason  text,
  decided_by       uuid,
  decided_at       timestamptz,
  online           boolean NOT NULL DEFAULT false,
  -- Only the latest position is kept; erased when the driver goes offline.
  last_lat         double precision,
  last_lng         double precision,
  last_location_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobility_drivers_online_approved CHECK (NOT online OR status = 'approved'),
  CONSTRAINT mobility_drivers_location_pair CHECK ((last_lat IS NULL) = (last_lng IS NULL))
);
CREATE INDEX mobility_drivers_online_idx ON mobility_drivers (online, status) WHERE online;

CREATE TABLE mobility_rides (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  vehicle            text NOT NULL CONSTRAINT mobility_rides_vehicle_check CHECK (vehicle IN ('moto', 'standard', 'confort')),
  status             text NOT NULL CONSTRAINT mobility_rides_status_check CHECK (status IN
                       ('scheduled', 'requested', 'accepted', 'driver_arriving', 'in_progress', 'completed', 'cancelled_by_rider', 'cancelled_by_driver', 'expired')),
  pickup_lat         double precision NOT NULL,
  pickup_lng         double precision NOT NULL,
  pickup_label       text NOT NULL,
  stop_lat           double precision,
  stop_lng           double precision,
  stop_label         text,
  dropoff_lat        double precision NOT NULL,
  dropoff_lng        double precision NOT NULL,
  dropoff_label      text NOT NULL,
  currency           char(3) NOT NULL,
  est_distance_km    double precision NOT NULL,
  est_duration_min   integer NOT NULL,
  fare_minor         bigint NOT NULL,
  fare_min_minor     bigint NOT NULL,
  fare_max_minor     bigint NOT NULL,
  final_fare_minor   bigint,
  -- Cumulated measured distance while in progress: no position history is kept.
  actual_distance_km double precision NOT NULL DEFAULT 0,
  track_lat          double precision,
  track_lng          double precision,
  scheduled_at       timestamptz,
  code_nonce         text NOT NULL,
  code_hash          text NOT NULL,
  code_attempts      integer NOT NULL DEFAULT 0,
  code_locked_until  timestamptz,
  share_hash         text,
  cancel_reason      text CONSTRAINT mobility_rides_reason_check CHECK (cancel_reason IS NULL OR cancel_reason IN
                       ('changed_mind', 'wait_too_long', 'wrong_address', 'found_other', 'rider_unreachable', 'rider_no_show', 'vehicle_issue', 'too_far', 'safety', 'other')),
  alert_count        integer NOT NULL DEFAULT 0,
  requested_at       timestamptz,
  accepted_at        timestamptz,
  arrived_at         timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobility_rides_stop_all CHECK ((stop_lat IS NULL) = (stop_lng IS NULL) AND (stop_lat IS NULL) = (stop_label IS NULL))
);
CREATE INDEX mobility_rides_rider_idx ON mobility_rides (rider_id, created_at DESC);
CREATE INDEX mobility_rides_driver_idx ON mobility_rides (driver_id, created_at DESC) WHERE driver_id IS NOT NULL;
CREATE INDEX mobility_rides_requested_idx ON mobility_rides (requested_at) WHERE status = 'requested';
CREATE INDEX mobility_rides_scheduled_idx ON mobility_rides (scheduled_at) WHERE status = 'scheduled';
CREATE UNIQUE INDEX mobility_rides_share_idx ON mobility_rides (share_hash) WHERE share_hash IS NOT NULL;
-- A driver carries one live ride at a time, whatever the concurrency.
CREATE UNIQUE INDEX mobility_rides_one_live_per_driver ON mobility_rides (driver_id) WHERE status IN ('accepted', 'driver_arriving', 'in_progress');

CREATE TABLE mobility_ride_ratings (
  ride_id    uuid NOT NULL REFERENCES mobility_rides(id) ON DELETE CASCADE,
  rater_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ratee_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     smallint NOT NULL CONSTRAINT mobility_ratings_range CHECK (rating BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, rater_id)
);
CREATE INDEX mobility_ratings_ratee_idx ON mobility_ride_ratings (ratee_id);

-- Quick messages exist only while the ride is live (deleted when it ends).
CREATE TABLE mobility_ride_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    uuid NOT NULL REFERENCES mobility_rides(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mobility_messages_ride_idx ON mobility_ride_messages (ride_id, created_at, id);

CREATE TABLE mobility_trusted_contacts (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, contact_user_id),
  CONSTRAINT mobility_trusted_not_self CHECK (user_id <> contact_user_id)
);

CREATE TABLE mobility_favorite_places (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CONSTRAINT mobility_favorites_kind_check CHECK (kind IN ('home', 'work', 'other')),
  label      text NOT NULL,
  address    text NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mobility_favorites_user_idx ON mobility_favorite_places (user_id, created_at, id);
-- One "Maison" and one "Travail" per user.
CREATE UNIQUE INDEX mobility_favorites_kind_idx ON mobility_favorite_places (user_id, kind) WHERE kind IN ('home', 'work');

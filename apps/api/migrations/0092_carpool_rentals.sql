-- 0092_carpool_rentals: covoiturage entre particuliers et location de vehicules par des organisations (cahier 10). Forward-only.
-- Aucun paiement en ligne : especes entre les parties, prix plafonne cote serveur.

CREATE TABLE carpool_trips (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_lat            double precision NOT NULL CONSTRAINT carpool_trips_origin_lat_check CHECK (origin_lat BETWEEN -90 AND 90),
  origin_lng            double precision NOT NULL CONSTRAINT carpool_trips_origin_lng_check CHECK (origin_lng BETWEEN -180 AND 180),
  origin_label          text NOT NULL CONSTRAINT carpool_trips_origin_label_check CHECK (length(origin_label) <= 160),
  dest_lat              double precision NOT NULL CONSTRAINT carpool_trips_dest_lat_check CHECK (dest_lat BETWEEN -90 AND 90),
  dest_lng              double precision NOT NULL CONSTRAINT carpool_trips_dest_lng_check CHECK (dest_lng BETWEEN -180 AND 180),
  dest_label            text NOT NULL CONSTRAINT carpool_trips_dest_label_check CHECK (length(dest_label) <= 160),
  distance_km           double precision NOT NULL DEFAULT 0,
  departs_at            timestamptz NOT NULL,
  seats_total           smallint NOT NULL CONSTRAINT carpool_trips_seats_total_check CHECK (seats_total BETWEEN 1 AND 8),
  seats_free            smallint NOT NULL CONSTRAINT carpool_trips_seats_free_check CHECK (seats_free >= 0),
  price_per_seat_minor  bigint NOT NULL CONSTRAINT carpool_trips_price_check CHECK (price_per_seat_minor >= 0),
  currency              char(3) NOT NULL CONSTRAINT carpool_trips_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  note                  text CONSTRAINT carpool_trips_note_check CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
  vehicle_label         text CONSTRAINT carpool_trips_vehicle_check CHECK (vehicle_label IS NULL OR length(vehicle_label) BETWEEN 1 AND 60),
  status                text NOT NULL DEFAULT 'open' CONSTRAINT carpool_trips_status_check CHECK (status IN ('open', 'full', 'departed', 'completed', 'cancelled')),
  hidden                boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carpool_trips_seats_free_max_check CHECK (seats_free <= seats_total)
);
CREATE INDEX carpool_trips_search_idx ON carpool_trips (departs_at, id) WHERE status = 'open' AND NOT hidden;
CREATE INDEX carpool_trips_driver_idx ON carpool_trips (driver_id, departs_at DESC, id DESC);

CREATE TABLE carpool_bookings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       uuid NOT NULL REFERENCES carpool_trips(id) ON DELETE CASCADE,
  passenger_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seats         smallint NOT NULL CONSTRAINT carpool_bookings_seats_check CHECK (seats BETWEEN 1 AND 4),
  status        text NOT NULL DEFAULT 'requested' CONSTRAINT carpool_bookings_status_check CHECK (status IN ('requested', 'accepted', 'declined', 'cancelled', 'completed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Une seule demande en cours par passager et par trajet.
CREATE UNIQUE INDEX carpool_bookings_live_unique ON carpool_bookings (trip_id, passenger_id) WHERE status IN ('requested', 'accepted');
CREATE INDEX carpool_bookings_trip_idx ON carpool_bookings (trip_id, created_at);
CREATE INDEX carpool_bookings_passenger_idx ON carpool_bookings (passenger_id, created_at DESC);

-- Evaluation reciproque simple (etoiles seules : pas de texte libre, donc rien a moderer).
CREATE TABLE carpool_ratings (
  trip_id    uuid NOT NULL REFERENCES carpool_trips(id) ON DELETE CASCADE,
  rater_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ratee_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     smallint NOT NULL CONSTRAINT carpool_ratings_rating_check CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, rater_id, ratee_id),
  CONSTRAINT carpool_ratings_distinct_check CHECK (rater_id <> ratee_id)
);
CREATE INDEX carpool_ratings_ratee_idx ON carpool_ratings (ratee_id);

CREATE TABLE rental_vehicles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title             text NOT NULL CONSTRAINT rental_vehicles_title_check CHECK (length(title) BETWEEN 1 AND 80),
  kind              text NOT NULL CONSTRAINT rental_vehicles_kind_check CHECK (kind IN ('car', 'moto', 'van', 'bike')),
  make              text CONSTRAINT rental_vehicles_make_check CHECK (make IS NULL OR length(make) BETWEEN 1 AND 40),
  model             text CONSTRAINT rental_vehicles_model_check CHECK (model IS NULL OR length(model) BETWEEN 1 AND 40),
  year              smallint CONSTRAINT rental_vehicles_year_check CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  seats             smallint CONSTRAINT rental_vehicles_seats_check CHECK (seats IS NULL OR seats BETWEEN 1 AND 60),
  transmission      text CONSTRAINT rental_vehicles_transmission_check CHECK (transmission IS NULL OR transmission IN ('manual', 'auto')),
  fuel              text CONSTRAINT rental_vehicles_fuel_check CHECK (fuel IS NULL OR fuel IN ('petrol', 'diesel', 'electric', 'hybrid')),
  daily_rate_minor  bigint NOT NULL CONSTRAINT rental_vehicles_rate_check CHECK (daily_rate_minor > 0),
  currency          char(3) NOT NULL CONSTRAINT rental_vehicles_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  deposit_minor     bigint CONSTRAINT rental_vehicles_deposit_check CHECK (deposit_minor IS NULL OR deposit_minor >= 0),
  city              text NOT NULL CONSTRAINT rental_vehicles_city_check CHECK (length(city) BETWEEN 1 AND 80),
  description       text CONSTRAINT rental_vehicles_description_check CHECK (description IS NULL OR length(description) BETWEEN 1 AND 500),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rental_vehicles_org_idx ON rental_vehicles (org_id, created_at DESC, id DESC);
CREATE INDEX rental_vehicles_search_idx ON rental_vehicles (lower(city), kind, created_at DESC, id DESC) WHERE active;

-- Photos : medias de finalite 'listing' (lisibles par tout utilisateur connecte), 4 au plus.
CREATE TABLE rental_vehicle_media (
  vehicle_id uuid NOT NULL REFERENCES rental_vehicles(id) ON DELETE CASCADE,
  media_id   uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position   smallint NOT NULL CONSTRAINT rental_vehicle_media_position_check CHECK (position BETWEEN 0 AND 3),
  PRIMARY KEY (vehicle_id, media_id)
);

-- Le tarif, la caution et le total sont figes a la demande. Le non-chevauchement des locations confirmees est verifie
-- dans la transaction sous verrou du vehicule (aucune extension btree_gist n'est installee).
CREATE TABLE rental_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        uuid NOT NULL REFERENCES rental_vehicles(id) ON DELETE CASCADE,
  renter_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,
  daily_rate_minor  bigint NOT NULL,
  deposit_minor     bigint,
  total_minor       bigint NOT NULL CONSTRAINT rental_bookings_total_check CHECK (total_minor > 0),
  currency          char(3) NOT NULL,
  status            text NOT NULL DEFAULT 'requested' CONSTRAINT rental_bookings_status_check CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled', 'picked_up', 'returned')),
  note              text CONSTRAINT rental_bookings_note_check CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_bookings_dates_check CHECK (ends_on >= starts_on AND ends_on - starts_on <= 29)
);
CREATE INDEX rental_bookings_vehicle_idx ON rental_bookings (vehicle_id, starts_on) WHERE status IN ('confirmed', 'picked_up');
CREATE INDEX rental_bookings_renter_idx ON rental_bookings (renter_id, created_at DESC, id DESC);

-- Liste complete de 0065 plus 'carpool_trip'.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job', 'mission', 'course', 'course_review', 'scholarship', 'org_update', 'org_review', 'org_question', 'carpool_trip'));

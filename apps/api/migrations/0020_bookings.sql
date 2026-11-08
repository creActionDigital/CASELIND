-- 0020_bookings: lot 9 local services and bookings. Forward-only.
-- Payment is on site only (ADR-017): no amount is ever collected by the platform.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('services', 'Services de proximité : offres, disponibilités, réservations et avis', true, false);

-- Offers and their reviews can be reported.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review'));

CREATE TABLE service_categories (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug     text NOT NULL UNIQUE CONSTRAINT service_categories_slug_check CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name     text NOT NULL,
  position integer NOT NULL DEFAULT 0
);
INSERT INTO service_categories (slug, name, position) VALUES
  ('plomberie', 'Plomberie', 1),
  ('electricite', 'Électricité', 2),
  ('menuiserie', 'Menuiserie', 3),
  ('peinture', 'Peinture', 4),
  ('nettoyage', 'Nettoyage', 5),
  ('beaute-spa', 'Beauté et spa', 6),
  ('reparation-telephones', 'Réparation de téléphones', 7),
  ('reparation-ordinateurs', 'Réparation d''ordinateurs et appareils', 8),
  ('tutorat', 'Tutorat', 9),
  ('garde-enfants', 'Garde d''enfants', 10),
  ('aide-menagere', 'Aide ménagère', 11),
  ('demenagement', 'Déménagement', 12),
  ('jardinage', 'Jardinage', 13),
  ('photo-video', 'Photo et vidéo', 14),
  ('traduction-redaction-design', 'Traduction, rédaction, design et développement', 15);

-- Profile of an individual provider (a user offering services in their own name).
CREATE TABLE service_providers (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name        text NOT NULL CONSTRAINT service_providers_name_check CHECK (char_length(display_name) BETWEEN 1 AND 80),
  bio                 text CONSTRAINT service_providers_bio_check CHECK (bio IS NULL OR char_length(bio) <= 1000),
  city                text,
  skills              text[] NOT NULL DEFAULT '{}',
  -- Only a verification process can set 'verified'; none exists yet, so every provider shows as "non vérifié".
  verification_status text NOT NULL DEFAULT 'unverified' CONSTRAINT service_providers_verif_check CHECK (verification_status IN ('unverified', 'verified')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  created_by          uuid,
  category_id         uuid NOT NULL REFERENCES service_categories(id),
  title               text NOT NULL CONSTRAINT service_offers_title_check CHECK (char_length(title) BETWEEN 1 AND 140),
  description         text CONSTRAINT service_offers_description_check CHECK (description IS NULL OR char_length(description) <= 2000),
  status              text NOT NULL DEFAULT 'draft' CONSTRAINT service_offers_status_check CHECK (status IN ('draft', 'published', 'archived')),
  hidden              boolean NOT NULL DEFAULT false,
  price_kind          text NOT NULL CONSTRAINT service_offers_price_kind_check CHECK (price_kind IN ('fixed', 'quote')),
  price_minor         bigint CONSTRAINT service_offers_price_check CHECK (price_minor IS NULL OR price_minor > 0),
  currency            char(3),
  duration_min        integer NOT NULL CONSTRAINT service_offers_duration_check CHECK (duration_min BETWEEN 15 AND 720),
  cancel_notice_hours integer NOT NULL DEFAULT 24 CONSTRAINT service_offers_notice_check CHECK (cancel_notice_hours BETWEEN 0 AND 720),
  city                text NOT NULL,
  lat                 double precision NOT NULL,
  lng                 double precision NOT NULL,
  radius_km           integer NOT NULL DEFAULT 10 CONSTRAINT service_offers_radius_check CHECK (radius_km BETWEEN 1 AND 100),
  -- Fixed offset of the provider's local time (no DST handling), in minutes east of UTC.
  utc_offset_minutes  integer NOT NULL DEFAULT 0 CONSTRAINT service_offers_offset_check CHECK (utc_offset_minutes BETWEEN -720 AND 840),
  -- "Urgent" and "garanti" only exist when the provider fills these fields.
  urgent_available    boolean NOT NULL DEFAULT false,
  guarantee_note      text CONSTRAINT service_offers_guarantee_check CHECK (guarantee_note IS NULL OR char_length(guarantee_note) BETWEEN 1 AND 200),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_offers_owner_check CHECK ((org_id IS NULL) <> (provider_id IS NULL)),
  CONSTRAINT service_offers_price_kind_fields CHECK (
    (price_kind = 'fixed' AND price_minor IS NOT NULL AND currency IS NOT NULL)
    OR (price_kind = 'quote' AND price_minor IS NULL))
);
CREATE INDEX service_offers_org_idx ON service_offers (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX service_offers_provider_idx ON service_offers (provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX service_offers_geo_idx ON service_offers (lat, lng) WHERE status = 'published';
CREATE INDEX service_offers_category_idx ON service_offers (category_id, created_at DESC) WHERE status = 'published';

CREATE TABLE service_offer_media (
  offer_id uuid NOT NULL REFERENCES service_offers(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (offer_id, media_id)
);

-- Weekly windows in local minutes from midnight; weekday is ISO (1 = Monday ... 7 = Sunday).
CREATE TABLE service_availability_rules (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id  uuid NOT NULL REFERENCES service_offers(id) ON DELETE CASCADE,
  weekday   smallint NOT NULL CONSTRAINT service_rules_weekday_check CHECK (weekday BETWEEN 1 AND 7),
  start_min integer NOT NULL CONSTRAINT service_rules_start_check CHECK (start_min BETWEEN 0 AND 1439),
  end_min   integer NOT NULL CONSTRAINT service_rules_end_check CHECK (end_min BETWEEN 1 AND 1440),
  CONSTRAINT service_rules_order_check CHECK (start_min < end_min)
);
CREATE INDEX service_rules_offer_idx ON service_availability_rules (offer_id);

-- A date with at least one exception row ignores the weekly windows: closed, or the listed windows only.
CREATE TABLE service_availability_exceptions (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id  uuid NOT NULL REFERENCES service_offers(id) ON DELETE CASCADE,
  day       date NOT NULL,
  closed    boolean NOT NULL,
  start_min integer,
  end_min   integer,
  CONSTRAINT service_exceptions_shape_check CHECK (
    (closed AND start_min IS NULL AND end_min IS NULL)
    OR (NOT closed AND start_min IS NOT NULL AND end_min IS NOT NULL AND start_min >= 0 AND end_min <= 1440 AND start_min < end_min))
);
CREATE INDEX service_exceptions_offer_idx ON service_availability_exceptions (offer_id, day);

CREATE TABLE service_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id          uuid NOT NULL REFERENCES service_offers(id) ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES users(id),
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'requested'
                    CONSTRAINT service_bookings_status_check CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled', 'declined', 'no_show')),
  note              text CONSTRAINT service_bookings_note_check CHECK (note IS NULL OR char_length(note) <= 500),
  -- Fixed price copied at booking time, or the accepted quote; null while a quote is awaited.
  amount_minor      bigint,
  currency          char(3),
  quote_status      text NOT NULL DEFAULT 'none' CONSTRAINT service_bookings_quote_check CHECK (quote_status IN ('none', 'proposed', 'accepted', 'declined')),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  status_changed_by text NOT NULL DEFAULT 'client' CONSTRAINT service_bookings_actor_check CHECK (status_changed_by IN ('client', 'provider', 'system')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_bookings_interval_check CHECK (starts_at < ends_at)
);
CREATE INDEX service_bookings_client_idx ON service_bookings (client_id, created_at DESC, id DESC);
CREATE INDEX service_bookings_offer_idx ON service_bookings (offer_id, starts_at);
-- Backstop of the application lock: no two live bookings may start together on the same offer.
CREATE UNIQUE INDEX service_bookings_slot_unique ON service_bookings (offer_id, starts_at) WHERE status IN ('requested', 'confirmed');

CREATE TABLE service_booking_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES service_bookings(id) ON DELETE CASCADE,
  from_status   text,
  status        text NOT NULL,
  actor_kind    text NOT NULL CONSTRAINT service_booking_events_actor_check CHECK (actor_kind IN ('client', 'provider', 'system')),
  actor_user_id uuid,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_booking_events_idx ON service_booking_events (booking_id, created_at, id);

-- Verified reviews: one per completed booking.
CREATE TABLE service_reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES service_bookings(id) ON DELETE CASCADE,
  offer_id   uuid NOT NULL REFERENCES service_offers(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL REFERENCES users(id),
  rating     smallint NOT NULL CONSTRAINT service_reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  body       text CONSTRAINT service_reviews_body_check CHECK (body IS NULL OR char_length(body) <= 2000),
  hidden     boolean NOT NULL DEFAULT false,
  reply_body text CONSTRAINT service_reviews_reply_check CHECK (reply_body IS NULL OR char_length(reply_body) <= 2000),
  reply_by   uuid,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_reviews_offer_idx ON service_reviews (offer_id, created_at DESC, id DESC);

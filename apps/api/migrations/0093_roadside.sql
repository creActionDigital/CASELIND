-- 0093_roadside: demandes de depannage (remorquage, batterie, pneu, carburant, ouverture, autre). Forward-only.
-- Les prestataires sont les chauffeurs de mobilite approuves (KYC niveau 1), comme pour le coursier. Prix convenu sur place, en especes.

CREATE TABLE roadside_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                text NOT NULL CONSTRAINT roadside_requests_kind_check CHECK (kind IN ('tow', 'battery', 'tire', 'fuel', 'lockout', 'other')),
  lat                 double precision NOT NULL CONSTRAINT roadside_requests_lat_check CHECK (lat BETWEEN -90 AND 90),
  lng                 double precision NOT NULL CONSTRAINT roadside_requests_lng_check CHECK (lng BETWEEN -180 AND 180),
  label               text NOT NULL CONSTRAINT roadside_requests_label_check CHECK (length(label) <= 160),
  vehicle_label       text CONSTRAINT roadside_requests_vehicle_check CHECK (vehicle_label IS NULL OR length(vehicle_label) BETWEEN 1 AND 60),
  note                text CONSTRAINT roadside_requests_note_check CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
  status              text NOT NULL DEFAULT 'requested' CONSTRAINT roadside_requests_status_check CHECK (status IN ('requested', 'accepted', 'on_the_way', 'done', 'cancelled', 'expired')),
  provider_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  eta_minutes         smallint CONSTRAINT roadside_requests_eta_check CHECK (eta_minutes IS NULL OR eta_minutes BETWEEN 1 AND 480),
  location_consent    boolean NOT NULL DEFAULT false,
  last_lat            double precision,
  last_lng            double precision,
  last_location_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  accepted_at         timestamptz,
  done_at             timestamptz,
  cancelled_at        timestamptz
);
CREATE INDEX roadside_requests_open_idx ON roadside_requests (created_at, id) WHERE status = 'requested';
CREATE INDEX roadside_requests_requester_idx ON roadside_requests (requester_id, created_at DESC, id DESC);
CREATE INDEX roadside_requests_provider_idx ON roadside_requests (provider_id, created_at DESC, id DESC) WHERE provider_id IS NOT NULL;

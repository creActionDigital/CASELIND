-- 0032_health_professionals: lot 18b verified professionals, appointments, temporary record sharing, e-prescriptions (CDC §12). Forward-only.
-- Nothing is listed until an administrator verified the licence. A professional only ever sees a patient's record through a share
-- the patient granted (chosen kinds, time limited, revocable), and every read is logged where the patient can see it.

-- A professional may exist before being approved; the whole module stays behind the regulated `health` flag.
CREATE TABLE health_professionals (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CONSTRAINT health_professionals_kind_check CHECK (kind IN ('doctor', 'dentist', 'laboratory', 'pharmacist', 'nurse', 'psychologist', 'other')),
  specialty       text NOT NULL DEFAULT '' CONSTRAINT health_professionals_specialty_check CHECK (length(specialty) <= 80),
  license_number  text NOT NULL CONSTRAINT health_professionals_license_check CHECK (length(license_number) BETWEEN 3 AND 60),
  city            text NOT NULL CONSTRAINT health_professionals_city_check CHECK (length(city) BETWEEN 2 AND 80),
  bio             text NOT NULL DEFAULT '' CONSTRAINT health_professionals_bio_check CHECK (length(bio) <= 1000),
  status          text NOT NULL DEFAULT 'pending' CONSTRAINT health_professionals_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  review_note     text NOT NULL DEFAULT '' CONSTRAINT health_professionals_note_check CHECK (length(review_note) <= 1000),
  reviewed_by     uuid REFERENCES users(id),
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_professionals_listing_idx ON health_professionals (kind, city) WHERE status = 'approved';

-- `reason_enc` is the patient's reason, sealed with the patient's health key: it is health data.
CREATE TABLE health_appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id  uuid NOT NULL REFERENCES health_professionals(user_id) ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL,
  mode             text NOT NULL CONSTRAINT health_appointments_mode_check CHECK (mode IN ('in_person', 'teleconsultation')),
  reason_enc       text NOT NULL,
  status           text NOT NULL DEFAULT 'requested' CONSTRAINT health_appointments_status_check CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled', 'completed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT health_appointments_parties_check CHECK (patient_id <> professional_id)
);
CREATE INDEX health_appointments_patient_idx ON health_appointments (patient_id, starts_at DESC);
CREATE INDEX health_appointments_pro_idx ON health_appointments (professional_id, starts_at DESC);
-- A professional cannot confirm two appointments at the same instant.
CREATE UNIQUE INDEX health_appointments_slot_unique ON health_appointments (professional_id, starts_at) WHERE status = 'confirmed';

CREATE TABLE health_shares (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id  uuid NOT NULL REFERENCES health_professionals(user_id) ON DELETE CASCADE,
  kinds            text[] NOT NULL CONSTRAINT health_shares_kinds_check CHECK (cardinality(kinds) BETWEEN 1 AND 7),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_shares_patient_idx ON health_shares (patient_id, created_at DESC);
CREATE INDEX health_shares_pro_idx ON health_shares (professional_id, patient_id);

-- What the patient can audit: who read what, when. Never the content.
CREATE TABLE health_access_log (
  id             bigserial PRIMARY KEY,
  patient_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accessor_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_id       uuid REFERENCES health_shares(id) ON DELETE SET NULL,
  entries_count  integer NOT NULL,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_access_log_patient_idx ON health_access_log (patient_id, id DESC);

-- Behind the regulated `health.prescriptions` flag. `items_enc` is sealed with the patient's health key.
CREATE TABLE health_prescriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id   uuid NOT NULL REFERENCES health_appointments(id) ON DELETE CASCADE,
  patient_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id  uuid NOT NULL REFERENCES health_professionals(user_id) ON DELETE CASCADE,
  code             text NOT NULL UNIQUE CONSTRAINT health_prescriptions_code_check CHECK (code ~ '^[A-Z0-9]{12}$'),
  items_enc        text NOT NULL,
  valid_until      date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_prescriptions_patient_idx ON health_prescriptions (patient_id, created_at DESC);

-- 0031_health: lot 18a personal health record, symptoms, medication reminders (CDC §12). Forward-only.
-- Highly sensitive data: explicit consent first, every free-text field encrypted (AES-256-GCM, bound to the user),
-- never in audit or logs, never in a notification body, erasable by the user at any time.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('health', 'Santé : dossier personnel, symptômes, rappels de prise (données sensibles, consentement explicite)', false, true);

CREATE TABLE health_consents (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version     text NOT NULL CONSTRAINT health_consents_version_check CHECK (length(version) BETWEEN 1 AND 20),
  granted_at  timestamptz NOT NULL DEFAULT now()
);

-- `payload` is the ciphertext of {title, details, severity?}. Only the kind and the date stay readable (ordering, filtering).
CREATE TABLE health_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CONSTRAINT health_entries_kind_check CHECK (kind IN ('allergy', 'condition', 'medication', 'vaccination', 'measurement', 'symptom', 'note')),
  recorded_on  date NOT NULL,
  payload      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_entries_user_idx ON health_entries (user_id, recorded_on DESC, id DESC);

-- `payload` is the ciphertext of {title, dose}. Times are local wall-clock 'HH:MM' with the user's UTC offset.
CREATE TABLE health_reminders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload             text NOT NULL,
  times               text[] NOT NULL CONSTRAINT health_reminders_times_check CHECK (cardinality(times) BETWEEN 1 AND 6),
  utc_offset_minutes  smallint NOT NULL CONSTRAINT health_reminders_offset_check CHECK (utc_offset_minutes BETWEEN -840 AND 840),
  starts_on           date NOT NULL,
  ends_on             date,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT health_reminders_period_check CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX health_reminders_user_idx ON health_reminders (user_id, created_at DESC);

CREATE TABLE health_doses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id  uuid NOT NULL REFERENCES health_reminders(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_at       timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CONSTRAINT health_doses_status_check CHECK (status IN ('pending', 'taken', 'skipped')),
  resolved_at  timestamptz,
  UNIQUE (reminder_id, due_at)
);
CREATE INDEX health_doses_user_idx ON health_doses (user_id, due_at DESC);

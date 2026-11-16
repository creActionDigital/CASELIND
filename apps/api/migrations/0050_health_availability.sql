-- 0050_health_availability: lot 18c weekly availability of a verified health professional. Forward-only.
-- No medical data: only weekly windows, the slot length and the UTC offset of the professional's clock.
-- Without a row the professional accepts any future time (behaviour of lot 18b is unchanged).
CREATE TABLE health_availability (
  professional_id     uuid PRIMARY KEY REFERENCES health_professionals(user_id) ON DELETE CASCADE,
  slot_minutes        integer NOT NULL CONSTRAINT health_availability_slot_check CHECK (slot_minutes IN (15, 20, 30, 45, 60)),
  utc_offset_minutes  integer NOT NULL CONSTRAINT health_availability_offset_check CHECK (utc_offset_minutes BETWEEN -840 AND 840),
  windows             jsonb NOT NULL CONSTRAINT health_availability_windows_check CHECK (jsonb_typeof(windows) = 'array' AND jsonb_array_length(windows) BETWEEN 1 AND 28),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

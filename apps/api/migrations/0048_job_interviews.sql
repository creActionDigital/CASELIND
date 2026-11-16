-- 0048_job_interviews: lot 16f interview calendar for job applications (no video link). Forward-only.
CREATE TABLE job_interviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  proposed_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at      timestamptz NOT NULL,
  duration_min   integer NOT NULL CONSTRAINT job_interviews_duration_check CHECK (duration_min BETWEEN 15 AND 180),
  location       text NOT NULL DEFAULT '' CONSTRAINT job_interviews_location_check CHECK (length(location) <= 200),
  status         text NOT NULL DEFAULT 'proposed' CONSTRAINT job_interviews_status_check CHECK (status IN ('proposed', 'confirmed', 'declined', 'cancelled')),
  reason         text NOT NULL DEFAULT '' CONSTRAINT job_interviews_reason_check CHECK (length(reason) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_interviews_one_live_idx ON job_interviews (application_id) WHERE status IN ('proposed', 'confirmed');
CREATE INDEX job_interviews_app_idx ON job_interviews (application_id, starts_at DESC);

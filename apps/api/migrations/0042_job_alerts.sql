-- 0042_job_alerts: lot 16d job alerts. Forward-only. Private to their owner (never shown to recruiters), deleted with the account.
CREATE TABLE job_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  q             text CONSTRAINT job_alerts_q_check CHECK (q IS NULL OR length(q) BETWEEN 1 AND 100),
  city          text CONSTRAINT job_alerts_city_check CHECK (city IS NULL OR length(city) BETWEEN 1 AND 80),
  contract_type text CONSTRAINT job_alerts_contract_check CHECK (contract_type IS NULL OR contract_type IN ('full_time', 'part_time', 'contract', 'internship', 'temporary')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_alerts_criteria_check CHECK (q IS NOT NULL OR city IS NOT NULL OR contract_type IS NOT NULL)
);
CREATE INDEX job_alerts_user_idx ON job_alerts (user_id, created_at);

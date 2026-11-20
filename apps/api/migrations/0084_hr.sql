-- 0084_hr: gestion d'entreprise, ressources humaines (CDC section 8) : fiches employe, conges, plannings, registre de salaire.
-- Le registre de salaire est un ETAT SAISI A LA MAIN (montant brut declare) : aucun calcul de paie. Forward-only.
CREATE TABLE employee_profiles (
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_title        text NOT NULL CONSTRAINT employee_profiles_title_check CHECK (char_length(job_title) BETWEEN 1 AND 80),
  department       text CONSTRAINT employee_profiles_department_check CHECK (char_length(department) BETWEEN 1 AND 60),
  employment_type  text NOT NULL CONSTRAINT employee_profiles_type_check CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  started_on       date NOT NULL,
  ended_on         date,
  manager_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  annual_leave_days smallint CONSTRAINT employee_profiles_quota_check CHECK (annual_leave_days BETWEEN 0 AND 365),
  note             text CONSTRAINT employee_profiles_note_check CHECK (char_length(note) BETWEEN 1 AND 300),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id),
  CONSTRAINT employee_profiles_dates_check CHECK (ended_on IS NULL OR ended_on >= started_on)
);
CREATE INDEX employee_profiles_manager_idx ON employee_profiles (org_id, manager_user_id) WHERE manager_user_id IS NOT NULL;

CREATE TABLE leave_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL CONSTRAINT leave_requests_kind_check CHECK (kind IN ('annual', 'sick', 'unpaid', 'maternity', 'other')),
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  days          integer NOT NULL CONSTRAINT leave_requests_days_check CHECK (days BETWEEN 1 AND 366),
  reason        text CONSTRAINT leave_requests_reason_check CHECK (char_length(reason) BETWEEN 1 AND 300),
  status        text NOT NULL DEFAULT 'requested' CONSTRAINT leave_requests_status_check CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_note text CONSTRAINT leave_requests_note_check CHECK (char_length(decision_note) BETWEEN 1 AND 300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_dates_check CHECK (ends_on >= starts_on)
);
CREATE INDEX leave_requests_org_idx ON leave_requests (org_id, created_at DESC, id DESC);
CREATE INDEX leave_requests_user_idx ON leave_requests (org_id, user_id, starts_on);

CREATE TABLE work_shifts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  starts_at  time NOT NULL,
  ends_at    time NOT NULL,
  note       text CONSTRAINT work_shifts_note_check CHECK (char_length(note) BETWEEN 1 AND 100),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_shifts_time_check CHECK (ends_at > starts_at)
);
CREATE INDEX work_shifts_org_date_idx ON work_shifts (org_id, shift_date, user_id);
CREATE INDEX work_shifts_user_idx ON work_shifts (user_id, shift_date);

CREATE TABLE salary_register (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period      date NOT NULL CONSTRAINT salary_register_period_check CHECK (extract(day FROM period) = 1),
  gross_minor bigint NOT NULL CONSTRAINT salary_register_gross_check CHECK (gross_minor BETWEEN 0 AND 1000000000000),
  currency    char(3) NOT NULL CONSTRAINT salary_register_currency_check CHECK (currency IN ('USD', 'CDF')),
  note        text CONSTRAINT salary_register_note_check CHECK (char_length(note) BETWEEN 1 AND 200),
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salary_register_unique UNIQUE (org_id, user_id, period)
);
CREATE INDEX salary_register_user_idx ON salary_register (user_id, period);

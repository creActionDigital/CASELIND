-- 0028_jobs: lot 16a job offers, personal CV and applications (CDC §14). Forward-only.
-- No video interview and no candidate search: a CV is only seen by the organisations the user applied to.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('jobs', 'Emploi : offres, CV, candidatures', true, false);

ALTER TABLE notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('message', 'social', 'commerce', 'delivery', 'payment', 'booking', 'security', 'reminder', 'system', 'job'));

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job'));

CREATE TABLE job_postings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by        uuid NOT NULL REFERENCES users(id),
  title             text NOT NULL CONSTRAINT job_postings_title_check CHECK (length(title) BETWEEN 3 AND 120),
  description       text NOT NULL DEFAULT '' CONSTRAINT job_postings_description_check CHECK (length(description) <= 4000),
  city              text NOT NULL CONSTRAINT job_postings_city_check CHECK (length(city) BETWEEN 2 AND 80),
  contract_type     text NOT NULL CONSTRAINT job_postings_contract_check CHECK (contract_type IN ('full_time', 'part_time', 'contract', 'internship', 'temporary')),
  salary_min_minor  bigint CONSTRAINT job_postings_salary_min_check CHECK (salary_min_minor IS NULL OR salary_min_minor >= 0),
  salary_max_minor  bigint CONSTRAINT job_postings_salary_max_check CHECK (salary_max_minor IS NULL OR salary_max_minor >= 0),
  currency          char(3) CONSTRAINT job_postings_currency_check CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  status            text NOT NULL DEFAULT 'open' CONSTRAINT job_postings_status_check CHECK (status IN ('open', 'closed')),
  hidden            boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_postings_salary_pair CHECK ((salary_min_minor IS NULL AND salary_max_minor IS NULL AND currency IS NULL)
    OR (currency IS NOT NULL AND (salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL))),
  CONSTRAINT job_postings_salary_order CHECK (salary_min_minor IS NULL OR salary_max_minor IS NULL OR salary_min_minor <= salary_max_minor)
);
CREATE INDEX job_postings_feed_idx ON job_postings (created_at DESC, id DESC) WHERE status = 'open' AND NOT hidden;
CREATE INDEX job_postings_org_idx ON job_postings (org_id, created_at DESC);

-- One CV per user. Never browsable: it only reaches a recruiter as the snapshot of an application.
CREATE TABLE job_profiles (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline    text NOT NULL CONSTRAINT job_profiles_headline_check CHECK (length(headline) BETWEEN 2 AND 120),
  summary     text NOT NULL DEFAULT '' CONSTRAINT job_profiles_summary_check CHECK (length(summary) <= 2000),
  skills      text[] NOT NULL DEFAULT '{}' CONSTRAINT job_profiles_skills_check CHECK (cardinality(skills) <= 15),
  city        text NOT NULL DEFAULT '',
  experience  text NOT NULL DEFAULT '' CONSTRAINT job_profiles_experience_check CHECK (length(experience) <= 4000),
  education   text NOT NULL DEFAULT '' CONSTRAINT job_profiles_education_check CHECK (length(education) <= 2000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_applications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id  uuid NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     text NOT NULL DEFAULT '' CONSTRAINT job_applications_message_check CHECK (length(message) <= 2000),
  cv          jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'submitted' CONSTRAINT job_applications_status_check
                CHECK (status IN ('submitted', 'viewed', 'shortlisted', 'interview', 'offered', 'hired', 'rejected', 'withdrawn')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_applications_unique UNIQUE (posting_id, user_id)
);
CREATE INDEX job_applications_user_idx ON job_applications (user_id, created_at DESC);
CREATE INDEX job_applications_posting_idx ON job_applications (posting_id, created_at DESC);

-- 0047_freelance_categories_profiles: lot 16e mission categories and public freelancer profiles (opt-in). Forward-only.
ALTER TABLE missions ADD COLUMN category text NOT NULL DEFAULT 'autre'
  CONSTRAINT missions_category_check CHECK (category IN ('design', 'developpement', 'redaction', 'traduction', 'marketing', 'comptabilite', 'formation', 'autre'));
CREATE INDEX missions_category_idx ON missions (category, created_at DESC, id DESC) WHERE status = 'open' AND NOT hidden;

CREATE TABLE freelance_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  title          text NOT NULL CONSTRAINT freelance_profiles_title_check CHECK (length(title) BETWEEN 3 AND 120),
  skills         text[] NOT NULL DEFAULT '{}' CONSTRAINT freelance_profiles_skills_check CHECK (cardinality(skills) <= 15),
  categories     text[] NOT NULL DEFAULT '{}' CONSTRAINT freelance_profiles_categories_check CHECK (cardinality(categories) <= 5),
  rate_minor     bigint CONSTRAINT freelance_profiles_rate_check CHECK (rate_minor IS NULL OR rate_minor > 0),
  rate_currency  char(3) CONSTRAINT freelance_profiles_currency_check CHECK (rate_currency IS NULL OR rate_currency IN ('USD', 'CDF')),
  bio            text NOT NULL DEFAULT '' CONSTRAINT freelance_profiles_bio_check CHECK (length(bio) <= 1000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT freelance_profiles_rate_pair_check CHECK ((rate_minor IS NULL) = (rate_currency IS NULL))
);
CREATE INDEX freelance_profiles_feed_idx ON freelance_profiles (created_at DESC, id DESC) WHERE enabled;

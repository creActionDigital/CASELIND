-- 0150_monetization: abonnements Premium / forfaits pros et publicité payante. Paiement en mode test (grand livre, jamais d'argent réel). Forward-only.
CREATE TABLE subscription_plans (
  code            text PRIMARY KEY,
  audience        text NOT NULL CONSTRAINT subscription_plans_audience_check CHECK (audience IN ('user', 'org')),
  period          text NOT NULL CONSTRAINT subscription_plans_period_check CHECK (period IN ('month', 'year')),
  price_usd_minor bigint NOT NULL CONSTRAINT subscription_plans_usd_check CHECK (price_usd_minor > 0),
  price_cdf_minor bigint NOT NULL CONSTRAINT subscription_plans_cdf_check CHECK (price_cdf_minor > 0),
  active          boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO subscription_plans (code, audience, period, price_usd_minor, price_cdf_minor) VALUES
  ('premium_month', 'user', 'month', 499, 1397200),
  ('premium_year', 'user', 'year', 4999, 13997200),
  ('pro_month', 'org', 'month', 1999, 5597200),
  ('pro_year', 'org', 'year', 19999, 55997200);

CREATE TABLE subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id             uuid REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code          text NOT NULL REFERENCES subscription_plans(code),
  currency           text NOT NULL CONSTRAINT subscriptions_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  price_minor        bigint NOT NULL CONSTRAINT subscriptions_price_check CHECK (price_minor > 0),
  auto_renew         boolean NOT NULL DEFAULT false,
  started_at         timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL,
  cancelled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- Un seul abonnement par utilisateur (Premium) et par organisation (forfait pro) ; la ligne est réutilisée à la réinscription.
CREATE UNIQUE INDEX subscriptions_user_uq ON subscriptions (user_id) WHERE org_id IS NULL;
CREATE UNIQUE INDEX subscriptions_org_uq ON subscriptions (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX subscriptions_end_idx ON subscriptions (current_period_end);

CREATE TABLE subscription_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id          uuid REFERENCES organizations(id) ON DELETE SET NULL,
  plan_code       text NOT NULL,
  kind            text NOT NULL CONSTRAINT subscription_payments_kind_check CHECK (kind IN ('initial', 'renewal')),
  amount_minor    bigint NOT NULL CONSTRAINT subscription_payments_amount_check CHECK (amount_minor > 0),
  currency        text NOT NULL,
  payer           text NOT NULL CONSTRAINT subscription_payments_payer_check CHECK (payer IN ('user', 'org')),
  transfer_id     uuid,
  client_id       uuid,
  receipt_no      text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscription_payments_client_uq ON subscription_payments (user_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX subscription_payments_user_idx ON subscription_payments (user_id, created_at DESC, id DESC);

CREATE TABLE ad_campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id             uuid REFERENCES organizations(id) ON DELETE SET NULL,
  payer_org_id       uuid REFERENCES organizations(id) ON DELETE SET NULL,
  client_id          uuid NOT NULL,
  name               text NOT NULL CONSTRAINT ad_campaigns_name_check CHECK (char_length(name) BETWEEN 2 AND 80),
  objective          text NOT NULL CONSTRAINT ad_campaigns_objective_check CHECK (objective IN ('reach', 'clicks', 'sales')),
  post_id            uuid REFERENCES posts(id) ON DELETE CASCADE,
  product_id         uuid REFERENCES products(id) ON DELETE CASCADE,
  country            text CONSTRAINT ad_campaigns_country_check CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  city               text,
  min_age            int CONSTRAINT ad_campaigns_age_check CHECK (min_age IS NULL OR min_age BETWEEN 13 AND 99),
  interests          text[] NOT NULL DEFAULT '{}',
  placements         text[] NOT NULL CONSTRAINT ad_campaigns_placements_check CHECK (placements <@ ARRAY['feed', 'videos', 'marketplace', 'search']::text[] AND cardinality(placements) >= 1),
  budget_minor       bigint NOT NULL CONSTRAINT ad_campaigns_budget_check CHECK (budget_minor > 0),
  daily_budget_minor bigint NOT NULL CONSTRAINT ad_campaigns_daily_check CHECK (daily_budget_minor > 0 AND daily_budget_minor <= budget_minor),
  spent_minor        bigint NOT NULL DEFAULT 0 CONSTRAINT ad_campaigns_spent_check CHECK (spent_minor >= 0 AND spent_minor <= budget_minor),
  refunded_minor     bigint NOT NULL DEFAULT 0 CONSTRAINT ad_campaigns_refunded_check CHECK (refunded_minor >= 0 AND spent_minor + refunded_minor <= budget_minor),
  currency           text NOT NULL CONSTRAINT ad_campaigns_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  starts_on          date NOT NULL,
  ends_on            date NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CONSTRAINT ad_campaigns_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'paused', 'stopped', 'ended')),
  rejection_reason   text,
  reviewed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  impressions        int NOT NULL DEFAULT 0,
  clicks             int NOT NULL DEFAULT 0,
  transfer_id        uuid,
  refunded_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_campaigns_target_check CHECK ((post_id IS NOT NULL)::int + (product_id IS NOT NULL)::int = 1),
  CONSTRAINT ad_campaigns_dates_check CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX ad_campaigns_client_uq ON ad_campaigns (user_id, client_id);
CREATE INDEX ad_campaigns_user_idx ON ad_campaigns (user_id, created_at DESC, id DESC);
CREATE INDEX ad_campaigns_status_idx ON ad_campaigns (status, created_at DESC, id DESC);

CREATE TABLE ad_daily (
  campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  day         date NOT NULL,
  impressions int NOT NULL DEFAULT 0,
  clicks      int NOT NULL DEFAULT 0,
  spent_minor bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, day)
);

-- Un clic facturé au plus par spectateur, campagne et jour (pas de facturation d'un clic répété).
CREATE TABLE ad_click_log (
  campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  viewer_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         date NOT NULL,
  PRIMARY KEY (campaign_id, viewer_id, day)
);

-- 0055_loyalty_campaigns: lot 16h loyalty points (a counter: no monetary value, not transferable) and marketing campaigns. Forward-only.
CREATE TABLE loyalty_programs (
  org_id          uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT false,
  points_per_unit integer NOT NULL DEFAULT 1 CONSTRAINT loyalty_programs_ppu_check CHECK (points_per_unit BETWEEN 1 AND 100),
  currency        char(3) NOT NULL DEFAULT 'USD' CONSTRAINT loyalty_programs_currency_check CHECK (currency IN ('USD', 'CDF')),
  reward_text     text NOT NULL DEFAULT '' CONSTRAINT loyalty_programs_reward_check CHECK (length(reward_text) <= 200),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- One movement per order: the unique constraint makes the award idempotent.
CREATE TABLE loyalty_movements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL CONSTRAINT loyalty_movements_order_unique UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points     integer NOT NULL CONSTRAINT loyalty_movements_points_check CHECK (points > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_movements_user_idx ON loyalty_movements (user_id, org_id);
CREATE INDEX loyalty_movements_org_idx ON loyalty_movements (org_id);
-- Explicit opt-in to shop offers, off by default (no row = not consenting).
CREATE TABLE marketing_consents (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  opted_in   boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Campaign history: title, date and count only, never the list of recipients.
CREATE TABLE marketing_campaigns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  title      text NOT NULL CONSTRAINT marketing_campaigns_title_check CHECK (length(title) BETWEEN 1 AND 80),
  body       text NOT NULL CONSTRAINT marketing_campaigns_body_check CHECK (length(body) BETWEEN 1 AND 300),
  recipients integer NOT NULL CONSTRAINT marketing_campaigns_recipients_check CHECK (recipients >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_campaigns_org_idx ON marketing_campaigns (org_id, created_at DESC);

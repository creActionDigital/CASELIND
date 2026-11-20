-- 0099_announcements_settings_commissions: annonces de la plateforme, parametres par pays et ville, commissions (CDC §26). Forward-only.
CREATE TABLE platform_announcements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL CONSTRAINT platform_announcements_title_check CHECK (char_length(title) BETWEEN 1 AND 80),
  body         text NOT NULL CONSTRAINT platform_announcements_body_check CHECK (char_length(body) BETWEEN 1 AND 500),
  audience     text NOT NULL DEFAULT 'all' CONSTRAINT platform_announcements_audience_check
                 CHECK (audience ~ '^(all|role:(user|moderator|support|admin)|country:[A-Z]{2})$'),
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CONSTRAINT platform_announcements_status_check CHECK (status IN ('draft', 'published', 'ended')),
  created_by   uuid NOT NULL REFERENCES users(id),
  published_at timestamptz,
  -- Renseigne quand la notification generique « Nouvelle annonce » est partie (une seule fois).
  notified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_announcements_period_check CHECK (ends_at > starts_at)
);
CREATE INDEX platform_announcements_status_idx ON platform_announcements (status, created_at DESC, id DESC);
CREATE INDEX platform_announcements_active_idx ON platform_announcements (starts_at DESC, id DESC) WHERE status = 'published';

CREATE TABLE platform_settings (
  key         text NOT NULL,
  scope       text NOT NULL CONSTRAINT platform_settings_scope_check CHECK (scope ~ '^(global|country:[A-Z]{2}|city:[A-Z]{2}:[^:]{1,60})$'),
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, scope)
);

-- Surcharge du taux de commission d'une organisation (points de base), NULL = taux de la plateforme.
ALTER TABLE organizations ADD COLUMN commission_bps integer CONSTRAINT organizations_commission_bps_check CHECK (commission_bps IS NULL OR commission_bps BETWEEN 0 AND 3000);

-- Releve indicatif : une ligne par commande livree, aucun prelevement reel.
CREATE TABLE order_commissions (
  order_id         uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES organizations(id),
  gross_minor      bigint NOT NULL CONSTRAINT order_commissions_gross_check CHECK (gross_minor >= 0),
  bps              integer NOT NULL CONSTRAINT order_commissions_bps_check CHECK (bps BETWEEN 0 AND 3000),
  commission_minor bigint NOT NULL CONSTRAINT order_commissions_amount_check CHECK (commission_minor >= 0),
  currency         char(3) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_commissions_org_idx ON order_commissions (org_id, created_at DESC, order_id DESC);
CREATE INDEX order_commissions_date_idx ON order_commissions (created_at);

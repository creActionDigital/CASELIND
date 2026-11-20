-- 0095_miniapp_manifest_platform: manifeste declaratif des mini-applications (cahier §23), certification, partage de revenus
-- (releves indicatifs), reglage des notifications par application et scope `notify`. Forward-only.

-- Manifeste fige par version ; celui de la version approuvee est recopie sur l'application (c'est lui que le garde applique).
ALTER TABLE miniapp_versions ADD COLUMN manifest jsonb;
ALTER TABLE miniapps ADD COLUMN manifest jsonb;

-- Nouveau scope `notify` : notification envoyee a l'utilisateur du jeton.
ALTER TABLE miniapps DROP CONSTRAINT miniapps_scopes_check;
ALTER TABLE miniapps ADD CONSTRAINT miniapps_scopes_check
  CHECK (scopes <@ ARRAY['profile.basic', 'profile.phone', 'profile.email', 'orders.read', 'wallet.pay', 'notify']);
ALTER TABLE miniapp_versions DROP CONSTRAINT miniapp_versions_scopes_check;
ALTER TABLE miniapp_versions ADD CONSTRAINT miniapp_versions_scopes_check
  CHECK (scopes_requested <@ ARRAY['profile.basic', 'profile.phone', 'profile.email', 'orders.read', 'wallet.pay', 'notify']);
ALTER TABLE miniapp_access_log DROP CONSTRAINT miniapp_access_log_resource_check;
ALTER TABLE miniapp_access_log ADD CONSTRAINT miniapp_access_log_resource_check CHECK (resource IN ('profile', 'orders', 'payment', 'notification'));

-- Certification (le niveau `reviewed` se deduit de la publication) et part de la plateforme en points de base (0-30 %).
ALTER TABLE miniapps ADD COLUMN certified_at timestamptz;
ALTER TABLE miniapps ADD COLUMN certified_by uuid REFERENCES users(id);
ALTER TABLE miniapps ADD COLUMN certification_note text CONSTRAINT miniapps_certification_note_check CHECK (certification_note IS NULL OR char_length(certification_note) <= 500);
ALTER TABLE miniapps ADD COLUMN revenue_share_bps integer NOT NULL DEFAULT 0 CONSTRAINT miniapps_revenue_share_check CHECK (revenue_share_bps BETWEEN 0 AND 3000);

-- L'utilisateur peut couper les notifications d'une application sans retirer son autorisation.
ALTER TABLE miniapp_grants ADD COLUMN notifications_muted boolean NOT NULL DEFAULT false;

-- Releves mensuels indicatifs : aucun versement reel (le paiement en ligne reste a un tiers). Un releve clos n'est plus recalcule.
CREATE TABLE miniapp_revenue_statements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  miniapp_id      uuid NOT NULL REFERENCES miniapps(id) ON DELETE CASCADE,
  period          date NOT NULL CONSTRAINT miniapp_revenue_period_check CHECK (extract(day FROM period) = 1),
  currency        text NOT NULL CONSTRAINT miniapp_revenue_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  gross_minor     bigint NOT NULL CONSTRAINT miniapp_revenue_gross_check CHECK (gross_minor >= 0),
  platform_minor  bigint NOT NULL CONSTRAINT miniapp_revenue_platform_check CHECK (platform_minor >= 0),
  developer_minor bigint NOT NULL CONSTRAINT miniapp_revenue_developer_check CHECK (developer_minor >= 0),
  share_bps       integer NOT NULL CONSTRAINT miniapp_revenue_bps_check CHECK (share_bps BETWEEN 0 AND 3000),
  payments_count  integer NOT NULL DEFAULT 0 CONSTRAINT miniapp_revenue_count_check CHECK (payments_count >= 0),
  status          text NOT NULL DEFAULT 'open' CONSTRAINT miniapp_revenue_status_check CHECK (status IN ('open', 'closed')),
  computed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT miniapp_revenue_unique UNIQUE (miniapp_id, period, currency),
  CONSTRAINT miniapp_revenue_sum_check CHECK (platform_minor + developer_minor = gross_minor)
);
CREATE INDEX miniapp_revenue_app_idx ON miniapp_revenue_statements (miniapp_id, period DESC);

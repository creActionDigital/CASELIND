-- 0002_platform_controls: lot 1b platform controls — feature flags per country and per role.
-- Other lot 1b controls live in their own migrations (0003_privacy_blocks, ...).
-- Forward-only. Never edit an applied migration: add a new one.

-- One row per feature. A flag is ON for a user only if it is enabled AND the user's
-- country is allowed (NULL = every country) AND the user has an allowed role (NULL = every role).
-- `regulated` flags gate activities needing a licence or legal validation (CDC §21, §26):
-- they ship disabled and enabling them requires an explicit confirmation from an admin.
CREATE TABLE feature_flags (
  key                text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]+$'),
  description        text NOT NULL,
  enabled            boolean NOT NULL DEFAULT false,
  regulated          boolean NOT NULL DEFAULT false,
  allowed_countries  char(2)[],
  allowed_roles      text[]
                       CHECK (allowed_roles <@ ARRAY['user', 'moderator', 'support', 'admin']::text[]),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid
);

CREATE TRIGGER feature_flags_set_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Regulated modules: off until legally validated per country.
INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('wallet.real_money',       'Portefeuille en argent réel (CDC §21, licence de paiement requise)', false, true),
  ('wallet.p2p_transfer',     'Transferts d''argent entre utilisateurs (CDC §21)',                  false, true),
  ('gifts.red_packets',       'Enveloppes rouges / cadeaux monétaires (CDC §21)',                   false, true),
  ('csl_coins',               'Monnaie virtuelle CSL Coins (CDC §21)',                              false, true),
  ('betting',                 'Paris et jeux d''argent (CDC §26, licence de jeux requise)',          false, true),
  ('trading.live',            'Trading en direct sur actifs réels (CDC §26)',                       false, true),
  ('health.teleconsultation', 'Téléconsultation médicale (CDC §26, agrément santé requis)',          false, true),
  ('health.prescriptions',    'Ordonnances électroniques (CDC §26, agrément santé requis)',         false, true);

-- Non-regulated modules available at launch.
INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('social.stories', 'Stories éphémères', true, false),
  ('messaging',      'Messagerie privée', true, false);

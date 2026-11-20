-- 0088_miniapp_versions: versions des mini-applications (scopes figes par version), version courante, quota par application
-- et marque de re-consentement des autorisations. Forward-only.

CREATE TABLE miniapp_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  miniapp_id       uuid NOT NULL REFERENCES miniapps(id) ON DELETE CASCADE,
  version          text NOT NULL CONSTRAINT miniapp_versions_semver_check CHECK (version ~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$'),
  changelog        text CONSTRAINT miniapp_versions_changelog_check CHECK (changelog IS NULL OR char_length(changelog) <= 1000),
  -- Ensemble complet des scopes declares par cette version, fige a la creation.
  scopes_requested text[] NOT NULL DEFAULT '{}'
                     CONSTRAINT miniapp_versions_scopes_check CHECK (scopes_requested <@ ARRAY['profile.basic', 'profile.phone', 'profile.email', 'orders.read', 'wallet.pay']),
  status           text NOT NULL DEFAULT 'draft'
                     CONSTRAINT miniapp_versions_status_check CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'superseded')),
  review_note      text,
  submitted_at     timestamptz,
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT miniapp_versions_unique UNIQUE (miniapp_id, version)
);
CREATE INDEX miniapp_versions_app_idx ON miniapp_versions (miniapp_id, created_at DESC, id DESC);
CREATE INDEX miniapp_versions_status_idx ON miniapp_versions (status, submitted_at);

-- Version approuvee affichee dans l'annuaire ; limite de debit par minute propre a l'application (NULL = valeur par defaut de l'environnement).
ALTER TABLE miniapps ADD COLUMN current_version text;
ALTER TABLE miniapps ADD COLUMN rate_limit_per_minute integer CONSTRAINT miniapps_rate_limit_check CHECK (rate_limit_per_minute IS NULL OR rate_limit_per_minute BETWEEN 1 AND 100000);

-- Un grant ne couvre que les scopes consentis ; vrai quand une version approuvee a ajoute des scopes que l'utilisateur n'a pas encore acceptes.
ALTER TABLE miniapp_grants ADD COLUMN reconsent_required boolean NOT NULL DEFAULT false;

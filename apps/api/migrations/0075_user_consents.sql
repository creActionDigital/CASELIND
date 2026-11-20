-- 0075_user_consents: journal central des consentements (G7, CDC §4/§29). Forward-only.
-- Append-only : une ligne par changement de reponse ; l'etat courant = derniere ligne par (user, kind).
-- Liste blanche des kinds : etendre par une migration qui remplace user_consents_kind_check.
CREATE TABLE user_consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CONSTRAINT user_consents_kind_check CHECK (kind IN ('health', 'marketing', 'location_sharing', 'ai_processing', 'analytics', 'translation')),
  granted     boolean NOT NULL,
  version     text NOT NULL CONSTRAINT user_consents_version_check CHECK (length(version) BETWEEN 1 AND 20),
  source      text NOT NULL DEFAULT 'app' CONSTRAINT user_consents_source_check CHECK (source IN ('app')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_consents_user_kind_idx ON user_consents (user_id, kind, seq DESC);

-- Une ligne ne se modifie jamais (la suppression reste possible : purge du compte, cascade).
CREATE FUNCTION user_consents_no_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'user_consents is append-only';
END $$;
CREATE TRIGGER user_consents_no_update BEFORE UPDATE ON user_consents FOR EACH ROW EXECUTE FUNCTION user_consents_no_update();

-- Reprise de l'existant : une ligne initiale par consentement deja enregistre.
INSERT INTO user_consents (user_id, kind, granted, version, created_at)
  SELECT user_id, 'health', true, version, granted_at FROM health_consents;
INSERT INTO user_consents (user_id, kind, granted, version, created_at)
  SELECT user_id, 'marketing', opted_in, '1', updated_at FROM marketing_consents;

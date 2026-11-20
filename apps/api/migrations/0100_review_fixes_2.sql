-- 0100_review_fixes_2: constats ouverts des relectures (promotion rendue a l'annulation, journal de consentements protege, actifs par jour). Forward-only.
ALTER TABLE order_items ADD COLUMN promotion_id uuid, ADD COLUMN promo_units integer NOT NULL DEFAULT 0;
-- Coursier a la demande : series d'echecs du code de remise (verrou croissant, definitif apres 3 series jusqu'a reinitialisation par le demandeur).
ALTER TABLE courier_requests ADD COLUMN proof_lock_rounds integer NOT NULL DEFAULT 0;

-- Journal des consentements : ni DELETE ni TRUNCATE, sauf la purge de compte (maintenance) qui pose SET LOCAL caselind.purge = 'on' dans sa transaction.
CREATE FUNCTION user_consents_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('caselind.purge', true) = 'on' THEN
    IF TG_LEVEL = 'ROW' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'user_consents is append-only';
END $$;
CREATE TRIGGER user_consents_no_delete BEFORE DELETE ON user_consents FOR EACH ROW EXECUTE FUNCTION user_consents_no_delete();
CREATE TRIGGER user_consents_no_truncate BEFORE TRUNCATE ON user_consents FOR EACH STATEMENT EXECUTE FUNCTION user_consents_no_delete();

-- Utilisateurs actifs par jour : compteur quotidien (un jour par utilisateur), alimente a la connexion et au renouvellement de session.
-- Les jetons de renouvellement sont purges a 7 jours : ils ne peuvent plus servir de source aux courbes longues.
CREATE TABLE user_active_days (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     date NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX user_active_days_day_idx ON user_active_days (day);
INSERT INTO user_active_days (user_id, day)
  SELECT DISTINCT s.user_id, (rt.created_at AT TIME ZONE 'UTC')::date FROM refresh_tokens rt JOIN sessions s ON s.id = rt.session_id
  ON CONFLICT DO NOTHING;

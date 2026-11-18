-- 0070_health_results: resultats d'examens du dossier de sante (CDC §12, lot 18d). Forward-only.
-- Meme regles que le reste du dossier : drapeau regule `health`, consentement explicite, contenu chiffre (AES-256-GCM lie au patient).
-- Le compte rendu (PDF ou image) est un media de finalite health_result, lisible par le patient et, tant qu'un partage actif couvre
-- la categorie `results`, par le professionnel concerne. Aucune integration de laboratoire.
ALTER TABLE media_assets DROP CONSTRAINT media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('avatar', 'post', 'message', 'story', 'org_logo', 'org_banner', 'product', 'document', 'kyc_document', 'listing', 'cv', 'delivery', 'lesson', 'org_gallery', 'delivery_proof', 'health_result'));

-- `payload` est le chiffre de {title, summary}. Seuls le type et la date restent lisibles (tri, filtre).
-- `provider_user_id` : le professionnel verifie qui a saisi le resultat (null = saisi par le patient).
CREATE TABLE health_results (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              text NOT NULL CONSTRAINT health_results_kind_check CHECK (kind IN ('blood', 'urine', 'imaging', 'other')),
  payload           text NOT NULL,
  result_date       date NOT NULL,
  provider_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  media_id          uuid UNIQUE REFERENCES media_assets(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_results_user_idx ON health_results (user_id, result_date DESC, id DESC);

-- Un partage peut maintenant aussi couvrir la categorie `results` (les partages existants ne la couvrent pas).
ALTER TABLE health_shares DROP CONSTRAINT health_shares_kinds_check;
ALTER TABLE health_shares ADD CONSTRAINT health_shares_kinds_check CHECK (cardinality(kinds) BETWEEN 1 AND 8);

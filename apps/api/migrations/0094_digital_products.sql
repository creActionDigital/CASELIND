-- 0094_digital_products: produits numeriques (CDC §7). Un produit est « numerique » des qu'il porte des fichiers ; l'acheteur les telecharge
-- une fois la commande livree (le vendeur la marque livree : aucun paiement en ligne). Finalite media digital_file. Forward-only.
ALTER TABLE media_assets DROP CONSTRAINT media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('avatar', 'post', 'message', 'story', 'org_logo', 'org_banner', 'product', 'document', 'kyc_document', 'listing', 'cv', 'delivery', 'lesson', 'org_gallery', 'delivery_proof', 'health_result', 'digital_file'));
CREATE TABLE product_files (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id   uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position   integer NOT NULL CONSTRAINT product_files_position_check CHECK (position BETWEEN 0 AND 4),
  PRIMARY KEY (product_id, media_id)
);

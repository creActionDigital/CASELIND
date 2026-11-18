-- 0068_delivery_proofs: preuve de livraison par photo et/ou signature (audit G5), en complement du code. Finalite media delivery_proof. Forward-only.
ALTER TABLE media_assets DROP CONSTRAINT media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('avatar', 'post', 'message', 'story', 'org_logo', 'org_banner', 'product', 'document', 'kyc_document', 'listing', 'cv', 'delivery', 'lesson', 'org_gallery', 'delivery_proof'));
CREATE TABLE delivery_proofs (
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  kind        text NOT NULL CONSTRAINT delivery_proofs_kind_check CHECK (kind IN ('photo', 'signature')),
  media_id    uuid NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE CASCADE,
  taken_at    timestamptz NOT NULL DEFAULT now(),
  taken_by    uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (delivery_id, kind)
);

-- 0062_org_gallery: galerie photo/video de la vitrine (CDC §5). Finalite media org_gallery, 12 fichiers au plus par organisation. Forward-only.
ALTER TABLE media_assets DROP CONSTRAINT media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('avatar', 'post', 'message', 'story', 'org_logo', 'org_banner', 'product', 'document', 'kyc_document', 'listing', 'cv', 'delivery', 'lesson', 'org_gallery'));
CREATE TABLE org_gallery_files (
  org_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position integer NOT NULL CONSTRAINT org_gallery_files_position_check CHECK (position BETWEEN 0 AND 11),
  PRIMARY KEY (org_id, media_id)
);

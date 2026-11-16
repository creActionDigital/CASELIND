-- 0054_attachments: lot 19m CV PDF, freelance delivery files, lesson files (media purposes cv, delivery, lesson). Forward-only.
ALTER TABLE media_assets DROP CONSTRAINT media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('avatar', 'post', 'message', 'story', 'org_logo', 'org_banner', 'product', 'document', 'kyc_document', 'listing', 'cv', 'delivery', 'lesson'));

-- The PDF of the CV; an application keeps its own pointer (snapshot) so a later replacement does not change what the recruiter sees.
ALTER TABLE job_profiles ADD COLUMN cv_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE job_applications ADD COLUMN cv_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;

CREATE TABLE milestone_files (
  milestone_id uuid NOT NULL REFERENCES contract_milestones(id) ON DELETE CASCADE,
  media_id     uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position     integer NOT NULL CONSTRAINT milestone_files_position_check CHECK (position BETWEEN 0 AND 2),
  PRIMARY KEY (milestone_id, media_id)
);
CREATE TABLE lesson_files (
  lesson_id uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  media_id  uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position  integer NOT NULL CONSTRAINT lesson_files_position_check CHECK (position BETWEEN 0 AND 2),
  PRIMARY KEY (lesson_id, media_id)
);

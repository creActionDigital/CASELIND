-- 0066_school_guardians: lot 17b leftovers. Optional parent-pupil link kept by the school + one-time fee due-date reminder. Forward-only.
-- No parent account is required (the school stays answerable for minors and parental consent): the link is OPTIONAL and the school's staff
-- creates it for an enrolled pupil by the parent's handle; the parent must accept it. Under the regulated `school` flag.

CREATE TABLE school_guardians (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation         text NOT NULL DEFAULT '' CONSTRAINT school_guardians_relation_check CHECK (length(relation) <= 40),
  status           text NOT NULL DEFAULT 'pending' CONSTRAINT school_guardians_status_check CHECK (status IN ('pending', 'active')),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_guardians_unique UNIQUE (org_id, student_user_id, guardian_user_id),
  CONSTRAINT school_guardians_distinct_check CHECK (student_user_id <> guardian_user_id)
);
CREATE INDEX school_guardians_guardian_idx ON school_guardians (guardian_user_id, status);
CREATE INDEX school_guardians_student_idx ON school_guardians (student_user_id);

-- Set once the reminder went out, so a fee is announced a single time however often maintenance runs.
ALTER TABLE school_fees ADD COLUMN reminded_at timestamptz;

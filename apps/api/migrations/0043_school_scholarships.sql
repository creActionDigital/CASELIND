-- 0043_school_scholarships: lot 17e scholarships published by schools (CDC §13). Forward-only. Behind the regulated `school` flag.
-- No online application in this lot. Only the title, description, deadline and https link are stored.
CREATE TABLE school_scholarships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title       text NOT NULL CONSTRAINT school_scholarships_title_check CHECK (length(title) BETWEEN 1 AND 120),
  description text NOT NULL CONSTRAINT school_scholarships_desc_check CHECK (length(description) BETWEEN 1 AND 2000),
  deadline    date,
  url         text CONSTRAINT school_scholarships_url_check CHECK (url ~ '^https://' AND length(url) <= 500),
  status      text NOT NULL DEFAULT 'open' CONSTRAINT school_scholarships_status_check CHECK (status IN ('open', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX school_scholarships_org_idx ON school_scholarships (org_id, created_at DESC);

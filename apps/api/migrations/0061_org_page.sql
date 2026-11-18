-- 0061_org_page: vitrine mini-site (CDC §5): liens, zones desservies, sections libres et questions/reponses. Forward-only.
ALTER TABLE organizations
  ADD COLUMN page jsonb NOT NULL DEFAULT '{"links": [], "serviceAreas": [], "sections": [], "faq": []}'::jsonb;

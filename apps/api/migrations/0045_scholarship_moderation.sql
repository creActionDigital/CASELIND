-- 0045_scholarship_moderation: lot 17g, scholarships become a report/moderation target. Forward-only.
-- Full list of 0041 (no later migration touched the constraint) plus 'scholarship'.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job', 'mission', 'course', 'course_review', 'scholarship'));
ALTER TABLE school_scholarships ADD COLUMN hidden boolean NOT NULL DEFAULT false;

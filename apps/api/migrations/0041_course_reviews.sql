-- 0041_course_reviews: lot 17d, one rating (1-5) and optional comment per enrolled learner and course. Forward-only.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job', 'mission', 'course', 'course_review'));

CREATE TABLE course_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CONSTRAINT course_reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  body        text NOT NULL DEFAULT '' CONSTRAINT course_reviews_body_check CHECK (length(body) <= 500),
  hidden      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);
CREATE INDEX course_reviews_feed_idx ON course_reviews (course_id, created_at DESC, id DESC);

-- 0030_education: lot 17a online courses, lessons, quiz, progress, certificates (CDC §13). Forward-only.
-- Schools (timetables, parents, fees) come with lot 17b. No age is known to the platform: minors are not special-cased yet (documented).

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('education', 'Éducation : cours, leçons, quiz, certificats', true, false);

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job', 'mission', 'course'));

CREATE TABLE courses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          text NOT NULL CONSTRAINT courses_title_check CHECK (length(title) BETWEEN 3 AND 120),
  description    text NOT NULL DEFAULT '' CONSTRAINT courses_description_check CHECK (length(description) <= 4000),
  level          text NOT NULL CONSTRAINT courses_level_check CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  language       text NOT NULL CONSTRAINT courses_language_check CHECK (language IN ('fr', 'en', 'sw', 'ln')),
  status         text NOT NULL DEFAULT 'draft' CONSTRAINT courses_status_check CHECK (status IN ('draft', 'published')),
  pass_percent   smallint NOT NULL DEFAULT 70 CONSTRAINT courses_pass_check CHECK (pass_percent BETWEEN 1 AND 100),
  hidden         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courses_feed_idx ON courses (created_at DESC, id DESC) WHERE status = 'published' AND NOT hidden;
CREATE INDEX courses_author_idx ON courses (author_id, created_at DESC);

CREATE TABLE course_lessons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position   integer NOT NULL CONSTRAINT course_lessons_position_check CHECK (position >= 0),
  title      text NOT NULL CONSTRAINT course_lessons_title_check CHECK (length(title) BETWEEN 1 AND 120),
  content    text NOT NULL DEFAULT '' CONSTRAINT course_lessons_content_check CHECK (length(content) <= 8000),
  UNIQUE (course_id, position)
);

-- One quiz per course. The correct answer never leaves the server before the attempt is graded.
CREATE TABLE course_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position       integer NOT NULL CONSTRAINT course_questions_position_check CHECK (position >= 0),
  prompt         text NOT NULL CONSTRAINT course_questions_prompt_check CHECK (length(prompt) BETWEEN 1 AND 500),
  options        jsonb NOT NULL CONSTRAINT course_questions_options_check CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 6),
  correct_index  integer NOT NULL CONSTRAINT course_questions_correct_check CHECK (correct_index >= 0),
  UNIQUE (course_id, position)
);

CREATE TABLE course_enrollments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  UNIQUE (course_id, user_id)
);
CREATE INDEX course_enrollments_user_idx ON course_enrollments (user_id, enrolled_at DESC);

CREATE TABLE lesson_progress (
  enrollment_id  uuid NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
  lesson_id      uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  completed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enrollment_id, lesson_id)
);

CREATE TABLE quiz_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  uuid NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
  score_percent  smallint NOT NULL CONSTRAINT quiz_attempts_score_check CHECK (score_percent BETWEEN 0 AND 100),
  passed         boolean NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quiz_attempts_enrollment_idx ON quiz_attempts (enrollment_id, created_at DESC);

CREATE TABLE certificates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CONSTRAINT certificates_code_check CHECK (code ~ '^[A-Z0-9]{12}$'),
  enrollment_id  uuid NOT NULL UNIQUE REFERENCES course_enrollments(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  issued_at      timestamptz NOT NULL DEFAULT now()
);

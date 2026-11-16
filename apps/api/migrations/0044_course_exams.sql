-- 0044_course_exams: lot 17f, timed mock exams on a course quiz. Forward-only. Separate from quiz_attempts: no certificate, no effect on the best quiz score.
ALTER TABLE courses ADD COLUMN exam_minutes smallint CONSTRAINT courses_exam_minutes_check CHECK (exam_minutes BETWEEN 5 AND 180);

CREATE TABLE exam_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  question_ids  uuid[] NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  finished_at   timestamptz,
  score_percent smallint CONSTRAINT exam_sessions_score_check CHECK (score_percent BETWEEN 0 AND 100),
  correct       smallint,
  total         smallint NOT NULL
);
CREATE INDEX exam_sessions_user_course_idx ON exam_sessions (user_id, course_id, started_at DESC);

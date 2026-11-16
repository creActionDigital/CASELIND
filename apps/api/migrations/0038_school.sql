-- 0038_school: lot 17b schools: classes, enrolment, timetable and class announcements (CDC §13). Forward-only.
-- Pupils may be minors: the school (an organisation of kind "school") decides who is enrolled, in which role (consent of the
-- parents is the school's responsibility, see BACKLOG). Nothing here is public: only the school's staff and the enrolled read it.
-- Regulated module: off by default, an administrator turns it on.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('school', 'Établissements : classes, emplois du temps, annonces (peut concerner des mineurs)', false, true);

CREATE TABLE school_classes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL CONSTRAINT school_classes_name_check CHECK (length(name) BETWEEN 1 AND 80),
  year_label text NOT NULL DEFAULT '' CONSTRAINT school_classes_year_check CHECK (length(year_label) <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_classes_unique UNIQUE (org_id, name, year_label)
);

CREATE TABLE school_enrollments (
  class_id   uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CONSTRAINT school_enrollments_role_check CHECK (role IN ('student', 'parent', 'teacher')),
  added_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX school_enrollments_user_idx ON school_enrollments (user_id);

CREATE TABLE school_lessons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  weekday    integer NOT NULL CONSTRAINT school_lessons_weekday_check CHECK (weekday BETWEEN 1 AND 7),
  starts_at  text NOT NULL CONSTRAINT school_lessons_starts_check CHECK (starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ends_at    text NOT NULL CONSTRAINT school_lessons_ends_check CHECK (ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  subject    text NOT NULL CONSTRAINT school_lessons_subject_check CHECK (length(subject) BETWEEN 1 AND 80),
  room       text NOT NULL DEFAULT '' CONSTRAINT school_lessons_room_check CHECK (length(room) <= 40),
  CONSTRAINT school_lessons_order_check CHECK (ends_at > starts_at)
);
CREATE INDEX school_lessons_class_idx ON school_lessons (class_id, weekday, starts_at);

CREATE TABLE school_announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  title      text NOT NULL CONSTRAINT school_announcements_title_check CHECK (length(title) BETWEEN 1 AND 120),
  body       text NOT NULL CONSTRAINT school_announcements_body_check CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX school_announcements_class_idx ON school_announcements (class_id, created_at DESC);

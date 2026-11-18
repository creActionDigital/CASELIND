-- 0065_org_reviews_questions: avis d'organisation (acheteurs d'une commande livree) et questions des visiteurs sur la vitrine publique (CDC §5).
-- Signalables (cibles 'org_review' et 'org_question'). Forward-only.
CREATE TABLE org_reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id   uuid REFERENCES orders(id) ON DELETE SET NULL,
  rating     smallint NOT NULL CONSTRAINT org_reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  body       text CONSTRAINT org_reviews_body_check CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 500),
  reply      text CONSTRAINT org_reviews_reply_check CHECK (reply IS NULL OR char_length(reply) BETWEEN 1 AND 500),
  replied_at timestamptz,
  replied_by uuid REFERENCES users(id) ON DELETE SET NULL,
  hidden     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_reviews_org_user_unique UNIQUE (org_id, user_id),
  CONSTRAINT org_reviews_reply_pair_check CHECK ((reply IS NULL) = (replied_at IS NULL))
);
CREATE INDEX org_reviews_org_idx ON org_reviews (org_id, created_at DESC, id DESC);

CREATE TABLE org_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question      text NOT NULL CONSTRAINT org_questions_question_check CHECK (char_length(question) BETWEEN 1 AND 300),
  answer        text CONSTRAINT org_questions_answer_check CHECK (answer IS NULL OR char_length(answer) BETWEEN 1 AND 1000),
  answered_at   timestamptz,
  answered_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  hidden        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_questions_answer_pair_check CHECK ((answer IS NULL) = (answered_at IS NULL))
);
CREATE INDEX org_questions_org_idx ON org_questions (org_id, created_at DESC, id DESC);
CREATE INDEX org_questions_public_idx ON org_questions (org_id, answered_at DESC, id DESC) WHERE answer IS NOT NULL AND NOT hidden;
CREATE INDEX org_questions_asker_idx ON org_questions (asker_user_id, created_at DESC);

-- Liste complete de 0064 plus 'org_review' et 'org_question'.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job', 'mission', 'course', 'course_review', 'scholarship', 'org_update', 'org_review', 'org_question'));

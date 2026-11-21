-- 0142_help_requests: demandes d'aide adressees au support CASELIND, traitees depuis l'administration. Forward-only.
CREATE TABLE help_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    text NOT NULL CONSTRAINT help_requests_category_check CHECK (category IN ('account', 'payment', 'order', 'bug', 'other')),
  subject     text NOT NULL CONSTRAINT help_requests_subject_check CHECK (char_length(subject) BETWEEN 3 AND 120),
  body        text NOT NULL CONSTRAINT help_requests_body_check CHECK (char_length(body) BETWEEN 5 AND 2000),
  status      text NOT NULL DEFAULT 'open' CONSTRAINT help_requests_status_check CHECK (status IN ('open', 'resolved')),
  reply       text CONSTRAINT help_requests_reply_check CHECK (reply IS NULL OR char_length(reply) <= 2000),
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX help_requests_user_idx ON help_requests (user_id, created_at DESC, id DESC);
CREATE INDEX help_requests_status_idx ON help_requests (status, created_at, id);

-- 0120_post_attachments: piece jointe optionnelle d'une publication (evenement, sondage, localisation) et votes de sondage. Forward-only.
CREATE TABLE post_attachments (
  post_id    uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  type       text NOT NULL CONSTRAINT post_attachments_type_check CHECK (type IN ('event', 'poll', 'location')),
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE post_poll_votes (
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_idx smallint NOT NULL CONSTRAINT post_poll_votes_idx_check CHECK (option_idx BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

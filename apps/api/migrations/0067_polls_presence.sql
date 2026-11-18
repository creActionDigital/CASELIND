-- 0067_polls_presence: conversation polls (a message of kind 'poll'), "online" presence setting + last seen. Forward-only.
-- Votes are anonymous towards other members: only the counters are ever served (the table is read per user for "my votes" and the export).

ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'media', 'system', 'poll'));

CREATE TABLE message_polls (
  message_id  uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  creator_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  question    text NOT NULL CONSTRAINT message_polls_question_check CHECK (char_length(question) BETWEEN 1 AND 200),
  multiple    boolean NOT NULL DEFAULT false,
  closes_at   timestamptz,
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_polls_creator_idx ON message_polls (creator_id) WHERE creator_id IS NOT NULL;

CREATE TABLE message_poll_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES message_polls(message_id) ON DELETE CASCADE,
  position    smallint NOT NULL CONSTRAINT message_poll_options_position_check CHECK (position BETWEEN 0 AND 5),
  label       text NOT NULL CONSTRAINT message_poll_options_label_check CHECK (char_length(label) BETWEEN 1 AND 80),
  CONSTRAINT message_poll_options_position_key UNIQUE (message_id, position)
);

CREATE TABLE message_poll_votes (
  option_id   uuid NOT NULL REFERENCES message_poll_options(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL REFERENCES message_polls(message_id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX message_poll_votes_message_user_idx ON message_poll_votes (message_id, user_id);
CREATE INDEX message_poll_votes_user_idx ON message_poll_votes (user_id);

-- Presence: shown by default; reciprocal (who hides theirs does not see the others'). last_seen_at is the only trace kept.
ALTER TABLE users ADD COLUMN show_presence boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN last_seen_at timestamptz;

-- 0017_messaging_extras: lot 3b forwarding, favourites, disappearing and scheduled messages, drafts.
-- Forward-only. Never edit an applied migration: add a new one.

ALTER TABLE conversations
  ADD COLUMN disappearing_seconds integer CHECK (disappearing_seconds IN (86400, 604800, 7776000));

-- forwarded: no reference to the original message or author (nothing to leak).
-- expires_at: set at insertion from the conversation setting; past it the API no longer serves the message.
ALTER TABLE messages ADD COLUMN forwarded boolean NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN expires_at timestamptz;
CREATE INDEX messages_expires_idx ON messages (expires_at) WHERE expires_at IS NOT NULL;

-- Messages favourited by a user (access is re-checked at read time, nothing is copied).
CREATE TABLE message_favorites (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX message_favorites_user_idx ON message_favorites (user_id, created_at DESC, message_id DESC);

-- A message waiting for its send time. It has no seq and is invisible until the job turns it into a messages row
-- (and deletes this one, in the same transaction).
CREATE TABLE scheduled_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('text', 'media')),
  body             text CHECK (char_length(body) <= 4000),
  media_id         uuid REFERENCES media_assets(id) ON DELETE CASCADE,
  reply_to_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  mentions         uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 50),
  scheduled_at     timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_messages_sender_client_key UNIQUE (sender_id, conversation_id, client_id)
);
CREATE INDEX scheduled_messages_due_idx ON scheduled_messages (scheduled_at);
CREATE INDEX scheduled_messages_sender_idx ON scheduled_messages (sender_id, scheduled_at);

-- One draft per member and conversation, synced across devices.
CREATE TABLE conversation_drafts (
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

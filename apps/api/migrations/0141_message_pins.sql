-- 0141_message_pins: messages epingles dans une conversation (visibles de tous les membres). Forward-only.
CREATE TABLE message_pins (
  message_id      uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pinned_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  pinned_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_pins_conv_idx ON message_pins (conversation_id, pinned_at DESC);

-- 0007_messaging: lot 3A direct and group conversations, messages, reactions, per-member state.
-- Forward-only. Never edit an applied migration: add a new one.

-- direct_key = '<smaller user id>:<larger user id>' (text order): one direct conversation per pair.
-- last_seq is the sequence counter: a message gets last_seq + 1 while the row is locked FOR UPDATE.
CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('direct', 'group')),
  direct_key       text UNIQUE,
  title            text CHECK (char_length(title) BETWEEN 1 AND 100),
  announcement     text CHECK (char_length(announcement) <= 1000),
  avatar_url       text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  last_seq         bigint NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_direct_key_iff_direct CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CONSTRAINT conversations_direct_has_no_group_fields
    CHECK (kind = 'group' OR (title IS NULL AND announcement IS NULL AND avatar_url IS NULL)),
  CONSTRAINT conversations_group_has_title CHECK (kind = 'direct' OR title IS NOT NULL)
);

CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A member who left or was removed keeps a 'left' row (history of roles, re-adding). first_seq is
-- the first message the member may see (members who join later never see the earlier history).
-- "At least one owner" is enforced by the API in a transaction that locks the conversation row.
CREATE TABLE conversation_members (
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  joined_at           timestamptz NOT NULL DEFAULT now(),
  left_at             timestamptz,
  first_seq           bigint NOT NULL DEFAULT 1 CHECK (first_seq >= 1),
  last_delivered_seq  bigint NOT NULL DEFAULT 0 CHECK (last_delivered_seq >= 0),
  last_read_seq       bigint NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
  muted_until         timestamptz,
  pinned              boolean NOT NULL DEFAULT false,
  archived            boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_members_left_iff_left CHECK ((status = 'left') = (left_at IS NOT NULL)),
  CONSTRAINT conversation_members_read_le_delivered CHECK (last_read_seq <= last_delivered_seq)
);
-- Conversation list, room joins and "active conversations of a user" lookups.
CREATE INDEX conversation_members_user_active_idx ON conversation_members (user_id, conversation_id) WHERE status = 'active';
-- Member lists and group size.
CREATE INDEX conversation_members_conv_active_idx ON conversation_members (conversation_id, joined_at, user_id) WHERE status = 'active';

-- kind 'system' messages are written by the server only (sender_id NULL, system_event set).
-- A recalled message and the messages of a deleted account have body/media_id cleared.
CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq              bigint NOT NULL CHECK (seq >= 1),
  sender_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind IN ('text', 'media', 'system')),
  client_id        uuid,
  body             text CHECK (char_length(body) <= 4000),
  media_id         uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  reply_to_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  mentions         uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 50),
  system_event     jsonb,
  recalled_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_system_iff_event CHECK ((kind = 'system') = (system_event IS NOT NULL)),
  CONSTRAINT messages_media_only_on_media CHECK (media_id IS NULL OR kind = 'media'),
  CONSTRAINT messages_client_id_for_user_messages CHECK (kind = 'system' OR client_id IS NOT NULL OR sender_id IS NULL),
  CONSTRAINT messages_recalled_is_empty CHECK (recalled_at IS NULL OR (body IS NULL AND media_id IS NULL)),
  CONSTRAINT messages_conversation_seq_key UNIQUE (conversation_id, seq),
  CONSTRAINT messages_sender_client_key UNIQUE (sender_id, conversation_id, client_id)
);
-- Which conversations an asset was sent in (media read policy).
CREATE INDEX messages_media_idx ON messages (media_id) WHERE media_id IS NOT NULL;
-- "Messages sent by a user" (export, purge).
CREATE INDEX messages_sender_idx ON messages (sender_id) WHERE sender_id IS NOT NULL;

-- Messages a member removed from their own view ("delete for me").
CREATE TABLE message_hidden (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- One reaction per user and message.
CREATE TABLE message_reactions (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

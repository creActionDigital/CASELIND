-- 0008_notifications: lot 3B push tokens, notification centre and preferences.
-- Forward-only. Never edit an applied migration: add a new one.

-- A push token belongs to the session that registered it: once the session is revoked or expired
-- the device receives nothing. Deleting the session removes its tokens.
CREATE TABLE push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  platform     text NOT NULL CONSTRAINT push_tokens_platform_check CHECK (platform IN ('ios', 'android', 'web')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id, last_seen_at DESC);
CREATE INDEX push_tokens_session_idx ON push_tokens (session_id);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   text NOT NULL
               CONSTRAINT notifications_category_check
               CHECK (category IN ('message', 'social', 'commerce', 'delivery', 'payment', 'booking', 'security', 'reminder', 'system')),
  title      text NOT NULL,
  body       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  user_id                 uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_disabled_categories text[] NOT NULL DEFAULT '{}',
  quiet_until             timestamptz,
  message_previews        boolean NOT NULL DEFAULT false,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- security alerts can never be switched off
  CONSTRAINT notification_preferences_security_check CHECK (NOT ('security' = ANY (push_disabled_categories)))
);

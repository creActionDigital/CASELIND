-- 0001_identity: users, sessions, refresh tokens, OTP challenges, append-only audit log.
-- Forward-only. Never edit an applied migration: add a new one.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('pending_verification', 'active', 'suspended', 'deleted');
CREATE TYPE otp_purpose AS ENUM ('signup', 'password_reset');
CREATE TYPE otp_channel AS ENUM ('sms', 'email');

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext UNIQUE,
  phone               text UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  password_hash       text NOT NULL,
  handle              citext NOT NULL UNIQUE CHECK (handle ~ '^[a-zA-Z0-9_.]{3,30}$'),
  display_name        text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  bio                 text CHECK (char_length(bio) <= 300),
  avatar_url          text,
  locale              text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en', 'sw')),
  country             char(2),
  status              user_status NOT NULL DEFAULT 'pending_verification',
  roles               text[] NOT NULL DEFAULT ARRAY['user']::text[]
                        CHECK (roles <@ ARRAY['user', 'moderator', 'support', 'admin']::text[]),
  email_verified_at   timestamptz,
  phone_verified_at   timestamptz,
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_identifier_required CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name    text,
  platform       text NOT NULL DEFAULT 'other',
  ip             text,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoke_reason  text
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- One row per issued refresh token. Tokens are single-use (rotation);
-- presenting an already-used token revokes the whole session (theft detection).
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id);

-- user_id is NULL for decoy challenges (identifier unknown or already taken):
-- they behave like real ones for the caller but can never be verified.
CREATE TABLE otp_challenges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  purpose          otp_purpose NOT NULL,
  channel          otp_channel NOT NULL,
  destination      text NOT NULL,
  code_hash        text NOT NULL,
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 5,
  resend_count     integer NOT NULL DEFAULT 0,
  last_sent_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_user_idx ON otp_challenges (user_id, purpose) WHERE consumed_at IS NULL;

CREATE TABLE audit_events (
  id               bigserial PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  action           text NOT NULL,
  actor_user_id    uuid,
  subject_user_id  uuid,
  session_id       uuid,
  ip               text,
  user_agent       text,
  request_id       text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_events_subject_idx ON audit_events (subject_user_id, occurred_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (action, occurred_at DESC);

-- The audit log is append-only: reject UPDATE and DELETE at the database level.
CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

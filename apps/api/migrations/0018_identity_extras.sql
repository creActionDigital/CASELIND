-- Lot 1c: TOTP two-factor authentication, identifier change, QR web login.

-- Identifier change reuses otp_challenges (destination = the NEW identifier).
ALTER TYPE otp_purpose ADD VALUE IF NOT EXISTS 'identifier_change';

-- One TOTP secret per user. secret_enc is AES-256-GCM; enabled_at NULL = enrolment not confirmed yet.
CREATE TABLE user_totp (
  user_id         uuid PRIMARY KEY REFERENCES users (id),
  secret_enc      text NOT NULL,
  enabled_at      timestamptz,
  -- Last accepted time step (RFC 6238 counter): a code is accepted once, never replayed.
  last_used_step  bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Single-use backup codes, stored as keyed hashes.
CREATE TABLE user_backup_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id),
  code_hash   text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_backup_codes_user_idx ON user_backup_codes (user_id);
CREATE UNIQUE INDEX user_backup_codes_hash_key ON user_backup_codes (user_id, code_hash);

-- Second step of a login: created after a correct password, 5 minutes, 5 attempts.
CREATE TABLE two_factor_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id),
  device_name   text,
  platform      text NOT NULL DEFAULT 'other',
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX two_factor_challenges_user_idx ON two_factor_challenges (user_id);

-- Web login by QR code. The QR carries only the id and a nonce; the polling secret never leaves the web client.
CREATE TABLE qr_login_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash    text NOT NULL UNIQUE,
  secret_hash   text NOT NULL,
  device_name   text,
  platform      text NOT NULL DEFAULT 'web',
  ip            text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'consumed')),
  approved_by   uuid REFERENCES users (id),
  approved_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qr_login_sessions_expires_idx ON qr_login_sessions (expires_at);

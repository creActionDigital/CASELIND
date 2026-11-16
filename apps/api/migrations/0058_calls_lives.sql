-- 0058_calls_lives: 1:1 calls (signalling only) and live rooms (chat, viewers, signalling). Forward-only.
-- The platform relays WebRTC signalling (offer/answer/ICE) over realtime and stores NO media and NO signalling payload.
-- Media needs a STUN/TURN server and a real device (question Q6): until then calls/lives are tested at the signalling level.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('calls', 'Appels audio et vidéo 1:1 depuis une conversation directe (signalisation WebRTC)', true, false),
  ('live', 'Lives : salons en direct avec chat, spectateurs et signalisation WebRTC', true, false);

CREATE TABLE calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('audio', 'video')),
  status          text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended', 'declined', 'missed', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  answered_at     timestamptz,
  ended_at        timestamptz,
  CONSTRAINT calls_not_self CHECK (caller_id <> callee_id)
);
CREATE INDEX calls_caller_idx ON calls (caller_id, created_at DESC);
CREATE INDEX calls_callee_idx ON calls (callee_id, created_at DESC);

CREATE TABLE lives (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  status       text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  peak_viewers integer NOT NULL DEFAULT 0,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);
-- One live at a time per host.
CREATE UNIQUE INDEX lives_one_active_per_host ON lives (host_id) WHERE status = 'live';
CREATE INDEX lives_active_idx ON lives (started_at DESC) WHERE status = 'live';

CREATE TABLE live_viewers (
  live_id   uuid NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at   timestamptz,
  PRIMARY KEY (live_id, user_id)
);

CREATE TABLE live_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_id    uuid NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_messages_live_idx ON live_messages (live_id, created_at DESC);

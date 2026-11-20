-- 0087_creator_boosts: publications sponsorisees (budget FICTIF du portefeuille de test, jamais d'argent reel) et index des pourboires. Forward-only.

CREATE TABLE post_boosts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL,
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz NOT NULL,
  budget_minor bigint NOT NULL CONSTRAINT post_boosts_budget_check CHECK (budget_minor > 0),
  currency     char(3) NOT NULL,
  status       text NOT NULL DEFAULT 'active' CONSTRAINT post_boosts_status_check CHECK (status IN ('active', 'ended', 'cancelled', 'rejected')),
  -- Ecriture du grand livre qui a debite le budget (sans cle etrangere : le grand livre est append-only).
  transfer_id  uuid,
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_boosts_window_check CHECK (ends_at > starts_at),
  CONSTRAINT post_boosts_client_unique UNIQUE (user_id, client_id)
);
-- Au plus un boost actif par publication.
CREATE UNIQUE INDEX post_boosts_one_active_idx ON post_boosts (post_id) WHERE status = 'active';
CREATE INDEX post_boosts_active_idx ON post_boosts (ends_at) WHERE status = 'active';
CREATE INDEX post_boosts_user_idx ON post_boosts (user_id, created_at DESC);

-- Pourboires (virement P2P du portefeuille de test, metadata.ref = 'tip') : total recu par createur.
CREATE INDEX journal_entries_tip_idx ON journal_entries ((metadata->>'creatorId'), created_at) WHERE metadata->>'ref' = 'tip';

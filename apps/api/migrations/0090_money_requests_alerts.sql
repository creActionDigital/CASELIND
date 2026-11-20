-- 0090_money_requests_alerts: demandes d'argent, paiements partages et alertes d'anomalie du portefeuille de test (argent FICTIF, jamais reel). Forward-only.

-- Un partage de facture : le createur propose des parts ; chaque part est une demande d'argent liee (money_requests.bill_id).
CREATE TABLE split_bills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL,
  title       text NOT NULL CONSTRAINT split_bills_title_check CHECK (length(title) BETWEEN 1 AND 80),
  total_minor bigint NOT NULL CONSTRAINT split_bills_total_check CHECK (total_minor > 0),
  -- Part gardee par le createur (total = parts des participants + part du createur).
  self_minor  bigint NOT NULL DEFAULT 0 CONSTRAINT split_bills_self_check CHECK (self_minor >= 0 AND self_minor <= total_minor),
  currency    char(3) NOT NULL CONSTRAINT split_bills_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  status      text NOT NULL DEFAULT 'open' CONSTRAINT split_bills_status_check CHECK (status IN ('open', 'settled', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT split_bills_client_unique UNIQUE (creator_id, client_id)
);
CREATE INDEX split_bills_creator_idx ON split_bills (creator_id, created_at DESC);

CREATE TABLE split_bill_shares (
  bill_id      uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_minor bigint NOT NULL CONSTRAINT split_bill_shares_amount_check CHECK (amount_minor > 0),
  status       text NOT NULL DEFAULT 'pending' CONSTRAINT split_bill_shares_status_check CHECK (status IN ('pending', 'paid', 'declined')),
  -- Ecriture du grand livre (sans cle etrangere : le grand livre est append-only).
  transfer_id  uuid,
  PRIMARY KEY (bill_id, user_id)
);
CREATE INDEX split_bill_shares_user_idx ON split_bill_shares (user_id);

CREATE TABLE money_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payer_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL,
  amount_minor     bigint NOT NULL CONSTRAINT money_requests_amount_check CHECK (amount_minor > 0),
  currency         char(3) NOT NULL CONSTRAINT money_requests_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  note             text CONSTRAINT money_requests_note_check CHECK (note IS NULL OR length(note) BETWEEN 1 AND 140),
  status           text NOT NULL DEFAULT 'pending' CONSTRAINT money_requests_status_check CHECK (status IN ('pending', 'paid', 'declined', 'cancelled', 'expired')),
  expires_at       timestamptz NOT NULL,
  paid_transfer_id uuid,
  bill_id          uuid REFERENCES split_bills(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  CONSTRAINT money_requests_distinct_check CHECK (requester_id <> payer_id),
  CONSTRAINT money_requests_client_unique UNIQUE (requester_id, client_id)
);
CREATE INDEX money_requests_requester_idx ON money_requests (requester_id, created_at DESC, id DESC);
CREATE INDEX money_requests_payer_idx ON money_requests (payer_id, created_at DESC, id DESC);
CREATE INDEX money_requests_pending_idx ON money_requests (expires_at) WHERE status = 'pending';
CREATE INDEX money_requests_bill_idx ON money_requests (bill_id) WHERE bill_id IS NOT NULL;

-- Alertes d'anomalie : information seulement, jamais de blocage automatique d'un virement.
CREATE TABLE wallet_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule        text NOT NULL CONSTRAINT wallet_alerts_rule_check CHECK (rule IN ('amount_outlier', 'burst', 'new_recipient_large', 'many_recipients')),
  severity    text NOT NULL CONSTRAINT wallet_alerts_severity_check CHECK (severity IN ('info', 'warn', 'high')),
  transfer_id uuid,
  status      text NOT NULL DEFAULT 'open' CONSTRAINT wallet_alerts_status_check CHECK (status IN ('open', 'reviewed', 'dismissed')),
  -- "Ce n'est pas moi" : signale a l'equipe (le gel d'un compte reste une decision d'administration).
  reported_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_alerts_transfer_rule_unique UNIQUE (transfer_id, rule)
);
CREATE INDEX wallet_alerts_user_idx ON wallet_alerts (user_id, created_at DESC, id DESC);
CREATE INDEX wallet_alerts_admin_idx ON wallet_alerts (created_at DESC, id DESC) WHERE status = 'open' OR reported_at IS NOT NULL;

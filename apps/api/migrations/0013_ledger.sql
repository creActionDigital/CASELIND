-- 0013_ledger: lot 6A double-entry ledger and SANDBOX wallet (CDC §17, §26, ADR-013, ADR-017).
-- No real money: every balance here is a sandbox balance; the regulated flag wallet.real_money stays off.
-- Forward-only. Never edit an applied migration: add a new one.

-- One account per (owner, currency). balance_minor is a cache maintained by the postings trigger below and
-- verifiable against SUM(postings) (GET /v1/admin/ledger/reconcile). It never goes negative except for accounts
-- flagged allow_negative (the system funding account).
CREATE TABLE ledger_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind     text NOT NULL CONSTRAINT ledger_accounts_owner_kind_check CHECK (owner_kind IN ('user', 'org', 'system')),
  user_id        uuid REFERENCES users(id),
  org_id         uuid REFERENCES organizations(id),
  system_code    text CONSTRAINT ledger_accounts_system_code_check CHECK (system_code IN ('sandbox_funding', 'fees')),
  currency       char(3) NOT NULL CONSTRAINT ledger_accounts_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  status         text NOT NULL DEFAULT 'active' CONSTRAINT ledger_accounts_status_check CHECK (status IN ('active', 'frozen')),
  balance_minor  bigint NOT NULL DEFAULT 0,
  allow_negative boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_owner_shape CHECK (
    (owner_kind = 'user'   AND user_id IS NOT NULL AND org_id IS NULL     AND system_code IS NULL) OR
    (owner_kind = 'org'    AND org_id IS NOT NULL  AND user_id IS NULL    AND system_code IS NULL) OR
    (owner_kind = 'system' AND system_code IS NOT NULL AND user_id IS NULL AND org_id IS NULL)),
  CONSTRAINT ledger_accounts_non_negative CHECK (allow_negative OR balance_minor >= 0),
  CONSTRAINT ledger_accounts_id_currency_unique UNIQUE (id, currency)
);
CREATE UNIQUE INDEX ledger_accounts_user_unique ON ledger_accounts (user_id, currency) WHERE owner_kind = 'user';
CREATE UNIQUE INDEX ledger_accounts_org_unique ON ledger_accounts (org_id, currency) WHERE owner_kind = 'org';
CREATE UNIQUE INDEX ledger_accounts_system_unique ON ledger_accounts (system_code, currency) WHERE owner_kind = 'system';

-- One journal entry per movement. amount/currency are the headline figures of the transfer (replay checks, display);
-- the truth is in postings.
CREATE TABLE journal_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CONSTRAINT journal_entries_kind_check CHECK (kind IN ('p2p', 'merchant_payment', 'sandbox_topup', 'refund', 'adjustment')),
  idempotency_key text NOT NULL CONSTRAINT journal_entries_key_check CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  initiated_by    uuid REFERENCES users(id),
  currency        char(3) NOT NULL,
  amount_minor    bigint NOT NULL CONSTRAINT journal_entries_amount_check CHECK (amount_minor > 0),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- Unique per initiator (system operations share the nil-uuid namespace).
CREATE UNIQUE INDEX journal_entries_idempotency_unique
  ON journal_entries (COALESCE(initiated_by, '00000000-0000-0000-0000-000000000000'::uuid), idempotency_key);
CREATE INDEX journal_entries_initiator_idx ON journal_entries (initiated_by, kind, created_at DESC);

CREATE TABLE postings (
  id           bigserial PRIMARY KEY,
  entry_id     uuid NOT NULL REFERENCES journal_entries(id),
  account_id   uuid NOT NULL,
  currency     char(3) NOT NULL,
  amount_minor bigint NOT NULL CONSTRAINT postings_amount_check CHECK (amount_minor <> 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- A posting is always in the currency of its account.
  CONSTRAINT postings_account_currency_fk FOREIGN KEY (account_id, currency) REFERENCES ledger_accounts(id, currency)
);
CREATE INDEX postings_account_idx ON postings (account_id, id DESC);
CREATE INDEX postings_entry_idx ON postings (entry_id);

-- Append-only: no UPDATE, DELETE or TRUNCATE on entries and postings (retention obligation).
CREATE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_no_update_delete BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER postings_no_update_delete BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER postings_no_truncate BEFORE TRUNCATE ON postings
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER ledger_accounts_no_delete BEFORE DELETE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- The cached balance follows the postings in the same statement (so it can only drift by tampering, which the
-- reconciliation detects). ledger_accounts_non_negative then refuses any overdraft.
CREATE FUNCTION postings_apply_balance() RETURNS trigger AS $$
BEGIN
  UPDATE ledger_accounts SET balance_minor = balance_minor + NEW.amount_minor WHERE id = NEW.account_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER postings_apply_balance AFTER INSERT ON postings
  FOR EACH ROW EXECUTE FUNCTION postings_apply_balance();

-- Double entry: at commit, the postings of an entry sum to zero in every currency, and an entry has postings.
CREATE FUNCTION journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  target uuid;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN target := NEW.id; ELSE target := NEW.entry_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM postings WHERE entry_id = target) THEN
    RAISE EXCEPTION 'journal entry % has no postings', target USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM postings WHERE entry_id = target GROUP BY currency HAVING SUM(amount_minor) <> 0) THEN
    RAISE EXCEPTION 'journal entry % is not balanced', target USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- System accounts per currency are created lazily by the ledger (they need the configured currencies).

-- Sandbox wallet flag: ON, not regulated (no real money). wallet.real_money (regulated) stays off and unused.
INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('wallet.sandbox', 'Portefeuille sandbox (fonds fictifs, aucun argent réel; ADR-013)', true, false)
ON CONFLICT (key) DO NOTHING;

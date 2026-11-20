-- 0091_scheduled_savings: paiements programmes et tirelires du portefeuille de test (argent FICTIF). Forward-only.

CREATE TABLE scheduled_payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id            uuid NOT NULL,
  amount_minor         bigint NOT NULL CONSTRAINT scheduled_payments_amount_check CHECK (amount_minor > 0),
  currency             char(3) NOT NULL CONSTRAINT scheduled_payments_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  note                 text CONSTRAINT scheduled_payments_note_check CHECK (note IS NULL OR length(note) BETWEEN 1 AND 100),
  frequency            text NOT NULL CONSTRAINT scheduled_payments_frequency_check CHECK (frequency IN ('once', 'weekly', 'monthly')),
  -- Premiere echeance : les suivantes en derivent (semaine, mois ramene au dernier jour du mois), sans derive.
  first_run_at         timestamptz NOT NULL,
  next_run_at          timestamptz NOT NULL,
  ends_on              date,
  max_runs             integer CONSTRAINT scheduled_payments_max_runs_check CHECK (max_runs IS NULL OR max_runs BETWEEN 1 AND 1000),
  runs_done            integer NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'active' CONSTRAINT scheduled_payments_status_check CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'failed')),
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_payments_distinct_check CHECK (owner_id <> recipient_id),
  CONSTRAINT scheduled_payments_client_unique UNIQUE (owner_id, client_id)
);
CREATE INDEX scheduled_payments_owner_idx ON scheduled_payments (owner_id, created_at DESC, id DESC);
CREATE INDEX scheduled_payments_due_idx ON scheduled_payments (next_run_at) WHERE status = 'active';

-- Historique des executions. Une execution reussie par (paiement, numero) : un double passage ne paie jamais deux fois
-- (en plus de la cle d'idempotence du grand livre).
CREATE TABLE scheduled_payment_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES scheduled_payments(id) ON DELETE CASCADE,
  run_number  integer NOT NULL,
  status      text NOT NULL CONSTRAINT scheduled_payment_runs_status_check CHECK (status IN ('ok', 'failed')),
  error_code  text,
  transfer_id uuid,
  ran_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scheduled_payment_runs_ok_unique ON scheduled_payment_runs (payment_id, run_number) WHERE status = 'ok';
CREATE INDEX scheduled_payment_runs_payment_idx ON scheduled_payment_runs (payment_id, ran_at DESC);

-- Tirelires : objectifs d'epargne. Le solde est calcule (somme des mouvements) ; les fonds vivent dans un compte systeme
-- par utilisateur et devise (system_code 'savings:<uuid>'), les versements sont des ecritures internes du grand livre.
CREATE TABLE savings_goals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            text NOT NULL CONSTRAINT savings_goals_title_check CHECK (length(title) BETWEEN 1 AND 60),
  target_minor     bigint NOT NULL CONSTRAINT savings_goals_target_check CHECK (target_minor > 0),
  currency         char(3) NOT NULL CONSTRAINT savings_goals_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  deadline         date,
  archived         boolean NOT NULL DEFAULT false,
  last_reminded_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX savings_goals_user_idx ON savings_goals (user_id, archived, created_at DESC);

CREATE TABLE savings_movements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id      uuid NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  kind         text NOT NULL CONSTRAINT savings_movements_kind_check CHECK (kind IN ('deposit', 'withdraw')),
  amount_minor bigint NOT NULL CONSTRAINT savings_movements_amount_check CHECK (amount_minor > 0),
  transfer_id  uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savings_movements_transfer_unique UNIQUE (transfer_id)
);
CREATE INDEX savings_movements_goal_idx ON savings_movements (goal_id, created_at DESC);

-- Comptes systeme des tirelires.
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_system_code_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_system_code_check
  CHECK (system_code IN ('sandbox_funding', 'fees') OR system_code ~ '^savings:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

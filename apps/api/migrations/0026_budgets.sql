-- Personal finance (sandbox): one monthly spending limit per user and currency. Spending itself is read from the ledger.
CREATE TABLE budgets (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency     char(3) NOT NULL CONSTRAINT budgets_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  limit_minor  bigint NOT NULL CONSTRAINT budgets_limit_check CHECK (limit_minor > 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, currency)
);

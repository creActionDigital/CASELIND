-- 0057_school_fees: lot 17h school fee statements (CDC §13 "paiements de frais scolaires"). Forward-only.
-- A RECORD only: no payment is taken or moved by the platform (real payments wait for FlexPay, question Q5). The school states a fee
-- for a class and marks, per enrolled student, whether it was paid outside the platform. Under the regulated `school` flag.

CREATE TABLE school_fees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  title        text NOT NULL CONSTRAINT school_fees_title_check CHECK (length(title) BETWEEN 1 AND 80),
  amount_minor bigint NOT NULL CONSTRAINT school_fees_amount_check CHECK (amount_minor > 0 AND amount_minor <= 1000000000000),
  currency     char(3) NOT NULL CONSTRAINT school_fees_currency_check CHECK (currency IN ('USD', 'CDF')),
  due_on       date,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX school_fees_class_idx ON school_fees (class_id, created_at DESC);

-- Only paid rows are stored: a student without a row owes the fee.
CREATE TABLE school_fee_payments (
  fee_id    uuid NOT NULL REFERENCES school_fees(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fee_id, user_id)
);

-- 0059_pos_sales: lot 16c caisse (ventes au comptoir enregistrees par le vendeur, sans traitement de paiement). Forward-only.
CREATE TABLE pos_sales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL,
  cashier_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  currency        char(3) NOT NULL CONSTRAINT pos_sales_currency_check CHECK (currency IN ('USD', 'CDF')),
  total_minor     bigint NOT NULL CONSTRAINT pos_sales_total_check CHECK (total_minor > 0),
  payment_method  text NOT NULL CONSTRAINT pos_sales_method_check CHECK (payment_method IN ('cash', 'mobile_money', 'card')),
  lines           jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_sales_client_unique UNIQUE (org_id, client_id)
);
CREATE INDEX pos_sales_org_idx ON pos_sales (org_id, created_at DESC, id DESC);

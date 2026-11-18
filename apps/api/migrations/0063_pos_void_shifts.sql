-- 0063_pos_void_shifts: caisse. Annulation de vente (stock remis, mouvement 'pos_void'), sessions de caisse (fond de caisse), fuseau horaire de la boutique. Forward-only.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('initial', 'restock', 'adjustment', 'damage', 'order_reserved', 'order_released', 'pos_sale', 'pos_void'));

ALTER TABLE organizations ADD COLUMN timezone text NOT NULL DEFAULT 'Africa/Lubumbashi';

CREATE TABLE pos_shifts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opened_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  currency            char(3) NOT NULL CONSTRAINT pos_shifts_currency_check CHECK (currency IN ('USD', 'CDF')),
  opening_float_minor bigint NOT NULL CONSTRAINT pos_shifts_float_check CHECK (opening_float_minor >= 0),
  opened_at           timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  closed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  counted_cash_minor  bigint CONSTRAINT pos_shifts_counted_check CHECK (counted_cash_minor >= 0)
);
-- At most one open session per shop.
CREATE UNIQUE INDEX pos_shifts_one_open ON pos_shifts (org_id) WHERE closed_at IS NULL;

ALTER TABLE pos_sales
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN void_reason text CONSTRAINT pos_sales_void_reason_check CHECK (char_length(void_reason) <= 200),
  ADD COLUMN shift_id uuid REFERENCES pos_shifts(id) ON DELETE SET NULL;
CREATE INDEX pos_sales_shift_idx ON pos_sales (shift_id) WHERE shift_id IS NOT NULL;

-- 0076_product_promotions: promotions on products (percent or fixed price), flash sales. Forward-only.
-- A row targets a whole product (variant_id NULL) or one variant. The effective price is computed by the server
-- at display time and frozen in the order by the catalogue port; only one promotion may run at a time per variant
-- (checked in a transaction under a per-product advisory lock, see PromotionsService).
CREATE TABLE product_promotions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id  uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  kind        text NOT NULL CONSTRAINT product_promotions_kind_check CHECK (kind IN ('percent', 'fixed_price')),
  -- percent: 1-90; fixed_price: the new price in minor units.
  value       bigint NOT NULL CONSTRAINT product_promotions_value_check CHECK (value > 0),
  label       text NOT NULL CONSTRAINT product_promotions_label_check CHECK (char_length(label) BETWEEN 1 AND 40),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  stock_cap   integer CONSTRAINT product_promotions_cap_check CHECK (stock_cap IS NULL OR stock_cap BETWEEN 1 AND 1000000),
  sold_count  integer NOT NULL DEFAULT 0 CONSTRAINT product_promotions_sold_check CHECK (sold_count >= 0),
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_promotions_percent_check CHECK (kind <> 'percent' OR value BETWEEN 1 AND 90),
  CONSTRAINT product_promotions_window_check CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '30 days')
);
CREATE INDEX product_promotions_product_idx ON product_promotions (product_id) WHERE active;
CREATE INDEX product_promotions_org_idx ON product_promotions (org_id, created_at DESC, id DESC);
CREATE INDEX product_promotions_ends_idx ON product_promotions (ends_at) WHERE active;

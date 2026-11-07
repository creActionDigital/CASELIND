-- 0012_orders: lot 5B cart, split orders, coupons, verified reviews.
-- Forward-only. Never edit an applied migration: add a new one.
-- No payment is integrated yet (BACKLOG Q5): the only payment method is cash_on_delivery.

-- Reviews become a moderation target (0011 added 'product').
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review'));

-- One cart per user (the rows), multi-vendor. No stock is reserved. variant_id is not a foreign key:
-- the catalogue owns its tables and a variant that disappears is reported as unavailable.
CREATE TABLE cart_items (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL,
  quantity   integer NOT NULL CONSTRAINT cart_items_quantity_check CHECK (quantity BETWEEN 1 AND 99),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, variant_id)
);

-- Coupons belong to an organisation. `code` is stored upper-cased (case-insensitive, unique per org).
CREATE TABLE coupons (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  code                  text NOT NULL CONSTRAINT coupons_code_check CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  kind                  text NOT NULL CONSTRAINT coupons_kind_check CHECK (kind IN ('percent', 'fixed')),
  value                 bigint NOT NULL CONSTRAINT coupons_value_check CHECK (value > 0),
  currency              char(3),
  min_order_minor       bigint NOT NULL DEFAULT 0 CONSTRAINT coupons_min_check CHECK (min_order_minor >= 0),
  starts_at             timestamptz,
  ends_at               timestamptz,
  max_uses              integer CONSTRAINT coupons_max_uses_check CHECK (max_uses IS NULL OR max_uses > 0),
  max_uses_per_user     integer CONSTRAINT coupons_max_per_user_check CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0),
  uses_count            integer NOT NULL DEFAULT 0 CONSTRAINT coupons_uses_check CHECK (uses_count >= 0),
  active                boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupons_org_code_unique UNIQUE (org_id, code),
  CONSTRAINT coupons_percent_check CHECK (kind <> 'percent' OR (value BETWEEN 1 AND 90 AND currency IS NULL)),
  CONSTRAINT coupons_fixed_check CHECK (kind <> 'fixed' OR currency IS NOT NULL)
);
CREATE INDEX coupons_org_idx ON coupons (org_id, created_at DESC, id DESC);

-- One order per (organisation, currency) of a checkout. Orders outlive their buyer account
-- (seller accounting): the purge only anonymises the address.
CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                text NOT NULL CONSTRAINT orders_number_unique UNIQUE,
  buyer_id              uuid NOT NULL REFERENCES users(id),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  client_id             uuid NOT NULL,
  currency              char(3) NOT NULL,
  status                text NOT NULL DEFAULT 'pending'
                          CONSTRAINT orders_status_check
                          CHECK (status IN ('pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled')),
  subtotal_minor        bigint NOT NULL CONSTRAINT orders_subtotal_check CHECK (subtotal_minor >= 0),
  discount_minor        bigint NOT NULL DEFAULT 0 CONSTRAINT orders_discount_check CHECK (discount_minor >= 0),
  total_minor           bigint NOT NULL CONSTRAINT orders_total_check CHECK (total_minor >= 0),
  coupon_id             uuid REFERENCES coupons(id),
  coupon_code           text,
  payment_method        text NOT NULL CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('cash_on_delivery')),
  address               jsonb,
  address_anonymized_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_checkout_unique UNIQUE (buyer_id, client_id, org_id, currency)
);
CREATE INDEX orders_buyer_idx ON orders (buyer_id, created_at DESC, id DESC);
CREATE INDEX orders_org_idx ON orders (org_id, created_at DESC, id DESC);
CREATE INDEX orders_org_status_idx ON orders (org_id, status, created_at DESC, id DESC);
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Frozen copies: later catalogue edits never change an order.
CREATE TABLE order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id       uuid NOT NULL,
  product_id       uuid NOT NULL,
  title            text NOT NULL,
  variant_label    text,
  sku              text,
  unit_price_minor bigint NOT NULL CONSTRAINT order_items_price_check CHECK (unit_price_minor >= 0),
  quantity         integer NOT NULL CONSTRAINT order_items_quantity_check CHECK (quantity BETWEEN 1 AND 99),
  line_total_minor bigint NOT NULL,
  image_asset_id   uuid
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
-- "Did this user receive this product" (verified reviews).
CREATE INDEX order_items_product_idx ON order_items (product_id);

-- Append-only history of an order: who moved it where, and when.
CREATE TABLE order_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status   text,
  status        text NOT NULL,
  actor_kind    text NOT NULL CONSTRAINT order_events_actor_check CHECK (actor_kind IN ('buyer', 'org', 'system')),
  actor_user_id uuid,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, created_at, id);
CREATE FUNCTION order_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER order_events_no_update
  BEFORE UPDATE ON order_events
  FOR EACH ROW EXECUTE FUNCTION order_events_append_only();
-- Deletes are rejected too, except when the parent order is gone (ON DELETE CASCADE).
CREATE FUNCTION order_events_no_direct_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM orders WHERE id = OLD.order_id) THEN
    RAISE EXCEPTION 'order_events is append-only';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER order_events_no_delete
  BEFORE DELETE ON order_events
  FOR EACH ROW EXECUTE FUNCTION order_events_no_direct_delete();

-- A coupon use. Released (not deleted) when the order is cancelled; counts only while released_at IS NULL.
CREATE TABLE coupon_redemptions (
  order_id    uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  coupon_id   uuid NOT NULL REFERENCES coupons(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  released_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coupon_redemptions_user_idx ON coupon_redemptions (coupon_id, user_id) WHERE released_at IS NULL;

-- Verified reviews: one per (user, product), only after a delivered order line.
CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL,
  org_id      uuid NOT NULL REFERENCES organizations(id),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  body        text CONSTRAINT reviews_body_check CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000),
  -- Hidden by moderation (reversible).
  hidden      boolean NOT NULL DEFAULT false,
  reply_body  text CONSTRAINT reviews_reply_check CHECK (reply_body IS NULL OR char_length(reply_body) BETWEEN 1 AND 2000),
  reply_by    uuid REFERENCES users(id),
  replied_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_product_user_unique UNIQUE (product_id, user_id)
);
CREATE INDEX reviews_product_idx ON reviews (product_id, created_at DESC, id DESC);
CREATE INDEX reviews_user_idx ON reviews (user_id);

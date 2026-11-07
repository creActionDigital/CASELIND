-- 0011_catalog: lot 5A categories, products, variants, stock and stock movements.
-- Forward-only. Never edit an applied migration: add a new one.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('commerce', 'Commerce : catalogue, stock, vitrine, panier et commandes', true, false);

-- Reports may now target a product.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product'));

-- Platform categories (simple tree; parent_id is for later sub-categories).
CREATE TABLE product_categories (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug      text NOT NULL UNIQUE CONSTRAINT product_categories_slug_check CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name      text NOT NULL,
  parent_id uuid REFERENCES product_categories(id) ON DELETE RESTRICT,
  position  integer NOT NULL DEFAULT 0
);
INSERT INTO product_categories (slug, name, position) VALUES
  ('alimentation', 'Alimentation', 1),
  ('mode', 'Mode', 2),
  ('beaute', 'Beauté', 3),
  ('electronique', 'Électronique', 4),
  ('maison', 'Maison', 5),
  ('sante', 'Santé', 6),
  ('bebe', 'Bébé', 7),
  ('sport', 'Sport', 8),
  ('auto-moto', 'Auto-moto', 9),
  ('services', 'Services', 10);

CREATE TABLE products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Member who created it. No FK: the product belongs to the org, not to the account.
  created_by  uuid,
  category_id uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  title       text NOT NULL CONSTRAINT products_title_check CHECK (char_length(title) BETWEEN 1 AND 140),
  description text CONSTRAINT products_description_check CHECK (description IS NULL OR char_length(description) <= 5000),
  status      text NOT NULL DEFAULT 'draft' CONSTRAINT products_status_check CHECK (status IN ('draft', 'published', 'archived')),
  -- Set by moderation: invisible to buyers.
  hidden      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_org_idx ON products (org_id, created_at DESC, id DESC);
CREATE INDEX products_public_idx ON products (created_at DESC, id DESC) WHERE status = 'published' AND NOT hidden;
CREATE INDEX products_category_idx ON products (category_id) WHERE status = 'published' AND NOT hidden;

-- Product media: an image belongs to one position of one product. Deleting the media removes the link.
CREATE TABLE product_media (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id   uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position   integer NOT NULL,
  PRIMARY KEY (product_id, media_id),
  CONSTRAINT product_media_position_check CHECK (position >= 0)
);

CREATE TABLE product_variants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku         text NOT NULL CONSTRAINT product_variants_sku_check CHECK (char_length(sku) BETWEEN 1 AND 64),
  options     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Minor units (cents, centimes): integer, never a float.
  price_minor bigint NOT NULL CONSTRAINT product_variants_price_check CHECK (price_minor > 0),
  currency    text NOT NULL CONSTRAINT product_variants_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  stock       integer NOT NULL DEFAULT 0 CONSTRAINT product_variants_stock_check CHECK (stock >= 0),
  track_stock boolean NOT NULL DEFAULT true,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_org_sku_unique UNIQUE (org_id, sku)
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id);
CREATE INDEX product_variants_price_idx ON product_variants (currency, price_minor) WHERE active;

-- Append-only stock journal (no FK to users: rows must survive account purges untouched).
CREATE TABLE stock_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  org_id        uuid NOT NULL,
  delta         integer NOT NULL CONSTRAINT stock_movements_delta_check CHECK (delta <> 0),
  stock_after   integer NOT NULL CONSTRAINT stock_movements_after_check CHECK (stock_after >= 0),
  reason        text NOT NULL CONSTRAINT stock_movements_reason_check
                  CHECK (reason IN ('initial', 'restock', 'adjustment', 'damage', 'order_reserved', 'order_released')),
  actor_user_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_variant_idx ON stock_movements (variant_id, created_at DESC, id DESC);

CREATE FUNCTION stock_movements_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stock_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_append_only();

-- Search: trigram index when pg_trgm is available, plain btree on lower(title) otherwise
-- (prefix lookups only; ILIKE '%q%' then scans the published subset).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXECUTE 'CREATE INDEX products_title_trgm_idx ON products USING gin (title gin_trgm_ops)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable (%), using a btree index on lower(title)', SQLERRM;
  CREATE INDEX products_title_lower_idx ON products (lower(title));
END $$;

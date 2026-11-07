-- 0015_commerce_gaps: lot 5b. Support contact of an organisation, coupon currency, reviews by organisation.
-- Forward-only. Never edit an applied migration: add a new one.

-- Member buyers are pointed to for support. NULL = the oldest active owner (resolved at read time, so it
-- survives the member leaving). Not a hard dependency: the user row is only referenced.
ALTER TABLE organizations ADD COLUMN support_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Coupons: a percentage coupon may now carry a currency, and a minimum order amount needs one.
-- Compatibility: coupons created before this migration have no currency on percentages; their minimum
-- cannot be tied to a currency, so it is cleared (NULL currency = no minimum, applies to any currency).
ALTER TABLE coupons DROP CONSTRAINT coupons_percent_check;
UPDATE coupons SET min_order_minor = 0 WHERE currency IS NULL AND min_order_minor > 0;
ALTER TABLE coupons ADD CONSTRAINT coupons_percent_check CHECK (kind <> 'percent' OR value BETWEEN 1 AND 90);
ALTER TABLE coupons ADD CONSTRAINT coupons_min_currency_check CHECK (min_order_minor = 0 OR currency IS NOT NULL);

-- GET /orgs/:orgId/reviews, newest first.
CREATE INDEX reviews_org_idx ON reviews (org_id, created_at DESC, id DESC);

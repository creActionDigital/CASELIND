import { sql, type SQL } from 'drizzle-orm';

/**
 * Effective price of variant `v` under promotion `p` (alias of a promotion row or of the lateral below).
 * percent: the discount is rounded down (the buyer pays the rounded-up price); fixed_price: never above the base price.
 */
export const effectivePriceSql = (p: string): SQL => {
  const a = sql.raw(p);
  return sql`(CASE WHEN ${a}.kind = 'percent' THEN GREATEST(1, v.price_minor - (v.price_minor * ${a}.value) / 100)
                   WHEN ${a}.kind = 'fixed_price' THEN LEAST(v.price_minor, ${a}.value)
                   ELSE v.price_minor END)`;
};

/** Promotion in force for the variant `v` right now (units left under the cap, price really lowered). */
const inForce: SQL = sql`pr.active AND pr.starts_at <= now() AND pr.ends_at > now() AND (pr.stock_cap IS NULL OR pr.sold_count < pr.stock_cap)`;

/**
 * `LEFT JOIN LATERAL` giving the promotion `promo` (id, kind, value, label, ends_at, stock_cap, sold_count) that applies to
 * the variant `v`: a promotion of the variant wins over one of the whole product (overlap is refused at creation, so this
 * only breaks ties). Expired, stopped, exhausted or non-lowering promotions never match.
 */
export const PROMO_JOIN: SQL = sql`LEFT JOIN LATERAL (
    SELECT pr.id, pr.kind, pr.value, pr.label, pr.ends_at, pr.stock_cap, pr.sold_count
    FROM product_promotions pr
    WHERE pr.product_id = v.product_id AND (pr.variant_id IS NULL OR pr.variant_id = v.id)
      AND ${inForce} AND ${effectivePriceSql('pr')} < v.price_minor
    ORDER BY (pr.variant_id IS NOT NULL) DESC, pr.created_at DESC, pr.id LIMIT 1
  ) promo ON true`;

/** Product `p` has at least one flash promotion (running, at most FLASH_MAX_HOURS long). */
export const hasFlashSql = (hours: number): SQL => sql`EXISTS (
  SELECT 1 FROM product_variants v JOIN product_promotions pr ON pr.product_id = v.product_id AND (pr.variant_id IS NULL OR pr.variant_id = v.id)
  WHERE v.product_id = p.id AND v.active AND ${inForce} AND pr.ends_at - pr.starts_at <= make_interval(hours => ${hours})
    AND ${effectivePriceSql('pr')} < v.price_minor)`;

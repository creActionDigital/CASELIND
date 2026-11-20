import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import {
  CatalogPort,
  type DbExecutor,
  type PricedLine,
  type ReleaseOptions,
  type ReserveLine,
  type ReserveOptions,
  type ReserveResult,
} from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { effectivePriceSql, PROMO_JOIN } from '../promotions/promotion-sql.js';
import { buyerVisibleSql, UUID_RE, variantLabelOf } from './catalog.shared.js';

interface VariantRow {
  id: string;
  product_id: string;
  org_id: string;
  sku: string;
  options: Record<string, string>;
  price_minor: string | number;
  currency: string;
  stock: number;
  track_stock: boolean;
  available: boolean;
  title: string;
  cover: string | null;
  /** Promotion in force for this variant (null when none): its price and units left. */
  promo_id: string | null;
  promo_price: string | number | null;
  promo_cap: number | null;
  promo_sold: number | null;
}

/** Merges duplicate variants (quantities add up) and drops invalid lines' ids into `bad`. */
function merge(lines: ReserveLine[]): { merged: Map<string, number>; bad: string[] } {
  const merged = new Map<string, number>();
  const bad: string[] = [];
  for (const l of lines) {
    if (!UUID_RE.test(l.variantId) || !Number.isInteger(l.quantity) || l.quantity < 1) {
      bad.push(l.variantId);
      continue;
    }
    merged.set(l.variantId.toLowerCase(), (merged.get(l.variantId.toLowerCase()) ?? 0) + l.quantity);
  }
  return { merged, bad };
}

const idList = (ids: string[]): SQL => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

/** Same buyer visibility as the storefront (published, not hidden, active public org, seller not blocked). */
const selectVariants = (viewerId?: string): SQL => sql`
  SELECT v.id, v.product_id, v.org_id, v.sku, v.options, v.price_minor, v.currency, v.stock, v.track_stock,
         (v.active AND ${buyerVisibleSql(viewerId ?? null)}) AS available,
         p.title,
         (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS cover,
         promo.id AS promo_id, ${effectivePriceSql('promo')} AS promo_price, promo.stock_cap AS promo_cap, promo.sold_count AS promo_sold
  FROM product_variants v
  JOIN products p ON p.id = v.product_id
  JOIN organizations o ON o.id = p.org_id
  ${PROMO_JOIN}`;

/**
 * The promotion applies to a line when it is in force and the units left under its cap cover the whole line
 * (otherwise the base price: never an error). Frozen by `reserve`; `price` only displays it.
 */
const promoApplies = (r: VariantRow, quantity: number): boolean =>
  r.promo_id !== null && (r.promo_cap === null || (r.promo_sold ?? 0) + quantity <= r.promo_cap);

function toLine(r: VariantRow, quantity: number, promo = promoApplies(r, quantity)): PricedLine {
  const base = Number(r.price_minor);
  const unit = promo && r.promo_price !== null ? Number(r.promo_price) : base;
  return {
    variantId: r.id,
    productId: r.product_id,
    orgId: r.org_id,
    title: r.title,
    variantLabel: variantLabelOf(r.options),
    sku: r.sku,
    unitPriceMinor: unit,
    compareAtPriceMinor: unit < base ? base : null,
    currency: r.currency,
    quantity,
    imageAssetId: r.cover,
  };
}

/** Catalogue implementation of the port used by cart, orders and reviews (lot 5B). */
@Injectable()
export class CatalogPortImpl extends CatalogPort {
  constructor(@Inject(DB) private readonly db: Db) {
    super();
  }

  override async price(lines: ReserveLine[], viewerId?: string): Promise<PricedLine[]> {
    const { merged } = merge(lines);
    if (merged.size === 0) return [];
    const res = await this.db.execute(sql`${selectVariants(viewerId)} WHERE v.id IN (${idList([...merged.keys()])})`);
    const byId = new Map((res.rows as unknown as VariantRow[]).map((r) => [r.id, r]));
    const out: PricedLine[] = [];
    for (const [id, quantity] of merged) {
      const r = byId.get(id);
      if (r?.available) out.push(toLine(r, quantity));
    }
    return out;
  }

  override async reserve(tx: DbExecutor, lines: ReserveLine[], buyerId?: string, opts: ReserveOptions = {}): Promise<ReserveResult> {
    const { merged, bad } = merge(lines);
    if (bad.length > 0) return { ok: false, reason: 'unavailable', variantIds: bad };
    if (merged.size === 0) return { ok: true, lines: [] };
    const ids = [...merged.keys()].sort();
    // Row locks in id order: two concurrent reservations can never deadlock on each other.
    const res = await tx.execute(sql`${selectVariants(buyerId)} WHERE v.id IN (${idList(ids)})${opts.orgId ? sql` AND v.org_id = ${opts.orgId}::uuid` : sql``} ORDER BY v.id FOR UPDATE OF v`);
    const rows = res.rows as unknown as VariantRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));

    const unavailable = ids.filter((id) => !byId.get(id)?.available);
    if (unavailable.length > 0) return { ok: false, reason: 'unavailable', variantIds: unavailable };
    const short = ids.filter((id) => {
      const r = byId.get(id)!;
      return r.track_stock && r.stock < merged.get(id)!;
    });
    if (short.length > 0) return { ok: false, reason: 'insufficient_stock', variantIds: short };

    for (const id of ids) {
      const r = byId.get(id)!;
      if (!r.track_stock) continue;
      const qty = merged.get(id)!;
      await tx.execute(sql`UPDATE product_variants SET stock = stock - ${qty} WHERE id = ${id}::uuid`);
      await tx.execute(sql`
        INSERT INTO stock_movements (variant_id, org_id, delta, stock_after, reason)
        VALUES (${id}::uuid, ${r.org_id}::uuid, ${-qty}, ${r.stock - qty}, ${opts.reason ?? 'order_reserved'})`);
    }
    // Promotions: the units are counted atomically (conditional UPDATE, promotion rows in id order so two checkouts never
    // deadlock); a promotion that stopped, ran out or expired between the read and now falls back to the base price.
    const candidates = ids
      .filter((id) => promoApplies(byId.get(id)!, merged.get(id)!))
      .map((id) => ({ id, promoId: byId.get(id)!.promo_id!, qty: merged.get(id)! }))
      .sort((a, b) => (a.promoId < b.promoId ? -1 : a.promoId > b.promoId ? 1 : a.id < b.id ? -1 : 1));
    const counted = new Set<string>();
    for (const c of candidates) {
      const upd = await tx.execute(sql`
        UPDATE product_promotions SET sold_count = sold_count + ${c.qty}
        WHERE id = ${c.promoId}::uuid AND active AND starts_at <= now() AND ends_at > now() AND (stock_cap IS NULL OR sold_count + ${c.qty} <= stock_cap)
        RETURNING id`);
      if (upd.rows.length > 0) counted.add(c.id);
    }
    // The promotion and units counted are returned so the order item keeps them: a cancellation or a restocked return gives them back.
    return {
      ok: true,
      lines: ids.map((id) => {
        const r = byId.get(id)!;
        const line = toLine(r, merged.get(id)!, counted.has(id));
        return counted.has(id) ? { ...line, promotionId: r.promo_id, promoUnits: line.quantity } : line;
      }),
    };
  }

  override async release(tx: DbExecutor, lines: ReserveLine[], opts: ReleaseOptions = {}): Promise<void> {
    const { merged } = merge(lines);
    if (merged.size === 0) return;
    // Promotion rows in id order (same order as reserve): no deadlock between a cancellation and a checkout.
    const byPromo = new Map<string, number>();
    for (const p of opts.promos ?? []) if (p.units > 0) byPromo.set(p.promotionId, (byPromo.get(p.promotionId) ?? 0) + p.units);
    for (const [promotionId, units] of [...byPromo].sort(([a], [b]) => (a < b ? -1 : 1))) {
      await tx.execute(sql`UPDATE product_promotions SET sold_count = GREATEST(sold_count - ${units}, 0) WHERE id = ${promotionId}::uuid`);
    }
    const ids = [...merged.keys()].sort();
    const res = await tx.execute(
      sql`SELECT id, org_id, stock, track_stock FROM product_variants WHERE id IN (${idList(ids)}) ORDER BY id FOR UPDATE`,
    );
    for (const r of res.rows as unknown as { id: string; org_id: string; stock: number; track_stock: boolean }[]) {
      if (!r.track_stock) continue;
      const qty = merged.get(r.id)!;
      await tx.execute(sql`UPDATE product_variants SET stock = stock + ${qty} WHERE id = ${r.id}::uuid`);
      await tx.execute(sql`
        INSERT INTO stock_movements (variant_id, org_id, delta, stock_after, reason)
        VALUES (${r.id}::uuid, ${r.org_id}::uuid, ${qty}, ${r.stock + qty}, ${opts.reason ?? 'order_released'})`);
    }
  }

  override async productExists(productId: string, viewerId?: string): Promise<boolean> {
    if (!UUID_RE.test(productId)) return false;
    const res = await this.db.execute(sql`
      SELECT 1 FROM products p JOIN organizations o ON o.id = p.org_id
      WHERE p.id = ${productId}::uuid AND ${buyerVisibleSql(viewerId ?? null)} LIMIT 1`);
    return res.rows.length > 0;
  }
}

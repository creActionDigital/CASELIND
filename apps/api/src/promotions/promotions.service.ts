import { Inject, Injectable } from '@nestjs/common';
import {
  type CreatePromotionRequest,
  type Promotion,
  type PromotionList,
  type PromotionListQuery,
  PROMOTION_MAX_DAYS,
  type UpdatePromotionRequest,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor, UUID_RE, validationError } from '../catalog/catalog.shared.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';

type Row = {
  id: string;
  org_id: string;
  product_id: string;
  product_title: string;
  variant_id: string | null;
  kind: 'percent' | 'fixed_price';
  value: string | number;
  currency: string;
  label: string;
  starts_at: Date;
  ends_at: Date;
  stock_cap: number | null;
  sold_count: number;
  active: boolean;
  status: Promotion['status'];
  created_at: Date;
};

const COLUMNS = sql`pr.id, pr.org_id, pr.product_id, p.title AS product_title, pr.variant_id, pr.kind, pr.value,
  COALESCE((SELECT v.currency FROM product_variants v WHERE v.product_id = pr.product_id ORDER BY (v.id = pr.variant_id) DESC, v.created_at LIMIT 1), 'USD') AS currency,
  pr.label, pr.starts_at, pr.ends_at,
  pr.stock_cap, pr.sold_count, pr.active, pr.created_at,
  CASE WHEN NOT pr.active THEN 'stopped' WHEN pr.ends_at <= now() THEN 'ended' WHEN pr.starts_at > now() THEN 'scheduled'
       WHEN pr.stock_cap IS NOT NULL AND pr.sold_count >= pr.stock_cap THEN 'exhausted' ELSE 'active' END AS status`;

const iso = (d: Date): string => new Date(d).toISOString();
const toPromotion = (r: Row): Promotion => ({
  id: r.id,
  orgId: r.org_id,
  productId: r.product_id,
  productTitle: r.product_title,
  variantId: r.variant_id,
  kind: r.kind,
  value: Number(r.value),
  currency: r.currency,
  label: r.label,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  stockCap: r.stock_cap,
  soldCount: r.sold_count,
  active: r.active,
  status: r.status,
  createdAt: iso(r.created_at),
});

const notFound = () => AppError.notFound('Promotion not found');

/**
 * Promotions of a seller. The price a buyer pays is never taken from here directly: the catalogue port reads the promotion
 * in force and fixes the price at reserve time. Audit holds ids, kind and value only, never the label.
 */
@Injectable()
export class PromotionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, q: PromotionListQuery): Promise<PromotionList> {
    const filters: SQL[] = [sql`pr.org_id = ${orgId}::uuid`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor, 'time');
      filters.push(sql`(pr.created_at, pr.id) < (${c.key}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<Row & { ts: string }>(sql`
      SELECT * FROM (
        SELECT ${COLUMNS}, pr.created_at::text AS ts FROM product_promotions pr JOIN products p ON p.id = pr.product_id
        WHERE ${sql.join(filters, sql` AND `)}
      ) x ${q.status ? sql`WHERE x.status = ${q.status}` : sql``}
      ORDER BY x.created_at DESC, x.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return { items: rows.map(toPromotion), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  private async one(id: string): Promise<Promotion> {
    const res = await this.db.execute<Row>(sql`SELECT ${COLUMNS} FROM product_promotions pr JOIN products p ON p.id = pr.product_id WHERE pr.id = ${id}::uuid`);
    return toPromotion(res.rows[0]!);
  }

  /** One promotion at a time per variant: a whole-product promotion overlaps every variant of the product. */
  private async assertNoOverlap(tx: Pick<Db, 'execute'>, productId: string, variantId: string | null, start: string, end: string, exceptId?: string): Promise<void> {
    const res = await tx.execute(sql`
      SELECT 1 FROM product_promotions
      WHERE product_id = ${productId}::uuid AND active AND ends_at > ${start}::timestamptz AND starts_at < ${end}::timestamptz
        AND (variant_id IS NULL OR ${variantId}::uuid IS NULL OR variant_id = ${variantId}::uuid)
        ${exceptId ? sql`AND id <> ${exceptId}::uuid` : sql``} LIMIT 1`);
    if (res.rows.length > 0) throw AppError.conflict('Another promotion already covers this period', { reason: 'promotion_overlap' });
  }

  async create(orgId: string, userId: string, b: CreatePromotionRequest, meta: RequestMeta): Promise<Promotion> {
    const startsAt = b.startsAt ?? new Date().toISOString();
    const id = await this.db.transaction(async (tx) => {
      // Serialises the overlap check of concurrent creations on one product.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`promo:${b.productId}`}, 0))`);
      const prod = (await tx.execute<{ status: string }>(sql`SELECT status FROM products WHERE id = ${b.productId}::uuid AND org_id = ${orgId}::uuid`)).rows[0];
      if (!prod || prod.status === 'archived') throw AppError.notFound('Product not found');
      const prices = await tx.execute<{ min: string | number | null }>(sql`
        SELECT min(price_minor) AS min FROM product_variants
        WHERE product_id = ${b.productId}::uuid AND active ${b.variantId ? sql`AND id = ${b.variantId}::uuid` : sql``}`);
      const min = prices.rows[0]?.min;
      if (min === null || min === undefined) throw b.variantId ? AppError.notFound('Variant not found') : validationError('productId', 'the product has no active variant');
      if (b.kind === 'fixed_price' && b.value >= Number(min)) throw validationError('value', 'must be below the current price');
      await this.assertNoOverlap(tx, b.productId, b.variantId ?? null, startsAt, b.endsAt);
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO product_promotions (org_id, product_id, variant_id, kind, value, label, starts_at, ends_at, stock_cap, created_by)
        VALUES (${orgId}::uuid, ${b.productId}::uuid, ${b.variantId ?? null}::uuid, ${b.kind}, ${b.value}, ${b.label}, ${startsAt}::timestamptz,
                ${b.endsAt}::timestamptz, ${b.stockCap ?? null}, ${userId}::uuid) RETURNING id`);
      const newId = r.rows[0]!.id;
      await this.audit.record(
        { action: 'commerce.promotion_created', actorUserId: userId, meta, metadata: { orgId, promotionId: newId, productId: b.productId, variantId: b.variantId ?? null, kind: b.kind, value: b.value } },
        tx,
      );
      return newId;
    });
    return this.one(id);
  }

  /** Edits label, end date and cap, or stops it (`active: false`). The merged result is validated again. */
  async update(orgId: string, userId: string, id: string, b: UpdatePromotionRequest, meta: RequestMeta): Promise<Promotion> {
    if (!UUID_RE.test(id)) throw notFound();
    await this.db.transaction(async (tx) => {
      const probe = (await tx.execute<{ product_id: string }>(sql`SELECT product_id FROM product_promotions WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid`)).rows[0];
      if (!probe) throw notFound();
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`promo:${probe.product_id}`}, 0))`);
      const cur = (await tx.execute<{ variant_id: string | null; starts_at: Date; ends_at: Date; stock_cap: number | null; sold_count: number; active: boolean; label: string }>(
        sql`SELECT variant_id, starts_at, ends_at, stock_cap, sold_count, active, label FROM product_promotions WHERE id = ${id}::uuid FOR UPDATE`,
      )).rows[0];
      if (!cur) throw notFound();
      if (!cur.active) throw AppError.conflict('The promotion is stopped', { reason: 'promotion_stopped' });
      const endsAt = b.endsAt ?? iso(cur.ends_at);
      const stockCap = b.stockCap !== undefined ? b.stockCap : cur.stock_cap;
      if (b.endsAt !== undefined) {
        const end = Date.parse(endsAt);
        const start = new Date(cur.starts_at).getTime();
        if (end <= start) throw validationError('endsAt', 'must be after the start');
        if (end - start > PROMOTION_MAX_DAYS * 86_400_000) throw validationError('endsAt', `at most ${PROMOTION_MAX_DAYS} days`);
        if (end <= Date.now()) throw validationError('endsAt', 'must be in the future');
        await this.assertNoOverlap(tx, probe.product_id, cur.variant_id, iso(cur.starts_at), endsAt, id);
      }
      if (stockCap !== null && stockCap < cur.sold_count) throw validationError('stockCap', 'below the units already sold');
      await tx.execute(sql`UPDATE product_promotions SET label = ${b.label ?? cur.label}, ends_at = ${endsAt}::timestamptz, stock_cap = ${stockCap}, active = ${b.active ?? true} WHERE id = ${id}::uuid`);
      await this.audit.record(
        { action: b.active === false ? 'commerce.promotion_stopped' : 'commerce.promotion_changed', actorUserId: userId, meta, metadata: { orgId, promotionId: id, productId: probe.product_id, fields: Object.keys(b) } },
        tx,
      );
    });
    return this.one(id);
  }

  async remove(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw notFound();
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ product_id: string; kind: string }>(sql`DELETE FROM product_promotions WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid RETURNING product_id, kind`);
      if (!r.rows[0]) throw notFound();
      await this.audit.record({ action: 'commerce.promotion_deleted', actorUserId: userId, meta, metadata: { orgId, promotionId: id, productId: r.rows[0].product_id, kind: r.rows[0].kind } }, tx);
    });
  }
}

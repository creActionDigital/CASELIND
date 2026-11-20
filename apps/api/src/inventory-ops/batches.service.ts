import { Inject, Injectable } from '@nestjs/common';
import {
  type Batch,
  type BatchList,
  BATCHES_PER_VARIANT_MAX,
  type ConsumeBatchRequest,
  type CreateBatchRequest,
  type ExpiringList,
  EXPIRY_SOON_DAYS,
  type Fefo,
  type PatchBatchRequest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { applyStockDelta } from '../catalog/stock-ops.js';
import { UUID_RE } from '../catalog/catalog.shared.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ORG_ROLE_PERMISSIONS } from '../orgs/org-permissions.js';
import type { Tx } from '../orgs/orgs.service.js';
import { daysToExpiry, fefoOrder, fefoPlan } from './batches.logic.js';

const variantNotFound = () => AppError.notFound('Variant not found');
const batchNotFound = () => AppError.notFound('Batch not found');

type BatchRow = {
  id: string;
  variant_id: string;
  batch_code: string;
  expires_on: string | null;
  quantity_received: number;
  quantity_remaining: number;
  received_on: string;
  note: string | null;
};
const COLS = sql`b.id, b.variant_id, b.batch_code, b.expires_on::text AS expires_on, b.quantity_received, b.quantity_remaining, b.received_on::text AS received_on, b.note`;

function toBatch(r: BatchRow, today: string): Batch {
  const days = daysToExpiry(r.expires_on, today);
  return {
    id: r.id,
    variantId: r.variant_id,
    batchCode: r.batch_code,
    expiresOn: r.expires_on,
    quantityReceived: r.quantity_received,
    quantityRemaining: r.quantity_remaining,
    receivedOn: r.received_on,
    note: r.note,
    expired: days !== null && days < 0,
    daysToExpiry: days,
  };
}

/**
 * Lots et péremption. COMPLÉMENT d'information : `quantity_remaining` n'est jamais rapproché du stock de la variante
 * (la somme des lots peut être inférieure au stock), et la réservation du catalogue ne les lit pas. Seul `enterStock`
 * à la création touche le stock, via un mouvement « restock » dans la même transaction. Audit : ids et quantités, jamais de note.
 */
@Injectable()
export class BatchesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Today's date (YYYY-MM-DD) in the organisation's time zone. */
  private async todayOf(orgId: string): Promise<string> {
    const r = await this.db.execute<{ d: string }>(sql`SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS d FROM organizations WHERE id = ${orgId}::uuid`);
    return r.rows[0]?.d ?? new Date().toISOString().slice(0, 10);
  }

  /** Locks the variant row (of this org) for the duration of the transaction. */
  private async lockVariant(tx: Tx, orgId: string, variantId: string): Promise<void> {
    if (!UUID_RE.test(variantId)) throw variantNotFound();
    const r = await tx.execute(sql`SELECT 1 FROM product_variants WHERE id = ${variantId}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`);
    if (r.rows.length === 0) throw variantNotFound();
  }

  private async assertVariant(orgId: string, variantId: string): Promise<void> {
    if (!UUID_RE.test(variantId)) throw variantNotFound();
    const r = await this.db.execute(sql`SELECT 1 FROM product_variants WHERE id = ${variantId}::uuid AND org_id = ${orgId}::uuid`);
    if (r.rows.length === 0) throw variantNotFound();
  }

  private async one(orgId: string, variantId: string, id: string): Promise<Batch> {
    const r = await this.db.execute<BatchRow>(sql`SELECT ${COLS} FROM stock_batches b WHERE b.id = ${id}::uuid AND b.variant_id = ${variantId}::uuid AND b.org_id = ${orgId}::uuid`);
    if (!r.rows[0]) throw batchNotFound();
    return toBatch(r.rows[0], await this.todayOf(orgId));
  }

  /** Non-empty batches first, then by expiry (nearest first, undated last). */
  async list(orgId: string, variantId: string): Promise<BatchList> {
    await this.assertVariant(orgId, variantId);
    const r = await this.db.execute<BatchRow>(sql`
      SELECT ${COLS} FROM stock_batches b WHERE b.variant_id = ${variantId}::uuid AND b.org_id = ${orgId}::uuid
      ORDER BY (b.quantity_remaining = 0), b.expires_on NULLS LAST, b.received_on, b.batch_code LIMIT ${BATCHES_PER_VARIANT_MAX}`);
    const today = await this.todayOf(orgId);
    return { items: r.rows.map((x) => toBatch(x, today)) };
  }

  async create(orgId: string, userId: string, variantId: string, b: CreateBatchRequest, meta: RequestMeta): Promise<Batch> {
    const id = await this.db.transaction(async (tx) => {
      await this.lockVariant(tx, orgId, variantId);
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM stock_batches WHERE variant_id = ${variantId}::uuid`);
      if ((n.rows[0]?.n ?? 0) >= BATCHES_PER_VARIANT_MAX) throw AppError.conflict(`A variant can have at most ${BATCHES_PER_VARIANT_MAX} batches`, { reason: 'limit', limit: BATCHES_PER_VARIANT_MAX });
      const dup = await tx.execute(sql`SELECT 1 FROM stock_batches WHERE variant_id = ${variantId}::uuid AND batch_code = ${b.batchCode}`);
      if (dup.rows.length > 0) throw AppError.conflict('This batch code already exists for the variant', { reason: 'batch_code_taken', field: 'batchCode' });
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO stock_batches (org_id, variant_id, batch_code, expires_on, quantity_received, quantity_remaining, received_on, note)
        VALUES (${orgId}::uuid, ${variantId}::uuid, ${b.batchCode}, ${b.expiresOn ?? null}::date, ${b.quantity}, ${b.quantity}, COALESCE(${b.receivedOn ?? null}::date, current_date), ${b.note ?? null})
        RETURNING id`);
      if (b.enterStock) await applyStockDelta(tx, { orgId, variantId, delta: b.quantity, reason: 'restock', actorUserId: userId });
      await this.audit.record({ action: 'stock.batch_created', actorUserId: userId, meta, metadata: { orgId, variantId, batchId: r.rows[0]!.id, quantity: b.quantity, enterStock: b.enterStock } }, tx);
      return r.rows[0]!.id;
    });
    return this.one(orgId, variantId, id);
  }

  async patch(orgId: string, userId: string, variantId: string, id: string, b: PatchBatchRequest, meta: RequestMeta): Promise<Batch> {
    if (!UUID_RE.test(variantId) || !UUID_RE.test(id)) throw batchNotFound();
    await this.db.transaction(async (tx) => {
      const cur = (await tx.execute<{ batch_code: string; quantity_received: number }>(sql`
        SELECT batch_code, quantity_received FROM stock_batches WHERE id = ${id}::uuid AND variant_id = ${variantId}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw batchNotFound();
      if (b.quantityRemaining !== undefined && b.quantityRemaining > cur.quantity_received) {
        throw AppError.conflict('The remaining quantity cannot exceed the quantity received', { reason: 'quantity_exceeds_received' });
      }
      if (b.batchCode !== undefined && b.batchCode !== cur.batch_code) {
        const dup = await tx.execute(sql`SELECT 1 FROM stock_batches WHERE variant_id = ${variantId}::uuid AND batch_code = ${b.batchCode} AND id <> ${id}::uuid`);
        if (dup.rows.length > 0) throw AppError.conflict('This batch code already exists for the variant', { reason: 'batch_code_taken', field: 'batchCode' });
      }
      await tx.execute(sql`
        UPDATE stock_batches SET
          batch_code = COALESCE(${b.batchCode ?? null}, batch_code),
          expires_on = CASE WHEN ${b.expiresOn !== undefined} THEN ${b.expiresOn ?? null}::date ELSE expires_on END,
          quantity_remaining = COALESCE(${b.quantityRemaining ?? null}::integer, quantity_remaining),
          note = CASE WHEN ${b.note !== undefined} THEN ${b.note ?? null} ELSE note END
        WHERE id = ${id}::uuid`);
      // A new expiry date restarts the alerts of that batch.
      if (b.expiresOn !== undefined) await tx.execute(sql`DELETE FROM stock_batch_alerts WHERE batch_id = ${id}::uuid`);
      await this.audit.record({ action: 'stock.batch_changed', actorUserId: userId, meta, metadata: { orgId, variantId, batchId: id, fields: Object.keys(b) } }, tx);
    });
    return this.one(orgId, variantId, id);
  }

  /** Information only: does NOT change the variant's stock (the sale or adjustment did that). */
  async consume(orgId: string, userId: string, variantId: string, id: string, b: ConsumeBatchRequest, meta: RequestMeta): Promise<Batch> {
    if (!UUID_RE.test(variantId) || !UUID_RE.test(id)) throw batchNotFound();
    await this.db.transaction(async (tx) => {
      const cur = (await tx.execute<{ quantity_remaining: number }>(sql`
        SELECT quantity_remaining FROM stock_batches WHERE id = ${id}::uuid AND variant_id = ${variantId}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw batchNotFound();
      if (b.quantity > cur.quantity_remaining) throw AppError.conflict('Not enough quantity left in this batch', { reason: 'batch_insufficient', remaining: cur.quantity_remaining });
      await tx.execute(sql`UPDATE stock_batches SET quantity_remaining = quantity_remaining - ${b.quantity} WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'stock.batch_consumed', actorUserId: userId, meta, metadata: { orgId, variantId, batchId: id, quantity: b.quantity } }, tx);
    });
    return this.one(orgId, variantId, id);
  }

  async fefo(orgId: string, variantId: string, quantity?: number): Promise<Fefo> {
    await this.assertVariant(orgId, variantId);
    const today = await this.todayOf(orgId);
    const r = await this.db.execute<BatchRow>(sql`SELECT ${COLS} FROM stock_batches b WHERE b.variant_id = ${variantId}::uuid AND b.org_id = ${orgId}::uuid AND b.quantity_remaining > 0`);
    const items = fefoOrder(r.rows.map((x) => toBatch(x, today)));
    if (quantity === undefined) return { items, plan: null, shortfall: null };
    const { plan, shortfall } = fefoPlan(items, quantity, today);
    return { items, plan, shortfall };
  }

  /** Batches with stock left that expire within `days` (already expired ones included), nearest first. */
  async expiring(orgId: string, days: number): Promise<ExpiringList> {
    const today = await this.todayOf(orgId);
    const r = await this.db.execute<BatchRow & { sku: string; title: string }>(sql`
      SELECT ${COLS}, v.sku, p.title FROM stock_batches b JOIN product_variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id
      WHERE b.org_id = ${orgId}::uuid AND b.quantity_remaining > 0 AND b.expires_on IS NOT NULL AND b.expires_on <= ${today}::date + ${days}::int
      ORDER BY b.expires_on, v.sku, b.batch_code LIMIT 500`);
    return { items: r.rows.map((x) => ({ ...toBatch(x, today), sku: x.sku, productTitle: x.title })) };
  }

  /**
   * Daily-style alert (called by the maintenance run, which is hourly: the journal makes it once per batch and threshold).
   * Thresholds: 'soon' (expires within 7 days) and 'expired'. One generic notification per recipient, org and threshold.
   */
  async notifyExpiring(now: Date = new Date()): Promise<number> {
    // "Today" is the organisation's own date (its time zone), computed in SQL for every organisation at once.
    const today = sql`(${now.toISOString()}::timestamptz AT TIME ZONE o.timezone)::date`;
    const claimed = await this.db.execute<{ org_id: string; threshold: 'soon' | 'expired'; n: number }>(sql`
      WITH due AS (
        SELECT b.id, b.org_id, CASE WHEN b.expires_on < ${today} THEN 'expired' ELSE 'soon' END AS threshold
        FROM stock_batches b JOIN organizations o ON o.id = b.org_id
        WHERE b.quantity_remaining > 0 AND b.expires_on IS NOT NULL AND b.expires_on <= ${today} + ${EXPIRY_SOON_DAYS}::int
      ), ins AS (
        INSERT INTO stock_batch_alerts (batch_id, threshold) SELECT id, threshold FROM due ON CONFLICT DO NOTHING RETURNING batch_id, threshold
      )
      SELECT d.org_id, ins.threshold, count(*)::int AS n FROM ins JOIN due d ON d.id = ins.batch_id GROUP BY d.org_id, ins.threshold`);
    const roles = (Object.keys(ORG_ROLE_PERMISSIONS) as (keyof typeof ORG_ROLE_PERMISSIONS)[]).filter((r) => ORG_ROLE_PERMISSIONS[r].has('inventory.manage'));
    let sent = 0;
    for (const c of claimed.rows) {
      const rec = await this.db.execute<{ user_id: string }>(sql`
        SELECT m.user_id FROM org_members m WHERE m.org_id = ${c.org_id}::uuid AND m.status = 'active' AND m.role IN (${sql.join(roles.map((r) => sql`${r}`), sql`, `)})`);
      const body = c.threshold === 'expired' ? 'Des lots arrivés à péremption ont encore du stock. Consultez les lots dans l’application.' : 'Des lots arrivent à péremption dans les 7 jours. Consultez les lots dans l’application.';
      await this.notifications.notifyMany(rec.rows.map((x) => ({ userId: x.user_id, category: 'reminder' as const, title: c.threshold === 'expired' ? 'Lots périmés' : 'Péremption proche', body, data: { type: `stock.batches_${c.threshold}`, orgId: c.org_id } })));
      sent += rec.rows.length;
    }
    return sent;
  }
}

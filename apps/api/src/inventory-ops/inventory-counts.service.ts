import { Inject, Injectable } from '@nestjs/common';
import type { InventoryCount, InventoryCountDetail, InventoryCountList, PutCountLinesRequest } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { applyStockDelta } from '../catalog/stock-ops.js';
import { UUID_RE } from '../catalog/catalog.shared.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { orgNotFound } from '../orgs/org.guard.js';
import type { Tx } from '../orgs/orgs.service.js';

const countNotFound = () => AppError.notFound('Inventory count not found');
const notOpen = () => AppError.conflict('This inventory count is not open', { reason: 'count_not_open' });
const iso = (d: Date | string) => new Date(d).toISOString();

type CountRow = {
  id: string;
  status: InventoryCount['status'];
  opened_by: string | null;
  note: string | null;
  created_at: Date;
  closed_at: Date | null;
  applied: boolean;
};
const COLS = sql`c.id, c.status, c.opened_by, c.note, c.created_at, c.closed_at, c.applied`;
const toCount = (r: CountRow): InventoryCount => ({ id: r.id, status: r.status, openedBy: r.opened_by, note: r.note, createdAt: iso(r.created_at), closedAt: r.closed_at ? iso(r.closed_at) : null, applied: r.applied });

/**
 * Inventaire physique. Les quantités du système sont figées à l'ajout de chaque ligne ; l'écart (compté - système) est calculé
 * par le serveur. La clôture avec `apply` génère, pour chaque écart, un mouvement « adjustment » du MÊME écart (et non un
 * alignement sur le stock du moment : les ventes survenues pendant le comptage sont conservées), dans une seule transaction.
 * Audit : comptes, jamais de noms de produits.
 */
@Injectable()
export class InventoryCountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string): Promise<InventoryCountList> {
    const r = await this.db.execute<CountRow>(sql`SELECT ${COLS} FROM inventory_counts c WHERE c.org_id = ${orgId}::uuid ORDER BY c.created_at DESC, c.id DESC LIMIT 50`);
    return { items: r.rows.map(toCount) };
  }

  async open(orgId: string, userId: string, note: string | null | undefined, meta: RequestMeta): Promise<InventoryCountDetail> {
    const id = await this.db.transaction(async (tx) => {
      // Locking the org serialises concurrent openings: one open count per organisation.
      const org = await tx.execute(sql`SELECT id FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`);
      if (org.rows.length === 0) throw orgNotFound();
      const open = await tx.execute(sql`SELECT 1 FROM inventory_counts WHERE org_id = ${orgId}::uuid AND status = 'open'`);
      if (open.rows.length > 0) throw AppError.conflict('An inventory count is already open', { reason: 'count_already_open' });
      const r = await tx.execute<{ id: string }>(sql`INSERT INTO inventory_counts (org_id, opened_by, note) VALUES (${orgId}::uuid, ${userId}::uuid, ${note ?? null}) RETURNING id`);
      await this.audit.record({ action: 'inventory.count_opened', actorUserId: userId, meta, metadata: { orgId, countId: r.rows[0]!.id } }, tx);
      return r.rows[0]!.id;
    });
    return this.detail(orgId, id);
  }

  async detail(orgId: string, id: string): Promise<InventoryCountDetail> {
    if (!UUID_RE.test(id)) throw countNotFound();
    const c = (await this.db.execute<CountRow>(sql`SELECT ${COLS} FROM inventory_counts c WHERE c.id = ${id}::uuid AND c.org_id = ${orgId}::uuid`)).rows[0];
    if (!c) throw countNotFound();
    const l = await this.db.execute<{ variant_id: string; sku: string; title: string; counted_quantity: number; system_quantity: number; counted_by: string | null }>(sql`
      SELECT l.variant_id, v.sku, p.title, l.counted_quantity, l.system_quantity, l.counted_by
      FROM inventory_count_lines l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
      WHERE l.count_id = ${id}::uuid ORDER BY p.title, v.sku, l.variant_id`);
    const lines = l.rows.map((x) => ({ variantId: x.variant_id, sku: x.sku, productTitle: x.title, countedQuantity: x.counted_quantity, systemQuantity: x.system_quantity, variance: x.counted_quantity - x.system_quantity, countedBy: x.counted_by }));
    return {
      ...toCount(c),
      lines,
      lineCount: lines.length,
      discrepancyCount: lines.filter((x) => x.variance !== 0).length,
      netVariance: lines.reduce((s, x) => s + x.variance, 0),
    };
  }

  /** Locks the count of this org; it must be open. */
  private async lockOpen(tx: Tx, orgId: string, id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw countNotFound();
    const c = (await tx.execute<{ status: string }>(sql`SELECT status FROM inventory_counts WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`)).rows[0];
    if (!c) throw countNotFound();
    if (c.status !== 'open') throw notOpen();
  }

  /** Enters or updates counted quantities. The system quantity is frozen when a variant is first added to the count. */
  async putLines(orgId: string, userId: string, id: string, b: PutCountLinesRequest, meta: RequestMeta): Promise<InventoryCountDetail> {
    await this.db.transaction(async (tx) => {
      await this.lockOpen(tx, orgId, id);
      const ids = b.lines.map((x) => x.variantId.toLowerCase());
      const found = await tx.execute<{ id: string; stock: number; track_stock: boolean }>(sql`
        SELECT id, stock, track_stock FROM product_variants WHERE org_id = ${orgId}::uuid AND id IN (${sql.join(ids.map((v) => sql`${v}::uuid`), sql`, `)})`);
      const byId = new Map(found.rows.map((v) => [v.id, v]));
      for (const v of ids) if (!byId.has(v)) throw AppError.notFound('Variant not found');
      const untracked = ids.find((v) => !byId.get(v)!.track_stock);
      if (untracked) throw AppError.conflict('Stock is not tracked for this variant', { reason: 'stock_not_tracked', variantId: untracked });
      for (const line of b.lines) {
        const v = byId.get(line.variantId.toLowerCase())!;
        await tx.execute(sql`
          INSERT INTO inventory_count_lines (count_id, variant_id, counted_quantity, system_quantity, counted_by)
          VALUES (${id}::uuid, ${v.id}::uuid, ${line.countedQuantity}, ${v.stock}, ${userId}::uuid)
          ON CONFLICT (count_id, variant_id) DO UPDATE SET counted_quantity = EXCLUDED.counted_quantity, system_quantity = EXCLUDED.system_quantity, counted_by = EXCLUDED.counted_by`);
      }
      await this.audit.record({ action: 'inventory.count_lines_saved', actorUserId: userId, meta, metadata: { orgId, countId: id, lines: b.lines.length } }, tx);
    });
    return this.detail(orgId, id);
  }

  async close(orgId: string, userId: string, id: string, apply: boolean, meta: RequestMeta): Promise<InventoryCountDetail> {
    await this.db.transaction(async (tx) => {
      await this.lockOpen(tx, orgId, id);
      let discrepancies = 0;
      let movements = 0;
      const lines = await tx.execute<{ variant_id: string; counted_quantity: number; system_quantity: number }>(sql`
        SELECT variant_id, counted_quantity, system_quantity FROM inventory_count_lines WHERE count_id = ${id}::uuid ORDER BY variant_id`);
      for (const l of lines.rows) {
        const delta = l.counted_quantity - l.system_quantity;
        if (delta === 0) continue;
        discrepancies += 1;
        // Variants are locked in id order (see ORDER BY above): two closings can never deadlock. A negative result rolls everything back (409).
        if (apply) {
          await applyStockDelta(tx, { orgId, variantId: l.variant_id, delta, reason: 'adjustment', actorUserId: userId });
          movements += 1;
        }
      }
      await tx.execute(sql`UPDATE inventory_counts SET status = 'closed', closed_at = now(), applied = ${apply} WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'inventory.count_closed', actorUserId: userId, meta, metadata: { orgId, countId: id, apply, discrepancies, movements } }, tx);
    });
    return this.detail(orgId, id);
  }

  async cancel(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<InventoryCountDetail> {
    await this.db.transaction(async (tx) => {
      await this.lockOpen(tx, orgId, id);
      await tx.execute(sql`UPDATE inventory_counts SET status = 'cancelled', closed_at = now() WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'inventory.count_cancelled', actorUserId: userId, meta, metadata: { orgId, countId: id } }, tx);
    });
    return this.detail(orgId, id);
  }
}

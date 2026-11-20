import { Inject, Injectable } from '@nestjs/common';
import {
  type CreatePurchaseOrderRequest,
  type PurchaseOrder,
  type PurchaseOrderLineInput,
  type PurchaseOrderList,
  type PurchaseOrderListQuery,
  type PurchaseOrderStatus,
  type ReceivePurchaseOrderRequest,
  type UpdatePurchaseOrderRequest,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor, UUID_RE, validationError, variantLabelOf } from '../catalog/catalog.shared.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { poNumber, weightedAverageCost } from './business.shared.js';

type Tx = Pick<Db, 'execute'>;
type PoRow = {
  id: string;
  number: number;
  supplier_id: string;
  supplier_name: string;
  status: PurchaseOrderStatus;
  currency: 'USD' | 'CDF';
  expected_on: string | null;
  note: string | null;
  total_minor: string | number;
  created_at: Date;
  updated_at: Date;
};
type LineRow = {
  id: string;
  po_id: string;
  variant_id: string | null;
  description: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost_minor: string | number;
};

const PO_COLS = sql`po.id, po.number, po.supplier_id, s.name AS supplier_name, po.status, po.currency::text AS currency,
  po.expected_on::text AS expected_on, po.note, po.total_minor, po.created_at, po.updated_at`;
const iso = (d: Date): string => new Date(d).toISOString();
const notFound = () => AppError.notFound('Purchase order not found');
const badState = (status: PurchaseOrderStatus, message: string) => AppError.conflict(message, { reason: 'invalid_state', status });
/** Au-delà, la somme sortirait de la plage d'entiers exacts du client. */
const TOTAL_MAX = 1_000_000_000_000_000n;

function toPo(r: PoRow, lines: LineRow[]): PurchaseOrder {
  return {
    id: r.id,
    number: poNumber(r.number),
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    status: r.status,
    currency: r.currency,
    expectedOn: r.expected_on,
    note: r.note,
    totalMinor: Number(r.total_minor),
    lines: lines.map((l) => ({
      id: l.id,
      variantId: l.variant_id,
      description: l.description,
      quantityOrdered: l.quantity_ordered,
      quantityReceived: l.quantity_received,
      unitCostMinor: Number(l.unit_cost_minor),
    })),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/**
 * Bons de commande d'achat. Machine d'états : draft → ordered → partially_received → received ; annulation possible sauf reçu.
 * La réception fait ENTRER le stock (mouvement `restock`) et met à jour le coût moyen pondéré des variantes dans la même transaction.
 * L'audit ne contient que des identifiants, le statut et des totaux.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, q: PurchaseOrderListQuery): Promise<PurchaseOrderList> {
    const filters: SQL[] = [sql`po.org_id = ${orgId}::uuid`];
    if (q.status) filters.push(sql`po.status = ${q.status}`);
    if (q.supplierId) filters.push(sql`po.supplier_id = ${q.supplierId}::uuid`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor, 'time');
      filters.push(sql`(po.created_at, po.id) < (${c.key}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<PoRow & { ts: string }>(sql`
      SELECT ${PO_COLS}, po.created_at::text AS ts FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${sql.join(filters, sql` AND `)} ORDER BY po.created_at DESC, po.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    const lines = await this.linesOf(this.db, rows.map((r) => r.id));
    return {
      items: rows.map((r) => toPo(r, lines.filter((l) => l.po_id === r.id))),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }

  async get(orgId: string, id: string): Promise<PurchaseOrder> {
    return this.read(this.db, orgId, id);
  }

  async create(orgId: string, userId: string, b: CreatePurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrder> {
    const id = await this.db.transaction(async (tx) => {
      // Numéro séquentiel par organisation : les créations concurrentes sont sérialisées.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`po:${orgId}`}, 0))`);
      await this.assertSupplier(tx, orgId, b.supplierId);
      const lines = await this.resolveLines(tx, orgId, b.lines, b.currency);
      const num = (await tx.execute<{ n: number }>(sql`SELECT COALESCE(max(number), 0)::int + 1 AS n FROM purchase_orders WHERE org_id = ${orgId}::uuid`)).rows[0]!.n;
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO purchase_orders (org_id, supplier_id, number, currency, expected_on, note, total_minor, created_by)
        VALUES (${orgId}::uuid, ${b.supplierId}::uuid, ${num}, ${b.currency}, ${b.expectedOn ?? null}::date, ${b.note ?? null}, ${lines.total.toString()}::bigint, ${userId}::uuid)
        RETURNING id`);
      const poId = r.rows[0]!.id;
      await this.insertLines(tx, poId, lines.items);
      await this.audit.record(
        { action: 'business.po_created', actorUserId: userId, meta, metadata: { orgId, poId, supplierId: b.supplierId, currency: b.currency, totalMinor: Number(lines.total) } },
        tx,
      );
      return poId;
    });
    return this.read(this.db, orgId, id);
  }

  /** Brouillon seulement. `lines` remplace toutes les lignes ; le total est recalculé. */
  async update(orgId: string, userId: string, id: string, b: UpdatePurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrder> {
    await this.db.transaction(async (tx) => {
      const cur = await this.lock(tx, orgId, id);
      if (cur.status !== 'draft') throw badState(cur.status, 'Only a draft purchase order can be edited');
      if (b.supplierId) await this.assertSupplier(tx, orgId, b.supplierId);
      let total: bigint | null = null;
      if (b.lines) {
        const lines = await this.resolveLines(tx, orgId, b.lines, cur.currency);
        await tx.execute(sql`DELETE FROM purchase_order_lines WHERE po_id = ${id}::uuid`);
        await this.insertLines(tx, id, lines.items);
        total = lines.total;
      }
      await tx.execute(sql`
        UPDATE purchase_orders SET supplier_id = ${b.supplierId ?? cur.supplier_id}::uuid, currency = ${b.currency ?? cur.currency},
          expected_on = ${b.expectedOn === undefined ? cur.expected_on : b.expectedOn}::date, note = ${b.note === undefined ? cur.note : b.note},
          total_minor = ${total === null ? String(cur.total_minor) : total.toString()}::bigint, updated_at = now()
        WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'business.po_changed', actorUserId: userId, meta, metadata: { orgId, poId: id, fields: Object.keys(b) } }, tx);
    });
    return this.read(this.db, orgId, id);
  }

  /** Envoie le bon au fournisseur (draft → ordered). */
  order(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<PurchaseOrder> {
    return this.transition(orgId, userId, id, meta, ['draft'], 'ordered', 'business.po_ordered', 'Only a draft purchase order can be sent');
  }

  /** Annule un bon (brouillon, envoyé ou partiellement reçu : le stock déjà entré reste). Un bon reçu ne s'annule pas. */
  cancel(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<PurchaseOrder> {
    return this.transition(orgId, userId, id, meta, ['draft', 'ordered', 'partially_received'], 'cancelled', 'business.po_cancelled', 'This purchase order cannot be cancelled');
  }

  async receive(orgId: string, userId: string, id: string, b: ReceivePurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrder> {
    await this.db.transaction(async (tx) => {
      const po = await this.lock(tx, orgId, id);
      if (po.status !== 'ordered' && po.status !== 'partially_received') throw badState(po.status, 'Only a sent purchase order can be received');
      const lines = await this.linesOf(tx, [id], true);
      const byId = new Map(lines.map((l) => [l.id, l]));
      const take = new Map<string, number>();
      for (const r of b.lines) {
        const line = byId.get(r.lineId.toLowerCase());
        if (!line) throw AppError.notFound('Line not found');
        if (r.quantity > line.quantity_ordered - line.quantity_received) {
          throw AppError.conflict('Received quantity exceeds what is still expected', { reason: 'quantity_exceeds_ordered', lineId: line.id });
        }
        take.set(line.id, r.quantity);
      }
      // Variantes verrouillées dans l'ordre des ids (pas d'interblocage avec une vente ou un autre achat).
      const variantIds = [...new Set([...take.keys()].map((lid) => byId.get(lid)!.variant_id).filter((v): v is string => !!v))].sort();
      const state = new Map<string, { stock: number; cost: number | null; track: boolean; orgId: string }>();
      if (variantIds.length > 0) {
        const vs = await tx.execute<{ id: string; org_id: string; stock: number; cost_minor: string | null; track_stock: boolean; currency: string }>(sql`
          SELECT id, org_id, stock, cost_minor, track_stock, currency::text AS currency FROM product_variants
          WHERE id IN (${sql.join(variantIds.map((v) => sql`${v}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`);
        for (const v of vs.rows) {
          if (v.currency !== po.currency) {
            throw AppError.conflict('The currency of the purchase order differs from the currency of an article', { reason: 'currency_mismatch', variantId: v.id });
          }
          state.set(v.id, { stock: v.stock, cost: v.cost_minor === null ? null : Number(v.cost_minor), track: v.track_stock, orgId: v.org_id });
        }
      }
      for (const [lineId, qty] of take) {
        const line = byId.get(lineId)!;
        await tx.execute(sql`UPDATE purchase_order_lines SET quantity_received = quantity_received + ${qty} WHERE id = ${lineId}::uuid`);
        line.quantity_received += qty;
        const v = line.variant_id ? state.get(line.variant_id) : undefined;
        if (!line.variant_id || !v || v.orgId !== orgId) continue;
        const unit = Number(line.unit_cost_minor);
        const nextCost = weightedAverageCost(v.stock, v.cost, qty, unit);
        const nextStock = v.track ? v.stock + qty : v.stock;
        await tx.execute(sql`UPDATE product_variants SET stock = ${nextStock}, cost_minor = ${nextCost} WHERE id = ${line.variant_id}::uuid`);
        if (v.track) {
          await tx.execute(sql`
            INSERT INTO stock_movements (variant_id, org_id, delta, stock_after, reason, actor_user_id)
            VALUES (${line.variant_id}::uuid, ${orgId}::uuid, ${qty}, ${nextStock}, 'restock', ${userId}::uuid)`);
        }
        v.stock = nextStock;
        v.cost = nextCost;
      }
      const status: PurchaseOrderStatus = lines.every((l) => l.quantity_received >= l.quantity_ordered) ? 'received' : 'partially_received';
      await tx.execute(sql`UPDATE purchase_orders SET status = ${status}, updated_at = now() WHERE id = ${id}::uuid`);
      await this.audit.record(
        { action: 'business.po_received', actorUserId: userId, meta, metadata: { orgId, poId: id, status, lineCount: take.size } },
        tx,
      );
    });
    return this.read(this.db, orgId, id);
  }

  // ---- helpers ------------------------------------------------------------------------------

  private async transition(
    orgId: string,
    userId: string,
    id: string,
    meta: RequestMeta,
    from: PurchaseOrderStatus[],
    to: PurchaseOrderStatus,
    action: 'business.po_ordered' | 'business.po_cancelled',
    message: string,
  ): Promise<PurchaseOrder> {
    await this.db.transaction(async (tx) => {
      const cur = await this.lock(tx, orgId, id);
      if (!from.includes(cur.status)) throw badState(cur.status, message);
      await tx.execute(sql`UPDATE purchase_orders SET status = ${to}, updated_at = now() WHERE id = ${id}::uuid`);
      await this.audit.record({ action, actorUserId: userId, meta, metadata: { orgId, poId: id, status: to } }, tx);
    });
    return this.read(this.db, orgId, id);
  }

  private async lock(tx: Tx, orgId: string, id: string): Promise<{ status: PurchaseOrderStatus; supplier_id: string; currency: string; expected_on: string | null; note: string | null; total_minor: string }> {
    if (!UUID_RE.test(id)) throw notFound();
    const r = await tx.execute<{ status: PurchaseOrderStatus; supplier_id: string; currency: string; expected_on: string | null; note: string | null; total_minor: string }>(sql`
      SELECT status, supplier_id, currency::text AS currency, expected_on::text AS expected_on, note, total_minor::text AS total_minor
      FROM purchase_orders WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`);
    if (!r.rows[0]) throw notFound();
    return r.rows[0];
  }

  private async read(db: Tx, orgId: string, id: string): Promise<PurchaseOrder> {
    if (!UUID_RE.test(id)) throw notFound();
    const r = await db.execute<PoRow>(sql`
      SELECT ${PO_COLS} FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ${id}::uuid AND po.org_id = ${orgId}::uuid`);
    if (!r.rows[0]) throw notFound();
    return toPo(r.rows[0], await this.linesOf(db, [id]));
  }

  private async linesOf(db: Tx, poIds: string[], forUpdate = false): Promise<LineRow[]> {
    if (poIds.length === 0) return [];
    const r = await db.execute<LineRow>(sql`
      SELECT id, po_id, variant_id, description, quantity_ordered, quantity_received, unit_cost_minor FROM purchase_order_lines
      WHERE po_id IN (${sql.join(poIds.map((p) => sql`${p}::uuid`), sql`, `)}) ORDER BY po_id, position ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    return r.rows;
  }

  private async assertSupplier(tx: Tx, orgId: string, supplierId: string): Promise<void> {
    const r = await tx.execute<{ active: boolean }>(sql`SELECT active FROM suppliers WHERE id = ${supplierId}::uuid AND org_id = ${orgId}::uuid FOR SHARE`);
    if (!r.rows[0]) throw AppError.notFound('Supplier not found');
    if (!r.rows[0].active) throw AppError.conflict('This supplier is deactivated', { reason: 'supplier_inactive' });
  }

  /** Lignes validées : les articles du catalogue doivent appartenir à l'organisation ; la description d'un article est tirée du catalogue. */
  private async resolveLines(tx: Tx, orgId: string, lines: PurchaseOrderLineInput[], currency: string): Promise<{ items: { variantId: string | null; description: string; quantity: number; unitCostMinor: number }[]; total: bigint }> {
    const ids = [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))];
    const known = new Map<string, string>();
    if (ids.length > 0) {
      const r = await tx.execute<{ id: string; title: string; options: Record<string, string>; currency: string }>(sql`
        SELECT v.id, p.title, v.options, v.currency FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.org_id = ${orgId}::uuid AND v.id IN (${sql.join(ids.map((v) => sql`${v}::uuid`), sql`, `)})`);
      for (const v of r.rows) {
        if (v.currency.trim() !== currency.trim()) throw AppError.conflict('An article of the order is priced in another currency', { reason: 'currency_mismatch', variantId: v.id });
        const label = variantLabelOf(v.options);
        known.set(v.id, (label ? `${v.title} (${label})` : v.title).slice(0, 120));
      }
    }
    let total = 0n;
    const items = lines.map((l, i) => {
      if (l.variantId && !known.has(l.variantId.toLowerCase()) && !known.has(l.variantId)) throw validationError(`lines.${i}.variantId`, 'unknown article of this organization');
      total += BigInt(l.quantity) * BigInt(l.unitCostMinor);
      const fromCatalog = l.variantId ? (known.get(l.variantId) ?? known.get(l.variantId.toLowerCase())) : undefined;
      return { variantId: l.variantId ?? null, description: l.description ?? fromCatalog ?? '', quantity: l.quantity, unitCostMinor: l.unitCostMinor };
    });
    if (total > TOTAL_MAX) throw validationError('lines', 'the total of the purchase order is too large');
    return { items, total };
  }

  private async insertLines(tx: Tx, poId: string, items: { variantId: string | null; description: string; quantity: number; unitCostMinor: number }[]): Promise<void> {
    const values = items.map((l, i) => sql`(${poId}::uuid, ${i}, ${l.variantId}::uuid, ${l.description}, ${l.quantity}, ${l.unitCostMinor})`);
    await tx.execute(sql`INSERT INTO purchase_order_lines (po_id, position, variant_id, description, quantity_ordered, unit_cost_minor) VALUES ${sql.join(values, sql`, `)}`);
  }
}

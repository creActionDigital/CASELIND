import { Inject, Injectable } from '@nestjs/common';
import type {
  ClosePosShiftRequest,
  CreatePosSaleRequest,
  CurrentPosShift,
  OpenPosShiftRequest,
  PosSale,
  PosSaleList,
  PosShift,
  PosShiftReport,
  PosSummary,
  PosTicket,
} from '@caselind/contracts';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { CatalogPort } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { countPosOperation } from '../observability/metrics.js';
import { WebhookService } from '../webhooks/webhooks.service.js';

/** `lines` also carries `variantId` (internal: needed to give the stock back on void); the API never shows it. */
type StoredLine = PosSale['lines'][number] & { variantId?: string };
type Row = { request_hash?: string | null; id: string; currency: string; total_minor: string; payment_method: PosSale['paymentMethod']; lines: StoredLine[]; created_at: Date | string; voided_at: Date | string | null };
const COLS = sql`id, currency, total_minor, payment_method, lines, created_at, voided_at`;
const iso = (d: Date | string): string => new Date(d).toISOString();
const toSale = (r: Row): PosSale => ({
  id: r.id,
  currency: r.currency.trim() as PosSale['currency'],
  totalMinor: Number(r.total_minor),
  paymentMethod: r.payment_method,
  lines: r.lines.map(({ title, variantLabel, quantity, unitPriceMinor }) => ({ title, variantLabel, quantity, unitPriceMinor })),
  createdAt: iso(r.created_at),
  voidedAt: r.voided_at ? iso(r.voided_at) : null,
});

type ShiftRow = { id: string; currency: string; opening_float_minor: string; opened_at: Date | string; closed_at: Date | string | null; counted_cash_minor: string | null };
const SHIFT_COLS = sql`id, currency, opening_float_minor, opened_at, closed_at, counted_cash_minor`;
const toShift = (r: ShiftRow): PosShift => ({
  id: r.id,
  currency: r.currency.trim() as PosShift['currency'],
  openingFloatMinor: Number(r.opening_float_minor),
  openedAt: iso(r.opened_at),
  closedAt: r.closed_at ? iso(r.closed_at) : null,
  countedCashMinor: r.counted_cash_minor === null ? null : Number(r.counted_cash_minor),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (what: string) => AppError.notFound(`${what} not found`);

/** What a retry must repeat: payment method and the variants with their summed quantities. */
const requestHash = (req: CreatePosSaleRequest): string => {
  const q = new Map<string, number>();
  for (const l of req.lines) q.set(l.variantId.toLowerCase(), (q.get(l.variantId.toLowerCase()) ?? 0) + l.quantity);
  return createHash('sha256').update(JSON.stringify([req.paymentMethod, [...q].sort(([a], [b]) => (a < b ? -1 : 1))])).digest('hex');
};

/** Counter sales (lot 16c): the seller records what was sold; stock goes down, no money moves on the platform. */
@Injectable()
export class PosService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogPort,
    private readonly webhooks: WebhookService,
  ) {}

  async create(orgId: string, cashierId: string, req: CreatePosSaleRequest, meta: RequestMeta): Promise<PosSale> {
    let fresh: PosSale | null = null;
    const sale = await this.db.transaction(async (tx) => {
      // Serialises retries of the same sale: the second waits, then finds the first and returns it.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${orgId}:${req.clientId}`}, 0))`);
      const hash = requestHash(req);
      const dup = await tx.execute<Row>(sql`SELECT ${COLS}, request_hash FROM pos_sales WHERE org_id = ${orgId}::uuid AND client_id = ${req.clientId}::uuid`);
      if (dup.rows[0]) {
        if (dup.rows[0].request_hash && dup.rows[0].request_hash !== hash) throw AppError.conflict('This sale key was already used for a different sale', { reason: 'client_id_reused' });
        return toSale(dup.rows[0]);
      }
      // Variants of other orgs read as unavailable (same answer as an unknown id): no stock leak across shops.
      const reserved = await this.catalog.reserve(tx, req.lines, undefined, { orgId, reason: 'pos_sale' });
      if (!reserved.ok) throw AppError.conflict(reserved.reason === 'insufficient_stock' ? 'Not enough stock' : 'An item is unavailable', { reason: reserved.reason, variantIds: reserved.variantIds });
      const currencies = new Set(reserved.lines.map((l) => l.currency));
      if (currencies.size !== 1) throw AppError.conflict('All items of a sale must use the same currency');
      const currency = [...currencies][0]!;
      const total = reserved.lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
      const lines: StoredLine[] = reserved.lines.map((l) => ({ variantId: l.variantId, title: l.title, variantLabel: l.variantLabel, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor }));
      // FOR SHARE: a concurrent close (FOR UPDATE) finishes first, then the closed session no longer matches.
      const open = await tx.execute<{ id: string }>(sql`SELECT id FROM pos_shifts WHERE org_id = ${orgId}::uuid AND closed_at IS NULL FOR SHARE`);
      const ins = await tx.execute<Row>(sql`
        INSERT INTO pos_sales (org_id, client_id, cashier_user_id, currency, total_minor, payment_method, lines, request_hash, shift_id)
        VALUES (${orgId}::uuid, ${req.clientId}::uuid, ${cashierId}::uuid, ${currency}, ${total}, ${req.paymentMethod}, ${JSON.stringify(lines)}::jsonb, ${hash}, ${open.rows[0]?.id ?? null}::uuid)
        RETURNING ${COLS}`);
      await this.audit.record({ action: 'commerce.pos_sale', actorUserId: cashierId, meta, metadata: { orgId, saleId: ins.rows[0]!.id, totalMinor: total, currency, paymentMethod: req.paymentMethod } }, tx);
      fresh = toSale(ins.rows[0]!);
      return fresh;
    });
    // After the commit, and only for a new sale (a retry returns the first one). Amounts and ids only: no cashier, no item titles.
    if (fresh) countPosOperation('sale');
    if (fresh) this.webhooks.emit(orgId, 'pos.sale_created', { saleId: sale.id, totalMinor: sale.totalMinor, currency: sale.currency, paymentMethod: sale.paymentMethod, lineCount: sale.lines.length });
    return sale;
  }

  /** Gives the stock back and marks the sale voided; a second call returns the sale unchanged. */
  async voidSale(orgId: string, id: string, actorId: string, reason: string | undefined, meta: RequestMeta): Promise<PosSale> {
    if (!UUID_RE.test(id)) throw notFound('Sale');
    let voided = false;
    const sale = await this.db.transaction(async (tx) => {
      const found = await tx.execute<Row>(sql`SELECT ${COLS} FROM pos_sales WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`);
      const row = found.rows[0];
      if (!row) throw notFound('Sale');
      if (row.voided_at) return toSale(row);
      const closed = await tx.execute(sql`SELECT 1 FROM pos_sales s JOIN pos_shifts h ON h.id = s.shift_id WHERE s.id = ${id}::uuid AND h.closed_at IS NOT NULL`);
      if (closed.rows.length > 0) throw AppError.conflict('The session of this sale is closed', { reason: 'shift_closed' });
      // Sales recorded before 0063 did not keep the variant: their stock cannot be given back reliably.
      if (row.lines.some((l) => !l.variantId)) throw AppError.conflict('This sale predates stock tracking and cannot be voided', { reason: 'legacy_sale' });
      await this.catalog.release(tx, row.lines.map((l) => ({ variantId: l.variantId!, quantity: l.quantity })), { reason: 'pos_void' });
      const upd = await tx.execute<Row>(sql`
        UPDATE pos_sales SET voided_at = now(), voided_by = ${actorId}::uuid, void_reason = ${reason?.length ? reason : null}
        WHERE id = ${id}::uuid RETURNING ${COLS}`);
      await this.audit.record({ action: 'commerce.pos_void', actorUserId: actorId, meta, metadata: { orgId, saleId: id, totalMinor: Number(row.total_minor), currency: row.currency.trim() } }, tx);
      voided = true;
      return toSale(upd.rows[0]!);
    });
    if (voided) countPosOperation('void');
    if (voided) this.webhooks.emit(orgId, 'pos.sale_voided', { saleId: sale.id, totalMinor: sale.totalMinor, currency: sale.currency });
    return sale;
  }

  async ticket(orgId: string, id: string): Promise<PosTicket> {
    if (!UUID_RE.test(id)) throw notFound('Sale');
    const { rows } = await this.db.execute<Row & { name: string; address: string | null; phone: string | null }>(sql`
      SELECT s.id, s.currency, s.total_minor, s.payment_method, s.lines, s.created_at, s.voided_at, o.name, o.address, o.phone
      FROM pos_sales s JOIN organizations o ON o.id = s.org_id
      WHERE s.id = ${id}::uuid AND s.org_id = ${orgId}::uuid`);
    const r = rows[0];
    if (!r) throw notFound('Sale');
    return { sale: toSale(r), shop: { name: r.name, address: r.address, phone: r.phone } };
  }

  // shortcut: latest sales only, no cursor; add one if a till does more than 50 between two checks.
  async list(orgId: string, limit: number): Promise<PosSaleList> {
    const { rows } = await this.db.execute<Row>(sql`SELECT ${COLS} FROM pos_sales WHERE org_id = ${orgId}::uuid ORDER BY created_at DESC, id DESC LIMIT ${limit}`);
    return { items: rows.map(toSale) };
  }

  /** "Today" is the shop's local day (organizations.timezone); voided sales are left out. */
  async summary(orgId: string): Promise<PosSummary> {
    const { rows } = await this.db.execute<{ currency: string; n: string; total: string; cash: string; mm: string; card: string }>(sql`
      SELECT s.currency, count(*) AS n, sum(s.total_minor) AS total,
        COALESCE(sum(s.total_minor) FILTER (WHERE s.payment_method = 'cash'), 0) AS cash,
        COALESCE(sum(s.total_minor) FILTER (WHERE s.payment_method = 'mobile_money'), 0) AS mm,
        COALESCE(sum(s.total_minor) FILTER (WHERE s.payment_method = 'card'), 0) AS card
      FROM pos_sales s JOIN organizations o ON o.id = s.org_id
      WHERE s.org_id = ${orgId}::uuid AND s.voided_at IS NULL
        AND s.created_at >= date_trunc('day', now() AT TIME ZONE COALESCE((SELECT name FROM pg_timezone_names WHERE name = o.timezone LIMIT 1), 'UTC')) AT TIME ZONE COALESCE((SELECT name FROM pg_timezone_names WHERE name = o.timezone LIMIT 1), 'UTC')
      GROUP BY s.currency ORDER BY s.currency`);
    return { items: rows.map((r) => ({ currency: r.currency.trim() as 'USD' | 'CDF', salesCount: Number(r.n), totalMinor: Number(r.total), byMethod: { cash: Number(r.cash), mobile_money: Number(r.mm), card: Number(r.card) } })) };
  }

  async openShift(orgId: string, userId: string, req: OpenPosShiftRequest): Promise<PosShift> {
    const { rows } = await this.db.execute<ShiftRow>(sql`
      INSERT INTO pos_shifts (org_id, opened_by, currency, opening_float_minor)
      VALUES (${orgId}::uuid, ${userId}::uuid, ${req.currency}, ${req.openingFloatMinor})
      ON CONFLICT (org_id) WHERE closed_at IS NULL DO NOTHING
      RETURNING ${SHIFT_COLS}`);
    if (!rows[0]) throw AppError.conflict('A session is already open', { reason: 'shift_open' });
    countPosOperation('shift_open');
    return toShift(rows[0]);
  }

  async currentShift(orgId: string): Promise<CurrentPosShift> {
    const { rows } = await this.db.execute<ShiftRow>(sql`SELECT ${SHIFT_COLS} FROM pos_shifts WHERE org_id = ${orgId}::uuid AND closed_at IS NULL`);
    return { shift: rows[0] ? toShift(rows[0]) : null };
  }

  /** Closing an already closed session returns its report again (the counted amount of the first close stands). */
  async closeShift(orgId: string, id: string, userId: string, req: ClosePosShiftRequest): Promise<PosShiftReport> {
    if (!UUID_RE.test(id)) throw notFound('Session');
    return this.db.transaction(async (tx) => {
      const found = await tx.execute<ShiftRow>(sql`SELECT ${SHIFT_COLS} FROM pos_shifts WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`);
      let row = found.rows[0];
      if (!row) throw notFound('Session');
      if (!row.closed_at) {
        const upd = await tx.execute<ShiftRow>(sql`
          UPDATE pos_shifts SET closed_at = now(), closed_by = ${userId}::uuid, counted_cash_minor = ${req.countedCashMinor}
          WHERE id = ${id}::uuid RETURNING ${SHIFT_COLS}`);
        row = upd.rows[0]!;
      }
      const cash = await tx.execute<{ s: string }>(sql`
        SELECT COALESCE(sum(total_minor), 0) AS s FROM pos_sales
        WHERE shift_id = ${id}::uuid AND payment_method = 'cash' AND voided_at IS NULL AND currency = ${row.currency}`);
      const shift = toShift(row);
      const expected = shift.openingFloatMinor + Number(cash.rows[0]!.s);
      const counted = shift.countedCashMinor!;
      return { shift, expectedCashMinor: expected, countedCashMinor: counted, differenceMinor: counted - expected };
    });
  }
}

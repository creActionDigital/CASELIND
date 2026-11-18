import { Inject, Injectable } from '@nestjs/common';
import type { CreatePosSaleRequest, PosSale, PosSaleList, PosSummary } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { CatalogPort } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';

type Row = { id: string; currency: string; total_minor: string; payment_method: PosSale['paymentMethod']; lines: PosSale['lines']; created_at: Date | string };
const COLS = sql`id, currency, total_minor, payment_method, lines, created_at`;
const toSale = (r: Row): PosSale => ({
  id: r.id,
  currency: r.currency.trim() as PosSale['currency'],
  totalMinor: Number(r.total_minor),
  paymentMethod: r.payment_method,
  lines: r.lines,
  createdAt: new Date(r.created_at).toISOString(),
});

/** Counter sales (lot 16c): the seller records what was sold; stock goes down, no money moves on the platform. */
@Injectable()
export class PosService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogPort,
  ) {}

  async create(orgId: string, cashierId: string, req: CreatePosSaleRequest, meta: RequestMeta): Promise<PosSale> {
    return this.db.transaction(async (tx) => {
      const dup = await tx.execute<Row>(sql`SELECT ${COLS} FROM pos_sales WHERE org_id = ${orgId}::uuid AND client_id = ${req.clientId}::uuid`);
      if (dup.rows[0]) return toSale(dup.rows[0]);
      const reserved = await this.catalog.reserve(tx, req.lines);
      if (!reserved.ok) throw AppError.conflict(reserved.reason === 'insufficient_stock' ? 'Not enough stock' : 'An item is unavailable', { reason: reserved.reason, variantIds: reserved.variantIds });
      // Throwing rolls the whole transaction back, so the stock just taken is given back.
      if (reserved.lines.some((l) => l.orgId !== orgId)) throw AppError.notFound('Item not found');
      const currencies = new Set(reserved.lines.map((l) => l.currency));
      if (currencies.size !== 1) throw AppError.conflict('All items of a sale must use the same currency');
      const currency = [...currencies][0]!;
      const total = reserved.lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
      const lines = reserved.lines.map((l) => ({ title: l.title, variantLabel: l.variantLabel, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor }));
      const ins = await tx.execute<Row>(sql`
        INSERT INTO pos_sales (org_id, client_id, cashier_user_id, currency, total_minor, payment_method, lines)
        VALUES (${orgId}::uuid, ${req.clientId}::uuid, ${cashierId}::uuid, ${currency}, ${total}, ${req.paymentMethod}, ${JSON.stringify(lines)}::jsonb)
        RETURNING ${COLS}`);
      await this.audit.record({ action: 'commerce.pos_sale', actorUserId: cashierId, meta, metadata: { orgId, saleId: ins.rows[0]!.id, totalMinor: total, currency, paymentMethod: req.paymentMethod } }, tx);
      return toSale(ins.rows[0]!);
    });
  }

  // shortcut: the 50 latest sales, no cursor; add one if a till does more than that between two checks.
  async list(orgId: string): Promise<PosSaleList> {
    const { rows } = await this.db.execute<Row>(sql`SELECT ${COLS} FROM pos_sales WHERE org_id = ${orgId}::uuid ORDER BY created_at DESC, id DESC LIMIT 50`);
    return { items: rows.map(toSale) };
  }

  // shortcut: "today" is the UTC day, not the shop's local day; add an org time zone when needed.
  async summary(orgId: string): Promise<PosSummary> {
    const { rows } = await this.db.execute<{ currency: string; n: string; total: string; cash: string; mm: string; card: string }>(sql`
      SELECT currency, count(*) AS n, sum(total_minor) AS total,
        COALESCE(sum(total_minor) FILTER (WHERE payment_method = 'cash'), 0) AS cash,
        COALESCE(sum(total_minor) FILTER (WHERE payment_method = 'mobile_money'), 0) AS mm,
        COALESCE(sum(total_minor) FILTER (WHERE payment_method = 'card'), 0) AS card
      FROM pos_sales WHERE org_id = ${orgId}::uuid AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      GROUP BY currency ORDER BY currency`);
    return { items: rows.map((r) => ({ currency: r.currency.trim() as 'USD' | 'CDF', salesCount: Number(r.n), totalMinor: Number(r.total), byMethod: { cash: Number(r.cash), mobile_money: Number(r.mm), card: Number(r.card) } })) };
  }
}

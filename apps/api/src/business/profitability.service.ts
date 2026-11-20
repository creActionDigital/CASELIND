import { Inject, Injectable } from '@nestjs/common';
import {
  EXPENSE_CATEGORIES,
  EXPORT_MAX_ROWS,
  type ExpenseCategory,
  type PeriodQuery,
  type Profitability,
  type ProfitabilityCurrency,
  type ProfitabilityQuery,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { validationError } from '../catalog/catalog.shared.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { poNumber, toCsv } from './business.shared.js';

interface Bounds {
  tz: string;
  t0: string;
  t1: string;
}

/**
 * Commandes livrées de la période (date de livraison = événement `delivered`, à défaut la dernière mise à jour), hors annulées.
 * `goods_minor` exclut les frais de livraison et tient compte du coupon (sous-total - remise) : les lignes sont ramenées à ce même total au prorata.
 */
const deliveredOrders = (orgId: string, b: Bounds): SQL => sql`(
  SELECT o.id, o.number, o.currency::text AS currency, o.total_minor, o.total_minor - o.delivery_fee_minor AS goods_minor, o.subtotal_minor, d.at
  FROM orders o CROSS JOIN LATERAL (
    SELECT COALESCE((SELECT min(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.status = 'delivered'), o.updated_at) AS at) d
  WHERE o.org_id = ${orgId}::uuid AND o.status = 'delivered' AND d.at >= ${b.t0}::timestamptz AND d.at < ${b.t1}::timestamptz)`;

const posSales = (orgId: string, b: Bounds): SQL =>
  sql`(SELECT * FROM pos_sales WHERE org_id = ${orgId}::uuid AND voided_at IS NULL AND created_at >= ${b.t0}::timestamptz AND created_at < ${b.t1}::timestamptz) s`;

type Acc = ProfitabilityCurrency & { _products: Map<string, { title: string; quantity: number; revenue: number; cost: number }> };
const blank = (currency: 'USD' | 'CDF'): Acc => ({
  currency,
  revenueMinor: 0,
  ordersRevenueMinor: 0,
  posRevenueMinor: 0,
  cogsMinor: 0,
  unknownCostLines: 0,
  unknownCostRevenueMinor: 0,
  grossMarginMinor: 0,
  expensesMinor: 0,
  expensesByCategory: [],
  estimatedResultMinor: 0,
  topProducts: [],
  _products: new Map(),
});

/** Rentabilité et exports de gestion. Tout en entiers ; les bornes de période sont celles du fuseau de la boutique. */
@Injectable()
export class ProfitabilityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private async bounds(orgId: string, from: string, to: string): Promise<Bounds> {
    const r = await this.db.execute<{ tz: string; t0: Date; t1: Date }>(sql`
      SELECT timezone AS tz, (${from}::date)::timestamp AT TIME ZONE timezone AS t0, ((${to}::date) + 1)::timestamp AT TIME ZONE timezone AS t1
      FROM organizations WHERE id = ${orgId}::uuid`);
    const row = r.rows[0]!;
    return { tz: row.tz, t0: new Date(row.t0).toISOString(), t1: new Date(row.t1).toISOString() };
  }

  async profitability(orgId: string, q: ProfitabilityQuery): Promise<Profitability> {
    const b = await this.bounds(orgId, q.from, q.to);
    const acc = new Map<string, Acc>();
    const of = (c: string): Acc => {
      let a = acc.get(c);
      if (!a) acc.set(c, (a = blank(c as 'USD' | 'CDF')));
      return a;
    };

    const orders = await this.db.execute<{ cur: string; rev: string }>(sql`
      SELECT currency AS cur, COALESCE(sum(goods_minor), 0)::text AS rev FROM ${deliveredOrders(orgId, b)} d GROUP BY currency`);
    for (const r of orders.rows) of(r.cur).ordersRevenueMinor = Number(r.rev);
    // Retours remboursés (ou tranchés en faveur de l'acheteur) dans la période : déduits du chiffre d'affaires des commandes.
    // shortcut: daté par la dernière mise à jour du retour ; le coût des articles remis en stock n'est pas repris.
    const refunds = await this.db.execute<{ cur: string; amt: string }>(sql`
      SELECT currency::text AS cur, COALESCE(sum(COALESCE(refunded_minor, refund_minor)), 0)::text AS amt FROM order_returns
      WHERE org_id = ${orgId}::uuid AND updated_at >= ${b.t0}::timestamptz AND updated_at < ${b.t1}::timestamptz
        AND (status = 'refunded' OR (status = 'resolved' AND resolution IN ('refund_buyer', 'refund_partial')))
      GROUP BY currency`);
    for (const r of refunds.rows) of(r.cur).ordersRevenueMinor -= Number(r.amt);
    const pos = await this.db.execute<{ cur: string; rev: string }>(sql`
      SELECT s.currency::text AS cur, COALESCE(sum(s.total_minor), 0)::text AS rev FROM ${posSales(orgId, b)} GROUP BY s.currency`);
    for (const r of pos.rows) of(r.cur).posRevenueMinor = Number(r.rev);

    // Une ligne par (devise, variante, coût) : quantités, chiffre d'affaires de la ligne et coût courant de la variante.
    // Les ventes de caisse d'avant le suivi du stock n'ont pas de variante : coût inconnu.
    const lines = await this.db.execute<{ cur: string; variant_id: string | null; product_id: string | null; title: string; qty: string; revenue: string; n: number; cost_total: string | null }>(sql`
      WITH l AS (
        SELECT d.currency AS cur, i.variant_id, i.product_id, i.title, i.quantity::bigint AS qty, COALESCE(round(i.line_total_minor::numeric * d.goods_minor / NULLIF(d.subtotal_minor, 0)), i.line_total_minor)::bigint AS total
        FROM ${deliveredOrders(orgId, b)} d JOIN order_items i ON i.order_id = d.id
        UNION ALL
        SELECT s.currency::text, NULLIF(x."variantId", '')::uuid, NULL::uuid, x.title, x.quantity::bigint, x.quantity::bigint * x."unitPriceMinor"
        FROM ${posSales(orgId, b)}
        CROSS JOIN LATERAL jsonb_to_recordset(s.lines) AS x("variantId" text, title text, quantity int, "unitPriceMinor" bigint))
      SELECT l.cur, l.variant_id, COALESCE(l.product_id, v.product_id) AS product_id, COALESCE(max(p.title), max(l.title)) AS title, sum(l.qty)::text AS qty,
             sum(l.total)::text AS revenue, count(*)::int AS n,
             CASE WHEN v.cost_minor IS NOT NULL AND v.currency::text = l.cur THEN (sum(l.qty)::numeric * v.cost_minor::numeric)::text END AS cost_total
      FROM l LEFT JOIN product_variants v ON v.id = l.variant_id AND v.org_id = ${orgId}::uuid
      LEFT JOIN products p ON p.id = COALESCE(l.product_id, v.product_id) AND p.org_id = ${orgId}::uuid
      GROUP BY l.cur, l.variant_id, COALESCE(l.product_id, v.product_id), v.cost_minor, v.currency`);
    for (const r of lines.rows) {
      const a = of(r.cur);
      if (r.cost_total === null) {
        a.unknownCostLines += r.n;
        a.unknownCostRevenueMinor += Number(r.revenue);
        continue;
      }
      a.cogsMinor += Number(r.cost_total);
      if (!r.product_id) continue;
      const p = a._products.get(r.product_id) ?? { title: r.title, quantity: 0, revenue: 0, cost: 0 };
      p.quantity += Number(r.qty);
      p.revenue += Number(r.revenue);
      p.cost += Number(r.cost_total);
      a._products.set(r.product_id, p);
    }

    const expenses = await this.db.execute<{ cur: string; category: ExpenseCategory; amt: string }>(sql`
      SELECT currency::text AS cur, category, sum(amount_minor)::text AS amt FROM expenses
      WHERE org_id = ${orgId}::uuid AND spent_on >= ${q.from}::date AND spent_on <= ${q.to}::date GROUP BY currency, category`);
    for (const r of expenses.rows) {
      const a = of(r.cur);
      a.expensesMinor += Number(r.amt);
      a.expensesByCategory.push({ category: r.category, amountMinor: Number(r.amt) });
    }

    const currencies = [...acc.values()]
      .filter((a) => !q.currency || a.currency === q.currency)
      .sort((x, y) => (x.currency < y.currency ? -1 : 1))
      .map(({ _products, ...a }): ProfitabilityCurrency => {
        const revenueMinor = a.ordersRevenueMinor + a.posRevenueMinor;
        const grossMarginMinor = revenueMinor - a.cogsMinor;
        return {
          ...a,
          revenueMinor,
          grossMarginMinor,
          estimatedResultMinor: grossMarginMinor - a.expensesMinor,
          expensesByCategory: [...a.expensesByCategory].sort((x, y) => EXPENSE_CATEGORIES.indexOf(x.category) - EXPENSE_CATEGORIES.indexOf(y.category)),
          topProducts: [..._products]
            .map(([productId, p]) => ({ productId, title: p.title, quantity: p.quantity, revenueMinor: p.revenue, costMinor: p.cost, marginMinor: p.revenue - p.cost }))
            .sort((x, y) => y.marginMinor - x.marginMinor || (x.productId < y.productId ? -1 : 1))
            .slice(0, 10),
        };
      });
    return { from: q.from, to: q.to, currencies };
  }

  // ---- exports CSV --------------------------------------------------------------------------

  async exportSales(orgId: string, userId: string, q: PeriodQuery, meta: RequestMeta): Promise<string> {
    const b = await this.bounds(orgId, q.from, q.to);
    const r = await this.db.execute<{ day: string; source: string; ref: string; cur: string; total: string; method: string | null }>(sql`
      SELECT * FROM (
        SELECT to_char(d.at AT TIME ZONE ${b.tz}, 'YYYY-MM-DD') AS day, 'order' AS source, d.number AS ref, d.currency AS cur, d.total_minor::text AS total, NULL::text AS method, d.at AS at
        FROM ${deliveredOrders(orgId, b)} d
        UNION ALL
        SELECT to_char(s.created_at AT TIME ZONE ${b.tz}, 'YYYY-MM-DD'), 'pos', s.id::text, s.currency::text, s.total_minor::text, s.payment_method, s.created_at
        FROM ${posSales(orgId, b)}) x
      ORDER BY at, ref LIMIT ${EXPORT_MAX_ROWS + 1}`);
    return this.finish(orgId, userId, 'sales', q, meta, ['date', 'source', 'reference', 'currency', 'total_minor', 'payment_method'], r.rows.map((x) => [x.day, x.source, x.ref, x.cur, Number(x.total), x.method]));
  }

  async exportExpenses(orgId: string, userId: string, q: PeriodQuery, meta: RequestMeta): Promise<string> {
    const r = await this.db.execute<{ day: string; category: string; amt: string; cur: string; supplier: string | null; note: string | null }>(sql`
      SELECT e.spent_on::text AS day, e.category, e.amount_minor::text AS amt, e.currency::text AS cur, s.name AS supplier, e.note
      FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
      WHERE e.org_id = ${orgId}::uuid AND e.spent_on >= ${q.from}::date AND e.spent_on <= ${q.to}::date
      ORDER BY e.spent_on, e.id LIMIT ${EXPORT_MAX_ROWS + 1}`);
    return this.finish(orgId, userId, 'expenses', q, meta, ['date', 'category', 'amount_minor', 'currency', 'supplier', 'note'], r.rows.map((x) => [x.day, x.category, Number(x.amt), x.cur, x.supplier, x.note]));
  }

  async exportPurchases(orgId: string, userId: string, q: PeriodQuery, meta: RequestMeta): Promise<string> {
    const b = await this.bounds(orgId, q.from, q.to);
    const r = await this.db.execute<{ day: string; number: number; supplier: string; status: string; cur: string; total: string; expected: string | null; lines: number }>(sql`
      SELECT to_char(po.created_at AT TIME ZONE ${b.tz}, 'YYYY-MM-DD') AS day, po.number, s.name AS supplier, po.status, po.currency::text AS cur,
             po.total_minor::text AS total, po.expected_on::text AS expected, (SELECT count(*)::int FROM purchase_order_lines l WHERE l.po_id = po.id) AS lines
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.org_id = ${orgId}::uuid AND po.created_at >= ${b.t0}::timestamptz AND po.created_at < ${b.t1}::timestamptz
      ORDER BY po.created_at, po.id LIMIT ${EXPORT_MAX_ROWS + 1}`);
    return this.finish(orgId, userId, 'purchases', q, meta, ['date', 'number', 'supplier', 'status', 'currency', 'total_minor', 'expected_on', 'lines'],
      r.rows.map((x) => [x.day, poNumber(x.number), x.supplier, x.status, x.cur, Number(x.total), x.expected, x.lines]));
  }

  private async finish(orgId: string, userId: string, kind: string, q: PeriodQuery, meta: RequestMeta, headers: string[], rows: (string | number | null)[][]): Promise<string> {
    if (rows.length > EXPORT_MAX_ROWS) throw validationError('to', `too many rows (more than ${EXPORT_MAX_ROWS}): choose a shorter period`);
    await this.audit.record({ action: 'business.export', actorUserId: userId, meta, metadata: { orgId, kind, from: q.from, to: q.to, rows: rows.length } });
    return toCsv(headers, rows);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminCommissionStatement,
  type CommissionQuery,
  commissionMinor,
  type CommissionTotal,
  type OrgCommissionQuery,
  type OrgCommissionStatement,
  type SetOrgCommissionRequest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../stories/cursor.js';
import { SettingsService } from './settings.service.js';

type Reader = Pick<Db, 'execute'>;
const DAY = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** [from, to + 1 day) in UTC; default: the last 30 days. */
function period(q: CommissionQuery): { from: string; to: string } {
  const to = q.to ?? dayOf(new Date());
  const from = q.from ?? dayOf(new Date(Date.parse(to) - 29 * DAY));
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to || Date.parse(to) - Date.parse(from) > 366 * DAY) {
    throw AppError.conflict('Invalid period', { reason: 'bad_period' });
  }
  return { from, to };
}
const RANGE = (p: { from: string; to: string }) => sql`c.created_at >= ${p.from}::date AND c.created_at < (${p.to}::date + 1)`;

/**
 * Commissions : relevé indicatif, aucun prélèvement réel. Le taux d'une organisation est sa surcharge, sinon le réglage
 * `commission.defaultBps` (pays, puis global), sinon 0. Une ligne par commande livrée (hors frais de livraison).
 */
@Injectable()
export class CommissionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async bpsFor(orgId: string, exec: Reader = this.db): Promise<number> {
    const r = await exec.execute<{ commission_bps: number | null; country: string | null }>(sql`SELECT commission_bps, country::text AS country FROM organizations WHERE id = ${orgId}::uuid`);
    const o = r.rows[0];
    if (!o) return 0;
    if (o.commission_bps !== null) return o.commission_bps;
    return (await this.settings.resolve('commission.defaultBps', [...(o.country ? [`country:${o.country}`] : []), 'global'], exec)) ?? 0;
  }

  /** Records the line of a delivered order (once: a second call changes nothing). The callers swallow errors: a delivery never fails because of this. */
  async recordForOrder(orderId: string, exec: Reader = this.db): Promise<void> {
    const r = await exec.execute<{ org_id: string; total_minor: string; delivery_fee_minor: string; currency: string }>(sql`
      SELECT org_id, total_minor::text, delivery_fee_minor::text, currency::text AS currency FROM orders WHERE id = ${orderId}::uuid`);
    const o = r.rows[0];
    if (!o) return;
    const gross = Number(o.total_minor) - Number(o.delivery_fee_minor);
    const bps = await this.bpsFor(o.org_id, exec);
    await exec.execute(sql`
      INSERT INTO order_commissions (order_id, org_id, gross_minor, bps, commission_minor, currency)
      VALUES (${orderId}::uuid, ${o.org_id}::uuid, ${gross}, ${bps}, ${commissionMinor(gross, bps)}, ${o.currency})
      ON CONFLICT (order_id) DO NOTHING`);
  }

  async forOrg(orgId: string, q: OrgCommissionQuery): Promise<OrgCommissionStatement> {
    const p = period(q);
    const cur = q.cursor ? decodeCursor(q.cursor) : null;
    const totals = await this.db.execute<{ currency: string; orders: string; gross: string; commission: string }>(sql`
      SELECT c.currency::text AS currency, count(*) AS orders, sum(c.gross_minor) AS gross, sum(c.commission_minor) AS commission
      FROM order_commissions c WHERE c.org_id = ${orgId}::uuid AND ${RANGE(p)} GROUP BY c.currency ORDER BY c.currency`);
    const rows = await this.db.execute<{ order_id: string; number: string; gross_minor: string; bps: number; commission_minor: string; currency: string; created_at: Date; ts: string }>(sql`
      SELECT c.order_id, o.number, c.gross_minor::text, c.bps, c.commission_minor::text, c.currency::text AS currency, c.created_at, c.created_at::text AS ts
      FROM order_commissions c JOIN orders o ON o.id = c.order_id
      WHERE c.org_id = ${orgId}::uuid AND ${RANGE(p)} ${cur ? sql`AND (c.created_at, c.order_id) < (${cur.ts}::timestamptz, ${cur.id}::uuid)` : sql``}
      ORDER BY c.created_at DESC, c.order_id DESC LIMIT ${q.limit + 1}`);
    const page = rows.rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      indicative: true,
      currentBps: await this.bpsFor(orgId),
      totals: totals.rows.map((t) => this.total(t)),
      items: page.map((x) => ({ orderId: x.order_id, orderNumber: x.number, grossMinor: Number(x.gross_minor), bps: x.bps, commissionMinor: Number(x.commission_minor), currency: x.currency.trim() as 'USD' | 'CDF', createdAt: new Date(x.created_at).toISOString() })),
      nextCursor: rows.rows.length > q.limit && last ? encodeCursor(last.ts, last.order_id) : null,
    };
  }

  async forPlatform(q: CommissionQuery): Promise<AdminCommissionStatement> {
    const p = period(q);
    const totals = await this.db.execute<{ currency: string; orders: string; gross: string; commission: string }>(sql`
      SELECT c.currency::text AS currency, count(*) AS orders, sum(c.gross_minor) AS gross, sum(c.commission_minor) AS commission
      FROM order_commissions c WHERE ${RANGE(p)} GROUP BY c.currency ORDER BY c.currency`);
    const by = await this.db.execute<{ org_id: string; name: string; currency: string; orders: string; gross: string; commission: string }>(sql`
      SELECT c.org_id, g.name, c.currency::text AS currency, count(*) AS orders, sum(c.gross_minor) AS gross, sum(c.commission_minor) AS commission
      FROM order_commissions c JOIN organizations g ON g.id = c.org_id WHERE ${RANGE(p)}
      GROUP BY c.org_id, g.name, c.currency ORDER BY sum(c.commission_minor) DESC, c.org_id LIMIT 50`);
    return {
      indicative: true,
      ...p,
      totals: totals.rows.map((t) => this.total(t)),
      byOrg: by.rows.map((x) => ({ orgId: x.org_id, orgName: x.name, currency: x.currency.trim() as 'USD' | 'CDF', orders: Number(x.orders), grossMinor: Number(x.gross), commissionMinor: Number(x.commission) })),
    };
  }

  private total(t: { currency: string; orders: string; gross: string; commission: string }): CommissionTotal {
    return { currency: t.currency.trim() as 'USD' | 'CDF', orders: Number(t.orders), grossMinor: Number(t.gross), commissionMinor: Number(t.commission) };
  }

  /** Override of one organisation's rate (`null` = back to the platform rate). Applies to the next deliveries only. */
  async assertOrg(orgId: string): Promise<void> {
    if (!UUID_RE.test(orgId)) throw AppError.notFound('Organization not found');
    const r = await this.db.execute(sql`SELECT 1 FROM organizations WHERE id = ${orgId}::uuid`);
    if (r.rows.length === 0) throw AppError.notFound('Organization not found');
  }

  /** `exec`: the caller's transaction when the change runs after a second approval. */
  async setOrgBps(adminId: string, orgId: string, b: SetOrgCommissionRequest, meta: RequestMeta, exec: Pick<Db, 'transaction'> = this.db): Promise<{ orgId: string; bps: number | null }> {
    if (!UUID_RE.test(orgId)) throw AppError.notFound('Organization not found');
    await exec.transaction(async (tx) => {
      const r = await tx.execute<{ commission_bps: number | null }>(sql`SELECT commission_bps FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`);
      if (!r.rows[0]) throw AppError.notFound('Organization not found');
      await tx.execute(sql`UPDATE organizations SET commission_bps = ${b.bps} WHERE id = ${orgId}::uuid`);
      await this.audit.record({ action: 'admin.setting_changed', actorUserId: adminId, meta, metadata: { key: 'org.commissionBps', orgId, from: r.rows[0].commission_bps, to: b.bps, reason: b.reason } }, tx);
    });
    return { orgId, bps: b.bps };
  }
}

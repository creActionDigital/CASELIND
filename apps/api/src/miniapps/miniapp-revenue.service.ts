import { Inject, Injectable } from '@nestjs/common';
import { type MiniAppRevenue, type MiniAppRevenueStatement, REVENUE_DISCLAIMER, splitRevenue } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { MiniAppDevService } from './miniapp-dev.service.js';

type StatementRow = { period: string; currency: string; gross_minor: string | number; platform_minor: string | number; developer_minor: string | number; share_bps: number; payments_count: number; status: 'open' | 'closed' };

const toStatement = (r: StatementRow): MiniAppRevenueStatement => ({
  period: r.period,
  currency: r.currency,
  grossMinor: Number(r.gross_minor),
  platformMinor: Number(r.platform_minor),
  developerMinor: Number(r.developer_minor),
  shareBps: r.share_bps,
  paymentsCount: r.payments_count,
  status: r.status,
});

/** First day (UTC) of the month containing `d`, as `YYYY-MM-01`. */
export const monthStartOf = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
export const previousMonthStart = (d: Date): string => monthStartOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));

/** CSV cell: quotes doubled, formula injection neutralised. */
const cell = (v: string | number): string => {
  const t = String(v);
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
};

/**
 * Indicative monthly revenue statements per app and currency: confirmed (paid) payment requests only, platform share rounded
 * half-up on integers, developer share = the rest. Nothing is paid out: online payment is a third party's job.
 */
@Injectable()
export class MiniAppRevenueService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly dev: MiniAppDevService,
  ) {}

  /**
   * Idempotent: recomputes the month `period` (YYYY-MM-01) for every app that has paid requests in it. A `closed` statement is
   * never touched again; the share used is the one the admin set at computation time.
   */
  async compute(period: string, status: 'open' | 'closed'): Promise<number> {
    const rows = await this.db.execute<{ miniapp_id: string; currency: string; gross: string; n: number; bps: number }>(sql`
      SELECT r.app_id AS miniapp_id, r.currency, sum(r.amount_minor)::text AS gross, count(*)::int AS n, a.revenue_share_bps AS bps
      FROM miniapp_payment_requests r JOIN miniapps a ON a.id = r.app_id
      WHERE r.status = 'paid' AND r.decided_at >= ${period}::date AND r.decided_at < (${period}::date + interval '1 month')
      GROUP BY r.app_id, r.currency, a.revenue_share_bps`);
    for (const r of rows.rows) {
      const gross = Number(r.gross);
      const { platformMinor, developerMinor } = splitRevenue(gross, r.bps);
      await this.db.execute(sql`
        INSERT INTO miniapp_revenue_statements (miniapp_id, period, currency, gross_minor, platform_minor, developer_minor, share_bps, payments_count, status)
        VALUES (${r.miniapp_id}::uuid, ${period}::date, ${r.currency}, ${gross}, ${platformMinor}, ${developerMinor}, ${r.bps}, ${r.n}, ${status})
        ON CONFLICT (miniapp_id, period, currency) DO UPDATE SET gross_minor = EXCLUDED.gross_minor, platform_minor = EXCLUDED.platform_minor,
          developer_minor = EXCLUDED.developer_minor, share_bps = EXCLUDED.share_bps, payments_count = EXCLUDED.payments_count,
          status = EXCLUDED.status, computed_at = now()
        WHERE miniapp_revenue_statements.status = 'open'`);
    }
    return rows.rows.length;
  }

  /** Maintenance entry: closes last month and refreshes the running one. */
  async runMaintenance(now: Date): Promise<void> {
    await this.compute(previousMonthStart(now), 'closed');
    await this.compute(monthStartOf(now), 'open');
  }

  async list(userId: string, appId: string): Promise<MiniAppRevenue> {
    const app = await this.dev.ownedApp(userId, appId, false);
    const res = await this.db.execute<StatementRow>(sql`
      SELECT to_char(period, 'YYYY-MM-DD') AS period, currency, gross_minor, platform_minor, developer_minor, share_bps, payments_count, status
      FROM miniapp_revenue_statements WHERE miniapp_id = ${appId}::uuid ORDER BY period DESC, currency LIMIT 120`);
    return { disclaimer: REVENUE_DISCLAIMER, revenueShareBps: app.revenue_share_bps, items: res.rows.map(toStatement) };
  }

  async csv(userId: string, appId: string): Promise<string> {
    const { items, disclaimer } = await this.list(userId, appId);
    const head = 'period,currency,gross_minor,platform_minor,developer_minor,share_bps,payments_count,status';
    const lines = items.map((i) => [i.period, i.currency, i.grossMinor, i.platformMinor, i.developerMinor, i.shareBps, i.paymentsCount, i.status].map(cell).join(','));
    return [head, ...lines, `# ${disclaimer}`].join('\n') + '\n';
  }
}

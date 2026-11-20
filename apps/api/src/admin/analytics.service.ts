import { Inject, Injectable } from '@nestjs/common';
import type { AnalyticsOverview } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { denseSeries, lastDays, moneySeries, type MoneyRow, ratePercent, sumPoints } from './analytics.logic.js';

type DayCount = { day: string; n: number };
const asPoints = (rows: DayCount[]) => rows.map((r) => ({ day: r.day, value: r.n }));
const num = (v: string | number | null | undefined): number => Number(v ?? 0);

/**
 * Platform analytics (CDC §26): SQL aggregates only. No query selects a user, a customer or a content field: counts, sums, and the
 * name of an organisation in the top ranking. Days are UTC days.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async overview(days: number): Promise<AnalyticsOverview> {
    const now = new Date();
    const window = lastDays(now, days);
    const from = new Date(`${window[0]}T00:00:00.000Z`);
    const dayOf = (col: string) => sql.raw(`(${col} AT TIME ZONE 'UTC')::date::text`);
    const perDay = async (table: string, extra = ''): Promise<DayCount[]> => {
      const d = dayOf('created_at');
      const r = await this.db.execute<DayCount>(sql`SELECT ${d} AS day, count(*)::int AS n FROM ${sql.raw(table)} WHERE created_at >= ${from} ${sql.raw(extra)} GROUP BY 1`);
      return r.rows;
    };
    const money = async (table: string, amountCol: string, extra: string): Promise<MoneyRow[]> => {
      const r = await this.db.execute<{ currency: string; day: string; n: number; amount: string }>(sql`
        SELECT currency::text AS currency, ${dayOf('created_at')} AS day, count(*)::int AS n, COALESCE(sum(${sql.raw(amountCol)}), 0)::text AS amount
        FROM ${sql.raw(table)} WHERE created_at >= ${from} ${sql.raw(extra)} GROUP BY 1, 2`);
      return r.rows.map((x) => ({ currency: x.currency.trim(), day: x.day, count: x.n, amountMinor: num(x.amount) }));
    };

    const [usersTotal, newRows, activeRows, retention, orgs, orderRows, posRows, msgRows, postRows, reportRows, aiRows, top] = await Promise.all([
      this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM users WHERE status <> 'deleted'`),
      perDay('users'),
      this.db.execute<DayCount>(sql`
        SELECT day::text AS day, count(*)::int AS n FROM user_active_days WHERE day >= ${window[0]!}::date GROUP BY 1`),
      // Approximation: users who signed up in the window (and at least 7 days ago) seen again 7 days or more after signing up.
      this.db.execute<{ cohort: number; retained: number }>(sql`
        SELECT count(*)::int AS cohort,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM user_active_days d WHERE d.user_id = u.id AND d.day >= (u.created_at AT TIME ZONE 'UTC')::date + 7))::int AS retained
        FROM users u WHERE u.created_at >= ${from} AND u.created_at <= now() - interval '7 days' AND u.status <> 'deleted'`),
      this.db.execute<{ total: number; verified: number; suspended: number }>(sql`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE verification_status = 'verified')::int AS verified,
               count(*) FILTER (WHERE status = 'suspended')::int AS suspended FROM organizations`),
      money('orders', 'total_minor', `AND status <> 'cancelled'`),
      money('pos_sales', 'total_minor', 'AND voided_at IS NULL'),
      perDay('messages', `AND kind <> 'system'`),
      perDay('posts'),
      this.db.execute<{ open: number; created: number; resolved: number }>(sql`
        SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
               count(*) FILTER (WHERE created_at >= ${from})::int AS created,
               count(*) FILTER (WHERE resolved_at >= ${from})::int AS resolved FROM reports`),
      this.db.execute<DayCount>(sql`SELECT day::text AS day, sum(count)::int AS n FROM ai_usage_daily WHERE day >= ${window[0]!}::date GROUP BY 1`),
      this.db.execute<{ currency: string; organization_id: string; name: string; n: number; amount: string }>(sql`
        SELECT currency, organization_id, name, n, amount FROM (
          SELECT o.currency::text AS currency, g.id AS organization_id, g.name, count(*)::int AS n, sum(o.total_minor)::text AS amount,
                 row_number() OVER (PARTITION BY o.currency ORDER BY sum(o.total_minor) DESC, g.id) AS rank
          FROM orders o JOIN organizations g ON g.id = o.org_id
          WHERE o.created_at >= ${from} AND o.status <> 'cancelled' GROUP BY o.currency, g.id, g.name) t
        WHERE rank <= 10 ORDER BY currency, rank`),
    ]);

    const newByDay = denseSeries(window, asPoints(newRows));
    const activeByDay = denseSeries(window, asPoints(activeRows.rows));
    const messagesByDay = denseSeries(window, asPoints(msgRows));
    const postsByDay = denseSeries(window, asPoints(postRows));
    const aiByDay = denseSeries(window, asPoints(aiRows.rows));
    const ret = retention.rows[0]!;
    const rep = reportRows.rows[0]!;
    const org = orgs.rows[0]!;
    const currencies = [...new Set(top.rows.map((r) => r.currency.trim()))];

    return {
      days,
      from: window[0]!,
      to: window[window.length - 1]!,
      generatedAt: now.toISOString(),
      users: {
        total: usersTotal.rows[0]!.n,
        newInPeriod: sumPoints(newByDay),
        newByDay,
        activeByDay,
        retentionD7: { cohort: ret.cohort, retained: ret.retained, ratePercent: ratePercent(ret.retained, ret.cohort) },
      },
      organizations: { total: org.total, verified: org.verified, suspended: org.suspended },
      orders: { byCurrency: moneySeries(window, orderRows) },
      pos: { byCurrency: moneySeries(window, posRows) },
      messages: { total: sumPoints(messagesByDay), byDay: messagesByDay },
      posts: { total: sumPoints(postsByDay), byDay: postsByDay },
      reports: { open: rep.open, createdInPeriod: rep.created, resolvedInPeriod: rep.resolved },
      ai: { requests: sumPoints(aiByDay), byDay: aiByDay },
      topOrganizations: currencies.map((currency) => ({
        currency,
        items: top.rows
          .filter((r) => r.currency.trim() === currency)
          .map((r) => ({ organizationId: r.organization_id, name: r.name, orders: r.n, amountMinor: num(r.amount) })),
      })),
    };
  }
}


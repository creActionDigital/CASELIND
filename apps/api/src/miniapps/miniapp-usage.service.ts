import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  MiniAppActivityList,
  MiniAppPageQuery,
  MiniAppQuota,
  MiniAppStats,
  MiniAppUsageDay,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { decodeCursor, encodeCursor } from '../social/social.shared.js';
import { type RateDecision, MiniAppRateLimiter } from './miniapp-rate-limit.js';

type Executor = Pick<Db, 'execute'>;

/** Counters of miniapp_usage_daily that are bumped one at a time (api_calls and active_users go with the access log). */
export type UsageCounter = 'authorizations' | 'payment_requests' | 'payments_confirmed' | 'errors';

/** What a mini-app read, as a short whitelist: the access log never holds content. */
export type AccessResource = 'profile' | 'orders' | 'payment' | 'notification';
const RESOURCE_OF_SCOPE: Record<string, AccessResource> = {
  'profile.basic': 'profile',
  'profile.phone': 'profile',
  'profile.email': 'profile',
  'orders.read': 'orders',
  'wallet.pay': 'payment',
  notify: 'notification',
};

const TODAY = sql`(now() AT TIME ZONE 'UTC')::date`;
const ACTIVITY_DAYS = 90;

/** Usage counters per app and day, access log per user, quota check. Never any user data in the counters. */
@Injectable()
export class MiniAppUsageService {
  private readonly logger = new Logger(MiniAppUsageService.name);
  private readonly limiter = new MiniAppRateLimiter();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Atomic increment (upsert) of one counter for today (UTC). */
  async bump(appId: string, counter: UsageCounter, tx: Executor = this.db): Promise<void> {
    const col = sql.raw(counter);
    await tx.execute(sql`
      INSERT INTO miniapp_usage_daily (miniapp_id, day, ${col}) VALUES (${appId}::uuid, ${TODAY}, 1)
      ON CONFLICT (miniapp_id, day) DO UPDATE SET ${col} = miniapp_usage_daily.${col} + 1`);
  }

  /** A failure to count must never fail the request being served. */
  async bumpQuietly(appId: string, counter: UsageCounter): Promise<void> {
    await this.bump(appId, counter).catch((err: unknown) => this.logger.warn(`usage counter failed: ${(err as Error).name}`));
  }

  /**
   * One call served with an app token: the access log row (who, which scope, which resource, when) and the daily counters
   * in a single statement. A user counts as active once per app and day: the freshness test reads the log before this
   * very insert (data-modifying CTEs share one snapshot).
   */
  async recordAccess(appId: string, userId: string, scope: string): Promise<void> {
    const resource = RESOURCE_OF_SCOPE[scope];
    if (!resource) return;
    await this.db.execute(sql`
      WITH fresh AS (
        SELECT NOT EXISTS (
          SELECT 1 FROM miniapp_access_log WHERE user_id = ${userId}::uuid AND miniapp_id = ${appId}::uuid
            AND at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        ) AS first_today
      ), logged AS (
        INSERT INTO miniapp_access_log (miniapp_id, user_id, scope, resource) VALUES (${appId}::uuid, ${userId}::uuid, ${scope}, ${resource}) RETURNING id
      )
      INSERT INTO miniapp_usage_daily (miniapp_id, day, active_users, api_calls)
      SELECT ${appId}::uuid, ${TODAY}, CASE WHEN first_today THEN 1 ELSE 0 END, 1 FROM fresh
      ON CONFLICT (miniapp_id, day) DO UPDATE SET
        api_calls = miniapp_usage_daily.api_calls + 1,
        active_users = miniapp_usage_daily.active_users + EXCLUDED.active_users`);
  }

  quotaOf(override: number | null | undefined): MiniAppQuota {
    return { perMinute: override ?? this.env.MINIAPP_RATE_LIMIT_PER_MINUTE, perDay: this.env.MINIAPP_RATE_LIMIT_PER_DAY, overridden: override != null };
  }

  checkRate(appId: string, override: number | null | undefined): RateDecision {
    const q = this.quotaOf(override);
    return this.limiter.hit(appId, q.perMinute, q.perDay);
  }

  // ---- developer statistics -------------------------------------------------------------------------

  async stats(appId: string, days: 7 | 30 | 90): Promise<MiniAppStats> {
    const res = await this.db.execute<{ day: string; authorizations: number; active_users: number; api_calls: number; payment_requests: number; payments_confirmed: number; errors: number }>(sql`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day, coalesce(u.authorizations, 0) AS authorizations, coalesce(u.active_users, 0) AS active_users,
             coalesce(u.api_calls, 0) AS api_calls, coalesce(u.payment_requests, 0) AS payment_requests,
             coalesce(u.payments_confirmed, 0) AS payments_confirmed, coalesce(u.errors, 0) AS errors
      FROM (SELECT ${TODAY} - i AS day FROM generate_series(0, ${days - 1}::int) AS i) d
      LEFT JOIN miniapp_usage_daily u ON u.miniapp_id = ${appId}::uuid AND u.day = d.day
      ORDER BY d.day`);
    const items: MiniAppUsageDay[] = res.rows.map((r) => ({
      day: r.day,
      authorizations: r.authorizations,
      activeUsers: r.active_users,
      apiCalls: r.api_calls,
      paymentRequests: r.payment_requests,
      paymentsConfirmed: r.payments_confirmed,
      errors: r.errors,
    }));
    const sum = (k: 'authorizations' | 'apiCalls' | 'paymentRequests' | 'paymentsConfirmed' | 'errors'): number => items.reduce((a, i) => a + i[k], 0);
    const app = await this.db.execute<{ rate_limit_per_minute: number | null }>(sql`SELECT rate_limit_per_minute FROM miniapps WHERE id = ${appId}::uuid`);
    return {
      days,
      items,
      totals: { authorizations: sum('authorizations'), apiCalls: sum('apiCalls'), paymentRequests: sum('paymentRequests'), paymentsConfirmed: sum('paymentsConfirmed'), errors: sum('errors') },
      quota: this.quotaOf(app.rows[0]?.rate_limit_per_minute),
    };
  }

  // ---- what the user sees (gap G3) --------------------------------------------------------------------

  async activity(userId: string, appId: string, q: MiniAppPageQuery): Promise<MiniAppActivityList> {
    const known = await this.db.execute(sql`SELECT 1 FROM miniapp_grants WHERE user_id = ${userId}::uuid AND app_id = ${appId}::uuid`);
    if (known.rows.length === 0) throw AppError.notFound('Authorization not found');
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<{ id: string; scope: string; resource: 'profile' | 'orders' | 'payment' | 'notification'; at: string | Date; ts: string }>(sql`
      SELECT id, scope, resource, at, at::text AS ts FROM miniapp_access_log
      WHERE user_id = ${userId}::uuid AND miniapp_id = ${appId}::uuid AND at > now() - make_interval(days => ${ACTIVITY_DAYS})
        ${cursor ? sql`AND (at, id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY at DESC, id DESC LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({ id: r.id, scope: r.scope, resource: r.resource, at: new Date(r.at).toISOString() })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }
}

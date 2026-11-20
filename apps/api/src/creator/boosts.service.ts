import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AdminBoost,
  type AdminBoostList,
  type AdminBoostsQuery,
  type Boost,
  type BoostPostRequest,
  type BoostResponse,
  ErrorCodes,
  type PostList,
} from '@caselind/contracts';
import { and, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { posts, users } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import { postVisibleSql } from '../social/post-visibility.js';
import { PostsService } from '../social/posts.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../social/social.shared.js';
import { scaleForCurrency } from './tips.service.js';

export const BOOST_MIN_MINOR_USD = 100;
export const BOOST_MAX_MINOR_USD = 10_000;
/** One sponsored post at most per this many posts of a feed page. */
export const SPONSORED_EVERY = 10;

type BoostRow = {
  id: string;
  post_id: string;
  status: Boost['status'];
  starts_at: Date;
  ends_at: Date;
  budget_minor: string;
  currency: string;
  imp: number;
  uq: number;
};

const toBoost = (r: BoostRow): Boost => ({
  id: r.id,
  postId: r.post_id,
  status: r.status,
  startsAt: new Date(r.starts_at).toISOString(),
  endsAt: new Date(r.ends_at).toISOString(),
  budgetMinor: Number(r.budget_minor),
  currency: r.currency.trim(),
  impressions: r.imp,
  uniqueViewers: r.uq,
});

/** A boost whose end passed reads as `ended` even before maintenance flips the row. */
const BOOST_SELECT = sql`
  SELECT b.id, b.post_id, CASE WHEN b.status = 'active' AND b.ends_at <= now() THEN 'ended' ELSE b.status END AS status,
    b.starts_at, b.ends_at, b.budget_minor::text AS budget_minor, b.currency::text AS currency,
    COALESCE((SELECT sum(i.impressions) FROM post_impressions i WHERE i.post_id = b.post_id
      AND i.day BETWEEN (b.starts_at AT TIME ZONE 'UTC')::date AND (LEAST(b.ends_at, now()) AT TIME ZONE 'UTC')::date), 0)::int AS imp,
    COALESCE((SELECT sum(i.unique_viewers) FROM post_impressions i WHERE i.post_id = b.post_id
      AND i.day BETWEEN (b.starts_at AT TIME ZONE 'UTC')::date AND (LEAST(b.ends_at, now()) AT TIME ZONE 'UTC')::date), 0)::int AS uq
  FROM post_boosts b`;

/**
 * Boosted ("sponsored") posts. TEST MODE: the budget is a payment in the fictitious sandbox wallet, from the author to the
 * `fees` system account (kind 'p2p', metadata.ref = 'boost'); no real money moves and nothing is ever charged elsewhere.
 * A boost only widens the audience of a PUBLIC post (no targeting on personal data) and is always labelled `sponsored`.
 */
@Injectable()
export class BoostsService {
  private readonly logger = new Logger(BoostsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly posts: PostsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async byId(id: string, userId?: string): Promise<Boost | null> {
    const res = await this.db.execute<BoostRow>(sql`${BOOST_SELECT} WHERE b.id = ${id}::uuid ${userId ? sql`AND b.user_id = ${userId}::uuid` : sql``}`);
    return res.rows[0] ? toBoost(res.rows[0]) : null;
  }

  /** The caller's boosts that were running (or are) since `fromDay` (UTC `YYYY-MM-DD`), newest first. */
  async listMine(userId: string, fromDay: string): Promise<Boost[]> {
    const res = await this.db.execute<BoostRow>(sql`
      ${BOOST_SELECT} WHERE b.user_id = ${userId}::uuid AND (b.ends_at >= ${fromDay}::date OR b.status = 'active')
      ORDER BY b.created_at DESC LIMIT 20`);
    return res.rows.map(toBoost);
  }

  async create(auth: AuthUser, postId: string, body: BoostPostRequest, meta: RequestMeta): Promise<{ response: BoostResponse; created: boolean }> {
    const found = await this.posts.requireVisible(auth.userId, auth.roles, postId);
    if (found.row.authorId !== auth.userId) throw AppError.forbidden('Only the author can boost this post');

    // A retry with the same clientId returns the first boost (and never charges twice).
    const prior = await this.replayOf(auth.userId, postId, body);
    if (prior) return prior;

    if (found.row.visibility !== 'public' || found.row.hidden) {
      throw AppError.conflict('Only a public post can be boosted', { reason: 'boost_requires_public_post' });
    }
    const min = scaleForCurrency(BOOST_MIN_MINOR_USD, body.currency);
    const max = scaleForCurrency(BOOST_MAX_MINOR_USD, body.currency);
    if (body.budgetMinor < min || body.budgetMinor > max) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'budgetMinor', message: `between ${min} and ${max}` }]);
    }
    await this.db.execute(sql`UPDATE post_boosts SET status = 'ended' WHERE post_id = ${postId}::uuid AND status = 'active' AND ends_at <= now()`);
    const active = await this.db.execute(sql`SELECT 1 FROM post_boosts WHERE post_id = ${postId}::uuid AND status = 'active'`);
    if (active.rows.length > 0) {
      // May be the same request retried in parallel and committed in between: then it is a replay, not a conflict.
      const first = await this.replayOf(auth.userId, postId, body);
      if (first) return first;
      throw AppError.conflict('This post is already boosted', { reason: 'boost_already_active' });
    }

    const boostId = randomUUID();
    let paid;
    try {
      paid = await this.wallet.payInternal(
        auth,
        {
          to: { kind: 'system', code: 'fees' },
          amountMinor: body.budgetMinor,
          currency: body.currency,
          clientId: body.clientId,
          pin: body.pin,
          metadata: { ref: 'boost', boostId, postId, note: 'Publication sponsorisée' },
        },
        meta,
        async (tx, transferId) => {
          await tx.execute(sql`
            INSERT INTO post_boosts (id, post_id, user_id, client_id, ends_at, budget_minor, currency, transfer_id)
            VALUES (${boostId}::uuid, ${postId}::uuid, ${auth.userId}::uuid, ${body.clientId}::uuid, now() + (${body.days} * interval '1 day'),
                    ${body.budgetMinor}, ${body.currency}, ${transferId}::uuid)`);
          await this.audit.record(
            {
              action: 'creator.boost_created',
              actorUserId: auth.userId,
              sessionId: auth.sessionId,
              meta,
              metadata: { boostId, postId, days: body.days, budgetMinor: body.budgetMinor, currency: body.currency },
            },
            tx,
          );
        },
      );
    } catch (err) {
      const e = ((err as { cause?: unknown }).cause ?? err) as { code?: string };
      if (e.code === '23505') {
        const first = await this.replayOf(auth.userId, postId, body);
        if (first) return first;
        throw AppError.conflict('This post is already boosted', { reason: 'boost_already_active' });
      }
      throw err;
    }
    if (paid.replayed) {
      // A concurrent retry with the same clientId: the payment (and the boost, committed together) is the first request's.
      const first = await this.replayOf(auth.userId, postId, body);
      if (first) return first;
      throw AppError.conflict('This clientId was already used for a different payment', { reason: 'idempotency_mismatch' });
    }
    return { created: true, response: await this.respond(auth.userId, (await this.byId(boostId))!, body.currency, false) };
  }

  /** The boost already created with this clientId for this very request, as a replay; null when there is none. */
  private async replayOf(userId: string, postId: string, body: BoostPostRequest): Promise<{ response: BoostResponse; created: boolean } | null> {
    const res = await this.db.execute<{ id: string; post_id: string; budget_minor: string; currency: string; days: number }>(sql`
      SELECT id, post_id, budget_minor::text, currency::text AS currency, round(extract(epoch FROM ends_at - starts_at) / 86400)::int AS days
      FROM post_boosts WHERE user_id = ${userId}::uuid AND client_id = ${body.clientId}::uuid`);
    const p = res.rows[0];
    if (!p) return null;
    if (p.post_id !== postId || Number(p.budget_minor) !== body.budgetMinor || p.currency.trim() !== body.currency || p.days !== body.days) {
      throw AppError.conflict('This clientId was already used for a different boost', { reason: 'idempotency_mismatch' });
    }
    return { created: false, response: await this.respond(userId, (await this.byId(p.id))!, body.currency, true) };
  }

  private async respond(userId: string, boost: Boost, currency: string, replayed: boolean): Promise<BoostResponse> {
    return { mode: 'sandbox', replayed, boost, balanceMinor: await this.ledger.balance({ kind: 'user', userId }, currency) };
  }

  // ---- feed ---------------------------------------------------------------------------------

  /**
   * Inserts one sponsored post after each run of 10 posts of the page, among running boosts of public posts by authors the
   * viewer does not follow (so never already in their feed), not blocked, not hidden, not the viewer's own, not already in the page.
   */
  async injectSponsored(user: AuthUser, page: PostList): Promise<PostList> {
    const slots = Math.floor(page.items.length / SPONSORED_EVERY);
    if (slots === 0) return page;
    const present = page.items.map((p) => p.id);
    const rows = await this.db
      .select({ id: posts.id })
      .from(sql`post_boosts b`)
      .innerJoin(posts, sql`posts.id = b.post_id`)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(
        and(
          sql`b.status = 'active' AND b.starts_at <= now() AND b.ends_at > now()`,
          sql`${posts.visibility} = 'public' AND NOT ${posts.hidden} AND ${posts.deletedAt} IS NULL`,
          ne(posts.authorId, user.userId),
          sql`NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${user.userId}::uuid AND f.followee_id = ${posts.authorId})`,
          sql`${posts.id} <> ALL(ARRAY[${sql.join(present.map((i) => sql`${i}::uuid`), sql`, `)}])`,
          postVisibleSql(user.userId, user.roles),
        ),
      )
      .orderBy(sql`random()`)
      .limit(slots);
    if (rows.length === 0) return page;
    const sponsored = (await this.posts.hydrateByIds(user.userId, user.roles, rows.map((r) => r.id))).map((p) => ({ ...p, sponsored: true }));
    const items: PostList['items'] = [];
    let next = 0;
    page.items.forEach((p, i) => {
      items.push(p);
      if ((i + 1) % SPONSORED_EVERY === 0 && next < sponsored.length) items.push(sponsored[next++]!);
    });
    return { ...page, items };
  }

  // ---- admin --------------------------------------------------------------------------------

  async adminList(q: AdminBoostsQuery): Promise<AdminBoostList> {
    const c = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<{ id: string; post_id: string; user_id: string; status: AdminBoost['status']; starts_at: Date; ends_at: Date; budget_minor: string; currency: string; ts: string }>(sql`
      SELECT id, post_id, user_id, CASE WHEN status = 'active' AND ends_at <= now() THEN 'ended' ELSE status END AS status,
        starts_at, ends_at, budget_minor::text, currency::text AS currency, created_at::text AS ts
      FROM post_boosts
      WHERE true ${q.status ? sql`AND CASE WHEN status = 'active' AND ends_at <= now() THEN 'ended' ELSE status END = ${q.status}` : sql``}
        ${c ? sql`AND (created_at, id) < (${c.ts}::timestamptz, ${c.id}::uuid)` : sql``}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((r) => ({
        id: r.id,
        postId: r.post_id,
        userId: r.user_id,
        status: r.status,
        startsAt: new Date(r.starts_at).toISOString(),
        endsAt: new Date(r.ends_at).toISOString(),
        budgetMinor: Number(r.budget_minor),
        currency: r.currency.trim(),
      })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }

  /** Rejects a running boost and refunds the (fictitious) budget from the fees account, in one transaction. */
  async reject(actor: AuthUser, boostId: string, meta: RequestMeta): Promise<AdminBoost> {
    if (!UUID_RE.test(boostId)) throw AppError.notFound('Boost not found');
    const row = await this.db.transaction(async (tx) => {
      const cur = await tx.execute<{ id: string; post_id: string; user_id: string; budget_minor: string; currency: string; status: string; ends_at: Date; starts_at: Date }>(sql`
        SELECT id, post_id, user_id, budget_minor::text, currency::text AS currency, status, starts_at, ends_at FROM post_boosts WHERE id = ${boostId}::uuid FOR UPDATE`);
      const b = cur.rows[0];
      if (!b) throw AppError.notFound('Boost not found');
      if (b.status !== 'active' || new Date(b.ends_at).getTime() <= Date.now()) throw AppError.conflict('Only a running boost can be rejected', { reason: 'boost_not_active' });
      const refund = await this.ledger.transfer(
        {
          from: { kind: 'system', code: 'fees' },
          to: { kind: 'user', userId: b.user_id },
          amountMinor: Number(b.budget_minor),
          currency: b.currency.trim(),
          kind: 'refund',
          idempotencyKey: `boost-refund:${b.id}`,
          initiatedBy: null,
          metadata: { ref: 'boost_refund', boostId: b.id, note: 'Remboursement de la publication sponsorisée' },
        },
        tx,
      );
      if (!refund.ok) throw AppError.conflict('The budget cannot be refunded now', { reason: refund.reason });
      await tx.execute(sql`UPDATE post_boosts SET status = 'rejected', reviewed_by = ${actor.userId}::uuid, reviewed_at = now() WHERE id = ${b.id}::uuid`);
      await this.audit.record(
        {
          action: 'creator.boost_rejected',
          actorUserId: actor.userId,
          subjectUserId: b.user_id,
          sessionId: actor.sessionId,
          meta,
          metadata: { boostId: b.id, postId: b.post_id, refunded: true },
        },
        tx,
      );
      return b;
    });
    await bestEffort(this.logger, 'boost rejection notification', () =>
      this.notifications.notify({
        userId: row.user_id,
        category: 'social',
        title: 'Publication sponsorisée refusée (mode test)',
        body: 'Votre publication sponsorisée a été refusée par la modération ; le budget (fictif) vous a été remboursé.',
        data: { kind: 'boost_rejected', postId: row.post_id },
      }),
    );
    return {
      id: row.id,
      postId: row.post_id,
      userId: row.user_id,
      status: 'rejected',
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      budgetMinor: Number(row.budget_minor),
      currency: row.currency.trim(),
    };
  }
}


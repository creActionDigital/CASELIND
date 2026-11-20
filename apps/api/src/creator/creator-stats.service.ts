import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type CreatorDay,
  type CreatorOverview,
  type CreatorTipTotal,
  type CreatorTopPost,
  ErrorCodes,
  IMPRESSIONS_BATCH_MAX,
  type PlatformRole,
  type RecordImpressionsResponse,
} from '@caselind/contracts';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { posts, users } from '../db/schema.js';
import { postVisibleSql } from '../social/post-visibility.js';
import { BoostsService } from './boosts.service.js';

const DAY_MS = 86_400_000;
/** Impression batches one user may send per minute (the app sends one every few seconds at most). */
const BATCHES_PER_MINUTE = 30;

const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Reach statistics. An impression is counted per post and per UTC day; unique viewers are counted through a truncated HMAC of
 * (viewer, post, day) kept 8 days (maintenance), so no viewer identity is ever stored or returned.
 */
@Injectable()
export class CreatorStatsService {
  /** shortcut: in-memory per instance, enough as a brake on a misbehaving client; move to the throttler store when scaling out. */
  private readonly recent = new Map<string, number[]>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly boosts: BoostsService,
  ) {}

  private brake(userId: string): void {
    const now = Date.now();
    const hits = (this.recent.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= BATCHES_PER_MINUTE) {
      this.recent.set(userId, hits);
      throw new AppError(429, ErrorCodes.rateLimited, 'Too many impression batches, try again later');
    }
    hits.push(now);
    this.recent.set(userId, hits);
    if (this.recent.size > 10_000) for (const [k, v] of this.recent) if (v.every((t) => now - t >= 60_000)) this.recent.delete(k);
  }

  private viewerHash(userId: string, postId: string, day: string): Buffer {
    return createHmac('sha256', this.env.JWT_ACCESS_SECRET).update(`impression:${userId}:${postId}:${day}`).digest().subarray(0, 8);
  }

  /** Counts one impression per visible post that is not the caller's own. Invisible or unknown ids are ignored silently. */
  async record(userId: string, roles: readonly PlatformRole[], postIds: string[]): Promise<RecordImpressionsResponse> {
    this.brake(userId);
    const ids = [...new Set(postIds)].slice(0, IMPRESSIONS_BATCH_MAX);
    const seen = await this.db
      .select({ id: posts.id })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(and(inArray(posts.id, ids), ne(posts.authorId, userId), sql`NOT ${posts.hidden}`, postVisibleSql(userId, roles)));
    if (seen.length === 0) return { recorded: 0 };
    const day = utcDay(new Date());
    seen.sort((a, b) => (a.id < b.id ? -1 : 1));
    await this.db.transaction(async (tx) => {
      for (const { id } of seen) {
        const fresh = await tx.execute(sql`
          INSERT INTO post_impression_viewers (post_id, day, viewer_hash) VALUES (${id}::uuid, ${day}::date, ${this.viewerHash(userId, id, day)})
          ON CONFLICT DO NOTHING`);
        await tx.execute(sql`
          INSERT INTO post_impressions (post_id, day, impressions, unique_viewers) VALUES (${id}::uuid, ${day}::date, 1, ${(fresh.rowCount ?? 0) > 0 ? 1 : 0})
          ON CONFLICT (post_id, day) DO UPDATE SET impressions = post_impressions.impressions + 1,
            unique_viewers = post_impressions.unique_viewers + EXCLUDED.unique_viewers`);
      }
    });
    return { recorded: seen.length };
  }

  async overview(userId: string, days: number): Promise<CreatorOverview> {
    const today = new Date();
    const to = utcDay(today);
    const from = utcDay(new Date(today.getTime() - (days - 1) * DAY_MS));
    const mine = sql`p.author_id = ${userId}::uuid AND p.deleted_at IS NULL`;
    const [seriesRes, topRes, bookmarksRes, tipsRes, boosts] = await Promise.all([
      this.db.execute<{ day: string; imp: number; uq: number; reactions: number; comments: number; followers: number }>(sql`
        SELECT d.day::text AS day,
          COALESCE((SELECT sum(i.impressions) FROM post_impressions i JOIN posts p ON p.id = i.post_id WHERE ${mine} AND i.day = d.day), 0)::int AS imp,
          COALESCE((SELECT sum(i.unique_viewers) FROM post_impressions i JOIN posts p ON p.id = i.post_id WHERE ${mine} AND i.day = d.day), 0)::int AS uq,
          (SELECT count(*) FROM post_reactions r JOIN posts p ON p.id = r.post_id
            WHERE ${mine} AND r.user_id <> p.author_id AND (r.created_at AT TIME ZONE 'UTC')::date = d.day)::int AS reactions,
          (SELECT count(*) FROM post_comments c JOIN posts p ON p.id = c.post_id
            WHERE ${mine} AND c.deleted_at IS NULL AND NOT c.hidden AND c.author_id <> p.author_id AND (c.created_at AT TIME ZONE 'UTC')::date = d.day)::int AS comments,
          (SELECT count(*) FROM follows f WHERE f.followee_id = ${userId}::uuid AND (f.created_at AT TIME ZONE 'UTC')::date = d.day)::int AS followers
        FROM (SELECT g::date AS day FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS g) d
        ORDER BY d.day`),
      this.db.execute<{ id: string; excerpt: string | null; imp: number; uq: number; reactions: number; comments: number }>(sql`
        SELECT p.id, left(p.body, 80) AS excerpt, COALESCE(i.imp, 0)::int AS imp, COALESCE(i.uq, 0)::int AS uq,
          (SELECT count(*) FROM post_reactions r WHERE r.post_id = p.id AND r.user_id <> p.author_id)::int AS reactions,
          (SELECT count(*) FROM post_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL AND NOT c.hidden AND c.author_id <> p.author_id)::int AS comments
        FROM posts p
        LEFT JOIN LATERAL (SELECT sum(impressions) AS imp, sum(unique_viewers) AS uq FROM post_impressions
                           WHERE post_id = p.id AND day BETWEEN ${from}::date AND ${to}::date) i ON true
        WHERE ${mine}
        ORDER BY imp DESC, reactions DESC, p.created_at DESC LIMIT 5`),
      this.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM post_bookmarks b JOIN posts p ON p.id = b.post_id
        WHERE ${mine} AND b.user_id <> p.author_id AND (b.created_at AT TIME ZONE 'UTC')::date BETWEEN ${from}::date AND ${to}::date`),
      this.db.execute<{ currency: string; total: string; n: number }>(sql`
        SELECT currency::text AS currency, sum(amount_minor)::text AS total, count(*)::int AS n FROM journal_entries
        WHERE kind = 'p2p' AND metadata->>'ref' = 'tip' AND metadata->>'creatorId' = ${userId}
          AND (created_at AT TIME ZONE 'UTC')::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY currency ORDER BY currency`),
      this.boosts.listMine(userId, from),
    ]);
    const series: CreatorDay[] = seriesRes.rows.map((r) => ({
      date: r.day,
      impressions: r.imp,
      uniqueViewers: r.uq,
      reactions: r.reactions,
      comments: r.comments,
      newFollowers: r.followers,
    }));
    const sum = (k: keyof Omit<CreatorDay, 'date'>): number => series.reduce((a, d) => a + d[k], 0);
    const topPosts: CreatorTopPost[] = topRes.rows
      .filter((r) => r.imp + r.reactions + r.comments > 0)
      .map((r) => ({ postId: r.id, excerpt: r.excerpt, impressions: r.imp, uniqueViewers: r.uq, reactions: r.reactions, comments: r.comments }));
    const tipsReceived: CreatorTipTotal[] = tipsRes.rows.map((r) => ({ currency: r.currency.trim(), totalMinor: Number(r.total), count: r.n }));
    return {
      mode: 'sandbox',
      days,
      from,
      to,
      totals: {
        impressions: sum('impressions'),
        uniqueViewers: sum('uniqueViewers'),
        reactions: sum('reactions'),
        comments: sum('comments'),
        bookmarks: bookmarksRes.rows[0]?.n ?? 0,
        newFollowers: sum('newFollowers'),
      },
      series,
      topPosts,
      tipsReceived,
      boosts,
    };
  }
}

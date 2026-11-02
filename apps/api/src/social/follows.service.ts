import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SocialPageQuery, SocialStats, SocialUserList } from '@caselind/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { users } from '../db/schema.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { RelationsService } from './relations.service.js';
import { decodeCursor, encodeCursor, SOCIAL_CATEGORY, UUID_RE, userNotFound, validationError } from './social.shared.js';

/** True when a `social` notification with this routing data already exists for the user (one per actor and subject). */
export async function alreadyNotified(db: Db, userId: string, data: Record<string, string>): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1 FROM notifications
    WHERE user_id = ${userId} AND category = ${SOCIAL_CATEGORY} AND data @> ${JSON.stringify(data)}::jsonb
    LIMIT 1`);
  return res.rows.length > 0;
}

@Injectable()
export class FollowsService {
  private readonly logger = new Logger(FollowsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly privacy: PrivacyService,
    private readonly relations: RelationsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Active user, not blocked either way with the caller; otherwise 404 (indistinguishable). Self is allowed here. */
  async resolveTarget(viewerId: string, targetId: string): Promise<{ id: string; displayName: string }> {
    if (!UUID_RE.test(targetId)) throw userNotFound();
    const [row] = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.id, targetId), eq(users.status, 'active')))
      .limit(1);
    if (!row) throw userNotFound();
    if (row.id !== viewerId && (await this.privacy.isBlockedEitherWay(viewerId, row.id))) throw userNotFound();
    return row;
  }

  private assertNotSelf(me: string, target: string): void {
    if (me.toLowerCase() === target.toLowerCase()) throw validationError('userId', 'cannot follow yourself');
  }

  /** Idempotent. */
  async follow(me: string, targetId: string): Promise<void> {
    if (UUID_RE.test(targetId)) this.assertNotSelf(me, targetId);
    const target = await this.resolveTarget(me, targetId);
    let inserted: boolean;
    try {
      // One statement: a block created in between cannot leave a follow behind.
      const res = await this.db.execute(sql`
        INSERT INTO follows (follower_id, followee_id)
        SELECT ${me}::uuid, ${target.id}::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM user_blocks
          WHERE (blocker_id = ${me} AND blocked_id = ${target.id}) OR (blocker_id = ${target.id} AND blocked_id = ${me}))
        ON CONFLICT DO NOTHING
        RETURNING 1`);
      inserted = res.rows.length > 0;
    } catch (err) {
      const pgErr = ((err as { cause?: unknown }).cause ?? err) as { code?: string };
      if (pgErr.code === '23503') throw userNotFound();
      throw err;
    }
    if (!inserted) return;
    await bestEffort(this.logger, 'follow notification', async () => {
      const data = { kind: 'follow', actorId: me };
      if (await alreadyNotified(this.db, target.id, data)) return;
      const [actor] = await this.db.select({ name: users.displayName }).from(users).where(eq(users.id, me)).limit(1);
      await this.notifications.notify({
        userId: target.id,
        category: SOCIAL_CATEGORY,
        title: 'Nouvel abonné',
        body: `${actor?.name ?? 'Quelqu’un'} s’est abonné à votre profil`,
        data,
      });
    });
  }

  /** Idempotent. */
  async unfollow(me: string, targetId: string): Promise<void> {
    if (!UUID_RE.test(targetId)) throw userNotFound();
    this.assertNotSelf(me, targetId);
    await this.db.execute(sql`DELETE FROM follows WHERE follower_id = ${me} AND followee_id = ${targetId}`);
  }

  async stats(viewerId: string, targetId: string): Promise<SocialStats> {
    const target = await this.resolveTarget(viewerId, targetId);
    const res = await this.db.execute<{ followers: number; following: number }>(sql`
      SELECT (SELECT count(*)::int FROM follows WHERE followee_id = ${target.id}) AS followers,
             (SELECT count(*)::int FROM follows WHERE follower_id = ${target.id}) AS following`);
    const row = res.rows[0];
    const same = viewerId === target.id;
    const [isFollowing, followsYou] = same
      ? [false, false]
      : await Promise.all([this.relations.isFollowing(viewerId, target.id), this.relations.isFollowing(target.id, viewerId)]);
    return {
      userId: target.id,
      followersCount: row?.followers ?? 0,
      followingCount: row?.following ?? 0,
      isFollowing,
      followsYou,
    };
  }

  followers(viewerId: string, targetId: string, q: SocialPageQuery): Promise<SocialUserList> {
    return this.list(viewerId, targetId, q, 'followers');
  }

  following(viewerId: string, targetId: string, q: SocialPageQuery): Promise<SocialUserList> {
    return this.list(viewerId, targetId, q, 'following');
  }

  /** Newest relation first; accounts blocked either way with the viewer are left out. */
  private async list(viewerId: string, targetId: string, q: SocialPageQuery, dir: 'followers' | 'following'): Promise<SocialUserList> {
    const target = await this.resolveTarget(viewerId, targetId);
    const [own, other] = dir === 'followers' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id'];
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<{
      id: string;
      handle: string;
      display_name: string;
      avatar_url: string | null;
      ts: string;
      iso: string;
    }>(sql`
      SELECT u.id, u.handle::text AS handle, u.display_name, u.avatar_url, f.created_at::text AS ts,
             to_char(f.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS iso
      FROM follows f JOIN users u ON u.id = f.${sql.raw(other)}
      WHERE f.${sql.raw(own)} = ${target.id} AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ${viewerId}))
        ${cursor ? sql`AND (f.created_at, u.id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY f.created_at DESC, u.id DESC
      LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        userId: r.id,
        handle: r.handle,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        followedAt: r.iso,
      })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }
}

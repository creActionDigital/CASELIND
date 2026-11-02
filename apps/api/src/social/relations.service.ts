import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { follows } from '../db/schema.js';

/** Upper bound of `followingIds` when the caller does not pass one. */
const FOLLOWING_IDS_MAX = 10_000;

/**
 * Follow graph queries shared by posts, stories and later lots. "Friends" = mutual follow.
 * Pure reads on `follows`: blocking removes the relations (see PrivacyService.block), so no
 * block check is needed here.
 */
@Injectable()
export class RelationsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ f: follows.followerId })
      .from(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
      .limit(1);
    return row !== undefined;
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const res = await this.db.execute(sql`
      SELECT 1 FROM follows f1 JOIN follows f2 ON f2.follower_id = f1.followee_id AND f2.followee_id = f1.follower_id
      WHERE f1.follower_id = ${a} AND f1.followee_id = ${b}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Ids the viewer follows, most recent follow first, at most `limit` (default 10 000). */
  async followingIds(userId: string, limit: number = FOLLOWING_IDS_MAX): Promise<string[]> {
    const rows = await this.db
      .select({ id: follows.followeeId })
      .from(follows)
      .where(eq(follows.followerId, userId))
      .orderBy(sql`${follows.createdAt} DESC`)
      .limit(limit);
    return rows.map((r) => r.id);
  }
}

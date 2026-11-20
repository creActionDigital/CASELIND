import { Inject, Injectable } from '@nestjs/common';
import { BOOKMARKS_MAX, type PlatformRole, type PostList, type SocialPageQuery } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { PostsService } from '../social/posts.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../social/social.shared.js';

/** Posts a user saved. Idempotent; only a post the user can see can be saved; one that becomes invisible is omitted from the list. */
@Injectable()
export class BookmarksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly posts: PostsService,
  ) {}

  async add(userId: string, roles: readonly PlatformRole[], postId: string): Promise<void> {
    await this.posts.requireVisible(userId, roles, postId);
    await this.db.transaction(async (tx) => {
      // Serialises the cap check of one user's concurrent additions.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bookmarks:${userId}`}, 0))`);
      const exists = await tx.execute(sql`SELECT 1 FROM post_bookmarks WHERE user_id = ${userId}::uuid AND post_id = ${postId}::uuid`);
      if (exists.rows.length > 0) return;
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM post_bookmarks WHERE user_id = ${userId}::uuid`);
      if ((n.rows[0]?.n ?? 0) >= BOOKMARKS_MAX) throw AppError.conflict('The bookmarks are full', { reason: 'bookmarks_full', max: BOOKMARKS_MAX });
      await tx.execute(sql`INSERT INTO post_bookmarks (user_id, post_id) VALUES (${userId}::uuid, ${postId}::uuid)`);
    });
  }

  async remove(userId: string, postId: string): Promise<void> {
    if (!UUID_RE.test(postId)) return;
    await this.db.execute(sql`DELETE FROM post_bookmarks WHERE user_id = ${userId}::uuid AND post_id = ${postId}::uuid`);
  }

  /** Newest saved first. Posts deleted, hidden or no longer visible to the user are left out (the page may then be shorter than `limit`). */
  async list(userId: string, roles: readonly PlatformRole[], q: SocialPageQuery): Promise<PostList> {
    const c = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<{ post_id: string; ts: string }>(sql`
      SELECT b.post_id, b.created_at::text AS ts FROM post_bookmarks b
      WHERE b.user_id = ${userId}::uuid ${c ? sql`AND (b.created_at, b.post_id) < (${c.ts}::timestamptz, ${c.id}::uuid)` : sql``}
      ORDER BY b.created_at DESC, b.post_id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows.at(-1);
    return {
      items: await this.posts.hydrateByIds(userId, roles, rows.map((r) => r.post_id)),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.post_id) : null,
    };
  }
}

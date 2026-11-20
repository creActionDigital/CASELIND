import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CreatePostRequest,
  PlatformRole,
  Post,
  PostKind,
  PostList,
  ReactionCounts,
  ReactionType,
  SocialPageQuery,
  UpdatePostRequest,
} from '@caselind/contracts';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { mediaAssets, postComments, postMedia, postReactions, type PostRow, posts, users } from '../db/schema.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { replacePostHashtags } from '../creator/hashtags.js';
import { contentUrlOf } from '../media/media.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { alreadyNotified, FollowsService } from './follows.service.js';
import { PublishGuard } from '../platform-ops/publish.guard.js';
import { isPrivileged, postVisibleSql } from './post-visibility.js';
import { decodeCursor, encodeCursor, postNotFound, SOCIAL_CATEGORY, UUID_RE, validationError } from './social.shared.js';

export interface PostWithAuthor {
  row: PostRow;
  ts: string;
  author: { id: string; handle: string; displayName: string; avatarUrl: string | null };
}

const EMPTY_COUNTS = (): ReactionCounts => ({ like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 });

export { isPrivileged };

function pgCode(err: unknown): { code?: string; constraint?: string } {
  return ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly follows: FollowsService,
    private readonly notifications: NotificationsService,
    private readonly publishGuard: PublishGuard,
  ) {}

  /** The visibility matrix, as SQL over `posts` joined with the author (`users`): see postVisibleSql. */
  visibleTo(viewerId: string, roles: readonly PlatformRole[]): SQL {
    return postVisibleSql(viewerId, roles);
  }

  private baseSelect() {
    return this.db
      .select({
        row: posts,
        ts: sql<string>`${posts.createdAt}::text`,
        handle: sql<string>`${users.handle}::text`,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId));
  }

  private toWithAuthor(r: {
    row: PostRow;
    ts: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
  }): PostWithAuthor {
    return {
      row: r.row,
      ts: r.ts,
      author: { id: r.row.authorId, handle: r.handle, displayName: r.displayName, avatarUrl: r.avatarUrl },
    };
  }

  /** The post if the viewer may see it, else null. */
  async findVisible(viewerId: string, roles: readonly PlatformRole[], postId: string): Promise<PostWithAuthor | null> {
    if (!UUID_RE.test(postId)) return null;
    const [r] = await this.baseSelect()
      .where(and(eq(posts.id, postId), this.visibleTo(viewerId, roles)))
      .limit(1);
    return r ? this.toWithAuthor(r) : null;
  }

  async requireVisible(viewerId: string, roles: readonly PlatformRole[], postId: string): Promise<PostWithAuthor> {
    const found = await this.findVisible(viewerId, roles, postId);
    if (!found) throw postNotFound();
    return found;
  }

  // ---- enrichment ---------------------------------------------------------------------------

  async hydrate(viewerId: string, items: PostWithAuthor[]): Promise<Post[]> {
    if (items.length === 0) return [];
    const ids = items.map((i) => i.row.id);
    const [mediaRows, reactionRows, mine, commentRows, savedRows] = await Promise.all([
      this.db
        .select({ postId: postMedia.postId, id: mediaAssets.id, mime: mediaAssets.mime, position: postMedia.position })
        .from(postMedia)
        .innerJoin(mediaAssets, eq(mediaAssets.id, postMedia.mediaId))
        .where(inArray(postMedia.postId, ids))
        .orderBy(asc(postMedia.position)),
      this.db
        .select({ postId: postReactions.postId, type: postReactions.type, n: sql<number>`count(*)::int` })
        .from(postReactions)
        .where(inArray(postReactions.postId, ids))
        .groupBy(postReactions.postId, postReactions.type),
      this.db
        .select({ postId: postReactions.postId, type: postReactions.type })
        .from(postReactions)
        .where(and(inArray(postReactions.postId, ids), eq(postReactions.userId, viewerId))),
      this.db
        .select({ postId: postComments.postId, n: sql<number>`count(*)::int` })
        .from(postComments)
        .where(and(inArray(postComments.postId, ids), sql`${postComments.deletedAt} IS NULL AND NOT ${postComments.hidden}`))
        .groupBy(postComments.postId),
      this.db.execute<{ post_id: string }>(
        sql`SELECT post_id FROM post_bookmarks WHERE user_id = ${viewerId}::uuid AND post_id = ANY(${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]`})`,
      ),
    ]);
    const saved = new Set(savedRows.rows.map((r) => r.post_id));
    const media = new Map<string, Post['media']>();
    for (const m of mediaRows) {
      media.set(m.postId, [...(media.get(m.postId) ?? []), { id: m.id, mime: m.mime, contentUrl: contentUrlOf(m.id) }]);
    }
    const counts = new Map<string, ReactionCounts>();
    for (const r of reactionRows) {
      const c = counts.get(r.postId) ?? EMPTY_COUNTS();
      c[r.type] = r.n;
      counts.set(r.postId, c);
    }
    const myReaction = new Map(mine.map((m) => [m.postId, m.type]));
    const comments = new Map(commentRows.map((c) => [c.postId, c.n]));
    return items.map(({ row, author }) => ({
      id: row.id,
      author,
      kind: row.kind,
      body: row.body,
      visibility: row.visibility,
      media: media.get(row.id) ?? [],
      reactions: counts.get(row.id) ?? EMPTY_COUNTS(),
      myReaction: myReaction.get(row.id) ?? null,
      commentsCount: comments.get(row.id) ?? 0,
      bookmarked: saved.has(row.id),
      sponsored: false,
      moderation: row.hidden ? 'hidden' : 'visible',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private async hydrateOne(viewerId: string, item: PostWithAuthor): Promise<Post> {
    const [post] = await this.hydrate(viewerId, [item]);
    return post!;
  }

  // ---- create / read / update / delete ------------------------------------------------------

  /** `created` is false when the (author, clientId) pair was already used: the stored post is returned. */
  async create(userId: string, roles: readonly PlatformRole[], req: CreatePostRequest): Promise<{ post: Post; created: boolean }> {
    const existing = await this.findByClientId(userId, req.clientId);
    if (existing) return { post: await this.hydrateOne(userId, existing), created: false };
    await this.publishGuard.assertMayPublish(userId, 'post');

    let kind: PostKind = 'text';
    if (req.mediaIds.length > 0) {
      const assets = await this.db
        .select({ id: mediaAssets.id, owner: mediaAssets.ownerUserId, purpose: mediaAssets.purpose, status: mediaAssets.status, mime: mediaAssets.mime })
        .from(mediaAssets)
        .where(inArray(mediaAssets.id, req.mediaIds));
      const byId = new Map(assets.map((a) => [a.id, a]));
      let videos = 0;
      for (const id of req.mediaIds) {
        const a = byId.get(id);
        if (!a || a.owner !== userId || a.purpose !== 'post' || a.status !== 'ready') {
          throw validationError('mediaIds', 'must be your ready uploads with purpose "post"');
        }
        if (a.mime?.startsWith('video/')) videos += 1;
      }
      if (videos > 1) throw validationError('mediaIds', 'at most one video per post');
      kind = videos === 1 ? 'video' : 'media';
    }

    let postId: string;
    try {
      postId = await this.db.transaction(async (tx) => {
        const [p] = await tx
          .insert(posts)
          .values({ authorId: userId, clientId: req.clientId, kind, body: req.body ?? null, visibility: req.visibility })
          .returning({ id: posts.id });
        if (req.mediaIds.length > 0) {
          await tx.insert(postMedia).values(req.mediaIds.map((mediaId, position) => ({ postId: p!.id, mediaId, position })));
        }
        await replacePostHashtags(tx, p!.id, req.body);
        return p!.id;
      });
    } catch (err) {
      const e = pgCode(err);
      if (e.code === '23505') {
        if (e.constraint === 'posts_author_client_unique') {
          const again = await this.findByClientId(userId, req.clientId);
          if (again) return { post: await this.hydrateOne(userId, again), created: false };
        }
        throw validationError('mediaIds', 'a media can only be used by one post');
      }
      throw err;
    }
    const stored = await this.requireVisible(userId, roles, postId);
    return { post: await this.hydrateOne(userId, stored), created: true };
  }

  private async findByClientId(userId: string, clientId: string): Promise<PostWithAuthor | null> {
    const [r] = await this.baseSelect()
      .where(and(eq(posts.authorId, userId), eq(posts.clientId, clientId), sql`${posts.deletedAt} IS NULL`))
      .limit(1);
    return r ? this.toWithAuthor(r) : null;
  }

  async get(viewerId: string, roles: readonly PlatformRole[], postId: string): Promise<Post> {
    return this.hydrateOne(viewerId, await this.requireVisible(viewerId, roles, postId));
  }

  async update(userId: string, roles: readonly PlatformRole[], postId: string, patch: UpdatePostRequest): Promise<Post> {
    const found = await this.requireVisible(userId, roles, postId);
    if (found.row.authorId !== userId) throw AppError.forbidden('Only the author can edit this post');
    const set: Partial<typeof posts.$inferInsert> = { updatedAt: new Date() };
    if (patch.visibility !== undefined) set.visibility = patch.visibility;
    if (patch.body !== undefined) {
      if (patch.body === null) {
        const [m] = await this.db.select({ n: sql<number>`count(*)::int` }).from(postMedia).where(eq(postMedia.postId, postId));
        if ((m?.n ?? 0) === 0) throw validationError('body', 'a post without media needs a text');
      }
      set.body = patch.body;
    }
    await this.db.transaction(async (tx) => {
      await tx.update(posts).set(set).where(and(eq(posts.id, postId), sql`${posts.deletedAt} IS NULL`));
      if (patch.body !== undefined) await replacePostHashtags(tx, postId, patch.body);
    });
    return this.hydrateOne(userId, await this.requireVisible(userId, roles, postId));
  }

  /** Soft delete by the author. Not audited (own content). */
  async remove(userId: string, roles: readonly PlatformRole[], postId: string): Promise<void> {
    const found = await this.requireVisible(userId, roles, postId);
    if (found.row.authorId !== userId) throw AppError.forbidden('Only the author can delete this post');
    await this.db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId));
  }

  // ---- lists --------------------------------------------------------------------------------

  async page(viewerId: string, roles: readonly PlatformRole[], q: SocialPageQuery, extra: SQL): Promise<PostList> {
    const filters: SQL[] = [this.visibleTo(viewerId, roles), extra];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${posts.createdAt}, ${posts.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.baseSelect()
      .where(and(...filters))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(q.limit + 1);
    const slice = rows.slice(0, q.limit);
    const last = slice.at(-1);
    return {
      items: await this.hydrate(viewerId, slice.map((r) => this.toWithAuthor(r))),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last.row.id) : null,
    };
  }

  /** Visible posts of the accounts the viewer follows, plus their own; newest first. */
  feed(viewerId: string, roles: readonly PlatformRole[], q: SocialPageQuery): Promise<PostList> {
    return this.page(
      viewerId,
      roles,
      q,
      sql`(${posts.authorId} = ${viewerId}::uuid OR ${posts.authorId} IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId}::uuid))`,
    );
  }

  /** Short-video feed, simple version: recent public `video` posts, chronological (no ranking). */
  videoFeed(viewerId: string, roles: readonly PlatformRole[], q: SocialPageQuery): Promise<PostList> {
    return this.page(viewerId, roles, q, sql`(${posts.kind} = 'video' AND ${posts.visibility} = 'public')`);
  }

  async userPosts(viewerId: string, roles: readonly PlatformRole[], targetId: string, q: SocialPageQuery): Promise<PostList> {
    const target = await this.follows.resolveTarget(viewerId, targetId);
    return this.page(viewerId, roles, q, sql`${posts.authorId} = ${target.id}::uuid`);
  }

  /** The given posts that the viewer may see, hydrated, in the order of `ids` (the others are omitted). */
  async hydrateByIds(viewerId: string, roles: readonly PlatformRole[], ids: string[]): Promise<Post[]> {
    if (ids.length === 0) return [];
    const rows = await this.baseSelect().where(and(inArray(posts.id, ids), this.visibleTo(viewerId, roles)));
    const byId = new Map(rows.map((r) => [r.row.id, this.toWithAuthor(r)]));
    const ordered = ids.map((id) => byId.get(id)).filter((x): x is PostWithAuthor => x !== undefined);
    return this.hydrate(viewerId, ordered);
  }

  // ---- reactions ----------------------------------------------------------------------------

  async setReaction(
    userId: string,
    roles: readonly PlatformRole[],
    postId: string,
    type: ReactionType | null,
  ): Promise<Post> {
    const found = await this.requireVisible(userId, roles, postId);
    if (type === null) {
      await this.db.delete(postReactions).where(and(eq(postReactions.postId, postId), eq(postReactions.userId, userId)));
    } else {
      const res = await this.db.execute<{ inserted: boolean }>(sql`
        INSERT INTO post_reactions (post_id, user_id, type) VALUES (${postId}, ${userId}, ${type})
        ON CONFLICT (post_id, user_id) DO UPDATE SET type = EXCLUDED.type
        RETURNING (xmax = 0) AS inserted`);
      if (res.rows[0]?.inserted && found.row.authorId !== userId) {
        await bestEffort(this.logger, 'reaction notification', () => this.notifyReaction(userId, found));
      }
    }
    return this.hydrateOne(userId, found);
  }

  private async notifyReaction(actorId: string, found: PostWithAuthor): Promise<void> {
    const data = { kind: 'reaction', postId: found.row.id, actorId };
    if (await alreadyNotified(this.db, found.row.authorId, data)) return;
    const [actor] = await this.db.select({ name: users.displayName }).from(users).where(eq(users.id, actorId)).limit(1);
    await this.notifications.notify({
      userId: found.row.authorId,
      category: SOCIAL_CATEGORY,
      title: 'Nouvelle réaction',
      body: `${actor?.name ?? 'Quelqu’un'} a réagi à votre publication`,
      data,
    });
  }
}

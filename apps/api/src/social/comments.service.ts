import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Comment, CommentList, CreateCommentRequest, PlatformRole, SocialPageQuery } from '@caselind/contracts';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { type PostCommentRow, postComments, users } from '../db/schema.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { alreadyNotified } from './follows.service.js';
import { isPrivileged, PostsService } from './posts.service.js';
import { commentNotFound, decodeCursor, encodeCursor, SOCIAL_CATEGORY, UUID_RE, validationError } from './social.shared.js';

interface CommentWithAuthor {
  row: PostCommentRow;
  ts: string;
  author: Comment['author'];
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly posts: PostsService,
    private readonly privacy: PrivacyService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Not deleted, author active, not blocked either way with the viewer; hidden ones only for their author and moderators. */
  private visibleTo(viewerId: string, roles: readonly PlatformRole[]): SQL {
    return sql`(
      ${postComments.deletedAt} IS NULL AND ${users.status} = 'active' AND (
        ${postComments.authorId} = ${viewerId}::uuid
        OR (
          ${isPrivileged(roles) ? sql`true` : sql`NOT ${postComments.hidden}`}
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
            WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = ${postComments.authorId})
               OR (b.blocker_id = ${postComments.authorId} AND b.blocked_id = ${viewerId}::uuid))
        )
      )
    )`;
  }

  private select() {
    return this.db
      .select({
        row: postComments,
        ts: sql<string>`${postComments.createdAt}::text`,
        handle: sql<string>`${users.handle}::text`,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(postComments)
      .innerJoin(users, eq(users.id, postComments.authorId));
  }

  private toComment(r: { row: PostCommentRow; handle: string; displayName: string; avatarUrl: string | null }): Comment {
    return {
      id: r.row.id,
      postId: r.row.postId,
      author: { id: r.row.authorId, handle: r.handle, displayName: r.displayName, avatarUrl: r.avatarUrl },
      body: r.row.body,
      replyToId: r.row.replyToId,
      moderation: r.row.hidden ? 'hidden' : 'visible',
      createdAt: r.row.createdAt.toISOString(),
    };
  }

  /** Oldest first. 404 when the post is not visible to the viewer. */
  async list(viewerId: string, roles: readonly PlatformRole[], postId: string, q: SocialPageQuery): Promise<CommentList> {
    await this.posts.requireVisible(viewerId, roles, postId);
    const filters: SQL[] = [eq(postComments.postId, postId), this.visibleTo(viewerId, roles)];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${postComments.createdAt}, ${postComments.id}) > (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.select()
      .where(and(...filters))
      .orderBy(asc(postComments.createdAt), asc(postComments.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => this.toComment(r)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last.row.id) : null,
    };
  }

  async create(
    userId: string,
    roles: readonly PlatformRole[],
    postId: string,
    req: CreateCommentRequest,
  ): Promise<Comment> {
    const post = await this.posts.requireVisible(userId, roles, postId);
    let parent: CommentWithAuthor | null = null;
    if (req.replyToId) {
      const [p] = await this.select()
        .where(and(eq(postComments.id, req.replyToId), eq(postComments.postId, postId), this.visibleTo(userId, roles)))
        .limit(1);
      if (!p) throw validationError('replyToId', 'must be a comment of the same post');
      if (p.row.replyToId !== null) throw validationError('replyToId', 'replies are one level deep');
      parent = { row: p.row, ts: p.ts, author: { id: p.row.authorId, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl } };
    }
    const [inserted] = await this.db
      .insert(postComments)
      .values({ postId, authorId: userId, replyToId: req.replyToId ?? null, body: req.body })
      .returning({ id: postComments.id });
    const [stored] = await this.select().where(eq(postComments.id, inserted!.id)).limit(1);
    const comment = this.toComment(stored!);
    await bestEffort(this.logger, 'comment notification', () =>
      this.notify(userId, comment.author.displayName, post.row.id, post.row.authorId, comment.id, parent?.row.authorId ?? null),
    );
    return comment;
  }

  private async notify(
    actorId: string,
    actorName: string,
    postId: string,
    postAuthorId: string,
    commentId: string,
    parentAuthorId: string | null,
  ): Promise<void> {
    const targets: { userId: string; title: string; body: string }[] = [];
    if (postAuthorId !== actorId) {
      targets.push({ userId: postAuthorId, title: 'Nouveau commentaire', body: `${actorName} a commenté votre publication` });
    }
    if (parentAuthorId && parentAuthorId !== actorId && parentAuthorId !== postAuthorId) {
      targets.push({ userId: parentAuthorId, title: 'Nouvelle réponse', body: `${actorName} a répondu à votre commentaire` });
    }
    for (const t of targets) {
      if (await this.privacy.isBlockedEitherWay(actorId, t.userId)) continue;
      const data = { kind: 'comment', postId, commentId, actorId };
      if (await alreadyNotified(this.db, t.userId, { commentId })) continue;
      await this.notifications.notify({ userId: t.userId, category: SOCIAL_CATEGORY, title: t.title, body: t.body, data });
    }
  }

  /** The comment's author or the post's author. 404 when the comment (or its post) is not visible to the caller. */
  async remove(userId: string, roles: readonly PlatformRole[], commentId: string): Promise<void> {
    if (!UUID_RE.test(commentId)) throw commentNotFound();
    const [c] = await this.select()
      .where(and(eq(postComments.id, commentId), this.visibleTo(userId, roles)))
      .limit(1);
    if (!c) throw commentNotFound();
    const post = await this.posts.findVisible(userId, roles, c.row.postId);
    if (!post) throw commentNotFound();
    if (c.row.authorId !== userId && post.row.authorId !== userId) {
      throw AppError.forbidden('Only the comment or post author can delete this comment');
    }
    await this.db.update(postComments).set({ deletedAt: new Date() }).where(eq(postComments.id, commentId));
  }
}

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { postComments, posts, users } from '../db/schema.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { PostsService } from './posts.service.js';
import { UUID_RE } from './social.shared.js';

/** Registers the `post`, `comment` and `user` moderation targets (reports and hiding are lot 4B). */
@Injectable()
export class SocialModerationTargets implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ModerationRegistry,
    private readonly posts: PostsService,
    private readonly privacy: PrivacyService,
  ) {}

  onModuleInit(): void {
    this.registry.register('post', {
      visibleTo: async (viewerId, id) => (await this.posts.findVisible(viewerId, [], id)) !== null,
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const [r] = await this.db.select({ a: posts.authorId }).from(posts).where(eq(posts.id, id)).limit(1);
        return r?.a ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.update(posts).set({ hidden }).where(eq(posts.id, id));
      },
    });

    this.registry.register('comment', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const [c] = await this.db
          .select({
            postId: postComments.postId,
            authorId: postComments.authorId,
            hidden: postComments.hidden,
            deletedAt: postComments.deletedAt,
          })
          .from(postComments)
          .where(eq(postComments.id, id))
          .limit(1);
        if (!c || c.deletedAt || (c.hidden && c.authorId !== viewerId)) return false;
        if (c.authorId !== viewerId && (await this.privacy.isBlockedEitherWay(viewerId, c.authorId))) return false;
        return (await this.posts.findVisible(viewerId, [], c.postId)) !== null;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const [r] = await this.db.select({ a: postComments.authorId }).from(postComments).where(eq(postComments.id, id)).limit(1);
        return r?.a ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.update(postComments).set({ hidden }).where(eq(postComments.id, id));
      },
    });

    this.registry.register('user', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const [u] = await this.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, id), eq(users.status, 'active')))
          .limit(1);
        if (!u) return false;
        return id === viewerId || !(await this.privacy.isBlockedEitherWay(viewerId, id));
      },
      authorOf: (id) => Promise.resolve(UUID_RE.test(id) ? id : null),
      // Documented no-op: an account is sanctioned through its status (admin tooling), never "hidden" like content.
      setHidden: () => Promise.resolve(),
    });
  }
}

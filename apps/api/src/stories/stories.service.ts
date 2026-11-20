import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type CreateStoryRequest,
  STORY_FEED_AUTHORS_MAX,
  type Story,
  type StoryFeed,
  type StoryList,
  type StoryPage,
  type StoryPageQuery,
  type StoryViewerList,
} from '@caselind/contracts';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { mediaAssets, type StoryRow, stories, storyViews, users } from '../db/schema.js';
import { contentUrlOf } from '../media/media.service.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { RelationsService } from '../social/relations.service.js';
import { decodeCursor, encodeCursor, UUID_RE, validationError } from './cursor.js';
import { PublishGuard } from '../platform-ops/publish.guard.js';
import { StoryAccessService } from './story-access.js';

const storyNotFound = () => AppError.notFound('Story not found');
const MAX_STORIES_PER_USER_LIST = 100;
const FEED_STORIES_MAX = 1000;

/** Ephemeral stories. Captions never reach logs or audit. */
@Injectable()
export class StoriesService implements OnModuleInit {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly access: StoryAccessService,
    private readonly relations: RelationsService,
    private readonly privacy: PrivacyService,
    private readonly moderation: ModerationRegistry,
    private readonly publishGuard: PublishGuard,
  ) {}

  onModuleInit(): void {
    this.moderation.register('story', {
      visibleTo: async (viewerId, targetId) => {
        const story = await this.access.findById(targetId);
        return story ? this.access.canView(viewerId, story) : false;
      },
      authorOf: async (targetId) => (await this.access.findById(targetId))?.authorId ?? null,
      setHidden: async (targetId, hidden) => {
        if (!UUID_RE.test(targetId)) return;
        await this.db
          .update(stories)
          .set({ hiddenAt: hidden ? sql`COALESCE(${stories.hiddenAt}, now())` : null })
          .where(eq(stories.id, targetId));
        this.logger.log({ storyId: targetId, hidden }, 'story visibility changed by moderation');
      },
    });
  }

  /* ------------------------------------------------------------------ create / delete */

  /** Idempotent per (author, clientId): a retry returns the stored story (created=false). */
  async create(userId: string, req: CreateStoryRequest): Promise<{ story: Story; created: boolean }> {
    const existing = await this.findByClientId(userId, req.clientId);
    if (existing) return { story: (await this.toStories([existing], userId))[0]!, created: false };
    await this.publishGuard.assertMayPublish(userId, 'story');

    const [asset] = await this.db
      .select({ ownerUserId: mediaAssets.ownerUserId, purpose: mediaAssets.purpose, status: mediaAssets.status })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, req.mediaId))
      .limit(1);
    if (!asset || asset.ownerUserId !== userId || asset.purpose !== 'story' || asset.status !== 'ready') {
      throw validationError('mediaId', 'must be one of your ready uploads with purpose "story"');
    }
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.env.STORY_TTL_HOURS * 3_600_000);
    try {
      const [row] = await this.db
        .insert(stories)
        .values({
          authorId: userId,
          clientId: req.clientId,
          mediaId: req.mediaId,
          caption: req.caption ? req.caption : null,
          visibility: req.visibility,
          createdAt,
          expiresAt,
        })
        .returning();
      return { story: (await this.toStories([row!], userId))[0]!, created: true };
    } catch (err) {
      const pg = ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
      if (pg.code === '23505') {
        if (pg.constraint === 'stories_author_client_unique') {
          const again = await this.findByClientId(userId, req.clientId);
          if (again) return { story: (await this.toStories([again], userId))[0]!, created: false };
        }
        throw validationError('mediaId', 'this upload already backs a story');
      }
      if (pg.code === '23503') throw validationError('mediaId', 'must be one of your ready uploads with purpose "story"');
      throw err;
    }
  }

  private async findByClientId(userId: string, clientId: string): Promise<StoryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(stories)
      .where(and(eq(stories.authorId, userId), eq(stories.clientId, clientId)))
      .limit(1);
    return row;
  }

  /** Author only; anyone else gets a 404. The media file is left to the author (media routes). */
  async remove(userId: string, storyId: string): Promise<void> {
    if (!UUID_RE.test(storyId)) throw storyNotFound();
    const deleted = await this.db
      .delete(stories)
      .where(and(eq(stories.id, storyId), eq(stories.authorId, userId)))
      .returning({ id: stories.id });
    if (deleted.length === 0) throw storyNotFound();
  }

  /* ------------------------------------------------------------------ reading */

  /** The stories bar: caller first, then followed authors (unseen first, then newest), max 100 authors. */
  async feed(userId: string): Promise<StoryFeed> {
    // One query: own stories, then those of followed authors; the audience rule (followers / friends =
    // mutual follow) is evaluated in SQL, so the cost does not grow with the number of authors.
    const rows = await this.db
      .select({ story: stories })
      .from(stories)
      .innerJoin(users, and(eq(users.id, stories.authorId), eq(users.status, 'active')))
      .where(
        and(
          sql`(${stories.authorId} = ${userId} OR ${stories.authorId} IN (SELECT followee_id FROM follows WHERE follower_id = ${userId}))`,
          gt(stories.expiresAt, new Date()),
          sql`(${stories.hiddenAt} IS NULL OR ${stories.authorId} = ${userId})`,
          sql`(${stories.authorId} = ${userId} OR (
            NOT EXISTS (
              SELECT 1 FROM user_blocks b
              WHERE (b.blocker_id = ${userId} AND b.blocked_id = ${stories.authorId})
                 OR (b.blocker_id = ${stories.authorId} AND b.blocked_id = ${userId}))
            AND (${stories.visibility} = 'followers'
                 OR EXISTS (SELECT 1 FROM follows f2 WHERE f2.follower_id = ${stories.authorId} AND f2.followee_id = ${userId}))))`,
        ),
      )
      .orderBy(desc(stories.createdAt))
      .limit(FEED_STORIES_MAX);
    const visible: StoryRow[] = rows.map((r) => r.story);
    visible.reverse(); // oldest first within each author
    const dtos = await this.toStories(visible, userId);
    const byAuthor = new Map<string, Story[]>();
    for (const s of dtos) byAuthor.set(s.authorId, [...(byAuthor.get(s.authorId) ?? []), s]);
    const ids = [...byAuthor.keys()];
    const authors = await this.loadAuthors(ids);
    const groups = ids
      .filter((id) => authors.has(id))
      .map((id) => {
        const list = byAuthor.get(id)!;
        return { author: authors.get(id)!, stories: list, hasUnseen: list.some((s) => !s.seen), latest: list.at(-1)!.createdAt };
      });
    groups.sort((a, b) => {
      if (a.author.userId === userId) return -1;
      if (b.author.userId === userId) return 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return b.latest.localeCompare(a.latest);
    });
    return { items: groups.slice(0, STORY_FEED_AUTHORS_MAX).map(({ latest: _latest, ...g }) => g) };
  }

  /** Active, visible stories of one user (the caller's own included). Unknown or blocked user: 404. */
  async ofUser(viewerId: string, userId: string): Promise<StoryList> {
    if (!UUID_RE.test(userId)) throw AppError.notFound('User not found');
    if (userId !== viewerId) {
      const [target] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.status, 'active')))
        .limit(1);
      if (!target || (await this.privacy.isBlockedEitherWay(viewerId, userId))) throw AppError.notFound('User not found');
    }
    const rows = await this.db
      .select()
      .from(stories)
      .where(and(eq(stories.authorId, userId), gt(stories.expiresAt, new Date()), isNull(stories.hiddenAt)))
      .orderBy(stories.createdAt)
      .limit(MAX_STORIES_PER_USER_LIST);
    // The audience is the same for every story of one author: two lookups, not one per story.
    const mine = userId === viewerId;
    const follower = mine || (await this.relations.isFollowing(viewerId, userId));
    const friend = mine || (follower && (await this.relations.areFriends(viewerId, userId)));
    const visible = rows.filter((r) => (r.visibility === 'friends' ? friend : follower));
    return { items: await this.toStories(visible, viewerId) };
  }

  /** Personal archive: every story of the caller, expired or hidden ones included. Newest first. */
  async archive(userId: string, q: StoryPageQuery): Promise<StoryPage> {
    const filters = [eq(stories.authorId, userId)];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${stories.createdAt}, ${stories.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({ story: stories, exact: sql<string>`${stories.createdAt}::text` })
      .from(stories)
      .where(and(...filters))
      .orderBy(desc(stories.createdAt), desc(stories.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await this.toStories(
        page.map((r) => r.story),
        userId,
      ),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.exact, last.story.id) : null,
    };
  }

  /** Idempotent. The author's own views are not recorded. 404 when the story is not visible. */
  async view(userId: string, storyId: string): Promise<void> {
    const story = await this.access.findById(storyId);
    if (!story || !(await this.access.canView(userId, story))) throw storyNotFound();
    if (story.authorId === userId) return;
    await this.db.insert(storyViews).values({ storyId: story.id, viewerId: userId }).onConflictDoNothing();
  }

  /** Author only, newest viewers first. Anyone else gets a 404. */
  async viewers(userId: string, storyId: string, q: StoryPageQuery): Promise<StoryViewerList> {
    const story = await this.access.findById(storyId);
    if (!story || story.authorId !== userId) throw storyNotFound();
    const filters = [eq(storyViews.storyId, story.id)];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${storyViews.viewedAt}, ${storyViews.viewerId}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({
        userId: users.id,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        viewedAt: storyViews.viewedAt,
        exact: sql<string>`${storyViews.viewedAt}::text`,
      })
      .from(storyViews)
      .innerJoin(users, eq(users.id, storyViews.viewerId))
      .where(and(...filters))
      .orderBy(desc(storyViews.viewedAt), desc(storyViews.viewerId))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        userId: r.userId,
        handle: r.handle,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        viewedAt: r.viewedAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.exact, last.userId) : null,
    };
  }

  /* ------------------------------------------------------------------ helpers */

  private async loadAuthors(ids: string[]) {
    const map = new Map<string, { userId: string; handle: string; displayName: string; avatarUrl: string | null }>();
    if (ids.length === 0) return map;
    const rows = await this.db
      .select({ userId: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, ids));
    for (const r of rows) map.set(r.userId, r);
    return map;
  }

  /** DTOs with `seen` and, for the caller's own stories, the view count. */
  private async toStories(rows: StoryRow[], viewerId: string): Promise<Story[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const seenRows = await this.db
      .select({ storyId: storyViews.storyId })
      .from(storyViews)
      .where(and(inArray(storyViews.storyId, ids), eq(storyViews.viewerId, viewerId)));
    const seen = new Set(seenRows.map((r) => r.storyId));
    const ownIds = rows.filter((r) => r.authorId === viewerId).map((r) => r.id);
    const counts = new Map<string, number>();
    if (ownIds.length > 0) {
      const cRows = await this.db
        .select({ storyId: storyViews.storyId, n: sql<number>`count(*)::int` })
        .from(storyViews)
        .where(inArray(storyViews.storyId, ownIds))
        .groupBy(storyViews.storyId);
      for (const c of cRows) counts.set(c.storyId, c.n);
    }
    return rows.map((r) => ({
      id: r.id,
      authorId: r.authorId,
      mediaId: r.mediaId,
      mediaUrl: contentUrlOf(r.mediaId),
      caption: r.caption,
      visibility: r.visibility,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      seen: r.authorId === viewerId || seen.has(r.id),
      viewCount: r.authorId === viewerId ? (counts.get(r.id) ?? 0) : null,
    }));
  }
}

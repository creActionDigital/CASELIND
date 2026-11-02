import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { type StoryRow, stories, users } from '../db/schema.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { RelationsService } from '../social/relations.service.js';
import { UUID_RE } from './cursor.js';

/**
 * Single place for "who can see this story": used by the stories routes, the story media read
 * policy (media/access.ts) and moderation. Kept free of any import from the media module.
 */
@Injectable()
export class StoryAccessService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly privacy: PrivacyService,
    private readonly relations: RelationsService,
  ) {}

  /** The author sees everything of theirs. Others: active, not hidden, author active, not blocked, audience. */
  async canView(viewerId: string, story: StoryRow, now: Date = new Date()): Promise<boolean> {
    if (story.authorId === viewerId) return true;
    if (story.hiddenAt || story.expiresAt.getTime() <= now.getTime()) return false;
    const [author] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, story.authorId)).limit(1);
    if (author?.status !== 'active') return false;
    if (await this.privacy.isBlockedEitherWay(viewerId, story.authorId)) return false;
    return story.visibility === 'friends'
      ? this.relations.areFriends(viewerId, story.authorId)
      : this.relations.isFollowing(viewerId, story.authorId);
  }

  async findById(id: string): Promise<StoryRow | undefined> {
    if (!UUID_RE.test(id)) return undefined;
    const [row] = await this.db.select().from(stories).where(eq(stories.id, id)).limit(1);
    return row;
  }

  /** Media read policy: may `viewerId` read the content of the story that uses this media? */
  async canViewMedia(viewerId: string, mediaId: string): Promise<boolean> {
    const [row] = await this.db.select().from(stories).where(eq(stories.mediaId, mediaId)).limit(1);
    return row ? this.canView(viewerId, row) : false;
  }
}

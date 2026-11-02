import { sql } from 'drizzle-orm';
import { postVisibleSql } from '../social/post-visibility.js';
import { posts, postMedia, users } from '../db/schema.js';
import type { Db } from '../db/db.module.js';
import type { MediaAssetRow } from '../db/schema.js';
import type { StoryAccessService } from '../stories/story-access.js';

type Readable = Pick<MediaAssetRow, 'ownerUserId' | 'purpose'>;

/**
 * Static part of the media read policy (no query needed): who may read a READY asset's metadata
 * and content when the answer depends only on its owner and purpose.
 *
 * - Profile and catalogue images: any signed-in user.
 * - Post media, message attachments and stories: see canReadAsync. Documents: the owner only.
 */
export function canRead(viewerId: string, asset: Readable): boolean {
  if (asset.ownerUserId === viewerId) return true;
  switch (asset.purpose) {
    case 'avatar':
    case 'org_logo':
    case 'org_banner':
    case 'product':
      return true;
    case 'story':
    case 'post':
    case 'message':
    case 'document':
      return false;
  }
}

/**
 * The single place for the media read policy. Adds to `canRead` the message attachments: readable
 * by an active member of a conversation where the asset was sent in a message that was not
 * recalled and that the member is allowed to see (sent after they joined).
 */
export async function canReadAsync(
  db: Pick<Db, 'execute' | 'select'>,
  viewerId: string,
  asset: Readable & { id: string },
  stories?: Pick<StoryAccessService, 'canViewMedia'>,
): Promise<boolean> {
  if (canRead(viewerId, asset)) return true;
  // Stories: same rule as the story itself (audience, expiry, moderation, blocks).
  if (asset.purpose === 'story') return stories ? stories.canViewMedia(viewerId, asset.id) : false;
  // Posts: readable only through a post the viewer may see (audience, deletion, moderation, blocks).
  if (asset.purpose === 'post') {
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(postMedia)
      .innerJoin(posts, sql`${posts.id} = ${postMedia.postId}`)
      .innerJoin(users, sql`${users.id} = ${posts.authorId}`)
      .where(sql`${postMedia.mediaId} = ${asset.id} AND ${postVisibleSql(viewerId, [])}`)
      .limit(1);
    return row !== undefined;
  }
  if (asset.purpose !== 'message') return false;
  const res = await db.execute(sql`
    SELECT 1 FROM messages m
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${viewerId} AND cm.status = 'active'
    WHERE m.media_id = ${asset.id} AND m.recalled_at IS NULL AND m.seq >= cm.first_seq
    LIMIT 1`);
  return res.rows.length > 0;
}

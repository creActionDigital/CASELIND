import { sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import type { MediaAssetRow } from '../db/schema.js';

type Readable = Pick<MediaAssetRow, 'ownerUserId' | 'purpose'>;

/**
 * Static part of the media read policy (no query needed): who may read a READY asset's metadata
 * and content when the answer depends only on its owner and purpose.
 *
 * - Profile and catalogue images, posts and stories: any signed-in user (their visibility rules,
 *   e.g. blocks or private posts, belong to the lots that publish them).
 * - Message attachments: see canReadAsync. Documents: the owner only.
 */
export function canRead(viewerId: string, asset: Readable): boolean {
  if (asset.ownerUserId === viewerId) return true;
  switch (asset.purpose) {
    case 'avatar':
    case 'org_logo':
    case 'org_banner':
    case 'product':
    case 'post':
    case 'story':
      return true;
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
export async function canReadAsync(db: Pick<Db, 'execute'>, viewerId: string, asset: Readable & { id: string }): Promise<boolean> {
  if (canRead(viewerId, asset)) return true;
  if (asset.purpose !== 'message') return false;
  const res = await db.execute(sql`
    SELECT 1 FROM messages m
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${viewerId} AND cm.status = 'active'
    WHERE m.media_id = ${asset.id} AND m.recalled_at IS NULL AND m.seq >= cm.first_seq
    LIMIT 1`);
  return res.rows.length > 0;
}

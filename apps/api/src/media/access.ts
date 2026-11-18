import { sql } from 'drizzle-orm';
import { postVisibleSql } from '../social/post-visibility.js';
import { posts, postMedia, users } from '../db/schema.js';
import type { Db } from '../db/db.module.js';
import type { MediaAssetRow } from '../db/schema.js';
import type { OrgRole } from '@caselind/contracts';
import { roleHasPermission } from '../orgs/org-permissions.js';
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
    case 'listing':
    case 'org_gallery':
      return true;
    case 'story':
    case 'post':
    case 'message':
    case 'document':
    // Identity documents (lot 6B): owner only here; admins are added in canReadAsync.
    case 'kyc_document':
    // Lot 19m: owner here; the other readers are resolved in canReadAsync.
    case 'cv':
    case 'delivery':
    case 'lesson':
      return false;
  }
}

/**
 * The single place for the media read policy. Adds to `canRead` the message attachments: readable
 * by an active member of a conversation where the asset was sent in a message that was not
 * recalled or expired and that the member is allowed to see (sent after they joined). A forwarded media
 * is a new message pointing at the same asset, so it is covered by this same query: the members of the
 * destination can read it.
 */
export async function canReadAsync(
  db: Pick<Db, 'execute' | 'select'>,
  viewerId: string,
  asset: Readable & { id: string },
  stories?: Pick<StoryAccessService, 'canViewMedia'>,
): Promise<boolean> {
  if (canRead(viewerId, asset)) return true;
  // Identity documents: platform admins (KYC review) in addition to the owner, and only files attached to a
  // submission (an upload that was never submitted is not under review).
  if (asset.purpose === 'kyc_document') {
    const res = await db.execute(sql`
      SELECT 1 FROM users WHERE id = ${viewerId} AND status = 'active' AND 'admin' = ANY(roles)
        AND EXISTS (SELECT 1 FROM kyc_submissions WHERE ${asset.id}::uuid = ANY(document_ids)) LIMIT 1`);
    return res.rows.length > 0;
  }
  // CV PDF: members of an organisation (hr.manage) that received an application carrying it (snapshot).
  if (asset.purpose === 'cv') {
    const res = await db.execute<{ role: string }>(sql`
      SELECT DISTINCT om.role FROM job_applications a JOIN job_postings j ON j.id = a.posting_id
      JOIN org_members om ON om.org_id = j.org_id AND om.user_id = ${viewerId}::uuid AND om.status = 'active'
      WHERE a.cv_media_id = ${asset.id}::uuid`);
    return res.rows.some((r) => roleHasPermission(r.role as OrgRole, 'hr.manage'));
  }
  // Delivery files: the two parties of the contract.
  if (asset.purpose === 'delivery') {
    const res = await db.execute(sql`
      SELECT 1 FROM milestone_files f JOIN contract_milestones ms ON ms.id = f.milestone_id JOIN freelance_contracts c ON c.id = ms.contract_id
      WHERE f.media_id = ${asset.id}::uuid AND (c.client_id = ${viewerId}::uuid OR c.freelancer_id = ${viewerId}::uuid) LIMIT 1`);
    return res.rows.length > 0;
  }
  // Lesson files: the author of the course and its enrolled learners.
  if (asset.purpose === 'lesson') {
    const res = await db.execute(sql`
      SELECT 1 FROM lesson_files f JOIN course_lessons l ON l.id = f.lesson_id JOIN courses c ON c.id = l.course_id
      WHERE f.media_id = ${asset.id}::uuid AND (c.author_id = ${viewerId}::uuid
        OR EXISTS (SELECT 1 FROM course_enrollments e WHERE e.course_id = c.id AND e.user_id = ${viewerId}::uuid)) LIMIT 1`);
    return res.rows.length > 0;
  }
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
      AND (m.expires_at IS NULL OR m.expires_at > now())
    LIMIT 1`);
  return res.rows.length > 0;
}

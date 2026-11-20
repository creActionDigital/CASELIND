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
    // Digital product files: owner here; buyers of a delivered order and catalogue managers in canReadAsync.
    case 'digital_file':
    // Lot 8: the courier (owner) here; the buyer and the seller's order viewers in canReadAsync.
    case 'delivery_proof':
    // Lot 18d: the patient (owner) here; a professional with an active share covering results in canReadAsync.
    case 'health_result':
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
  // Digital product files: buyers of a delivered order containing the product, and the seller's catalogue managers.
  if (asset.purpose === 'digital_file') {
    const buyer = await db.execute(sql`
      SELECT 1 FROM product_files pf JOIN order_items oi ON oi.product_id = pf.product_id JOIN orders o ON o.id = oi.order_id
      WHERE pf.media_id = ${asset.id}::uuid AND o.buyer_id = ${viewerId}::uuid AND o.status = 'delivered' LIMIT 1`);
    if (buyer.rows.length > 0) return true;
    const staff = await db.execute<{ role: string }>(sql`
      SELECT DISTINCT om.role FROM product_files pf JOIN products p ON p.id = pf.product_id
      JOIN org_members om ON om.org_id = p.org_id AND om.user_id = ${viewerId}::uuid AND om.status = 'active'
      WHERE pf.media_id = ${asset.id}::uuid`);
    return staff.rows.some((r) => roleHasPermission(r.role as OrgRole, 'catalog.manage'));
  }
  // Delivery files: the two parties of the contract.
  if (asset.purpose === 'delivery') {
    const res = await db.execute(sql`
      SELECT 1 FROM milestone_files f JOIN contract_milestones ms ON ms.id = f.milestone_id JOIN freelance_contracts c ON c.id = ms.contract_id
      WHERE f.media_id = ${asset.id}::uuid AND (c.client_id = ${viewerId}::uuid OR c.freelancer_id = ${viewerId}::uuid) LIMIT 1`);
    return res.rows.length > 0;
  }
  // Proof of delivery: the buyer of the order, and the members of the selling organisation who may view orders.
  if (asset.purpose === 'delivery_proof') {
    const res = await db.execute<{ buyer_id: string; role: string | null }>(sql`
      SELECT d.buyer_id, om.role FROM delivery_proofs p JOIN deliveries d ON d.id = p.delivery_id
      LEFT JOIN org_members om ON om.org_id = d.org_id AND om.user_id = ${viewerId}::uuid AND om.status = 'active'
      WHERE p.media_id = ${asset.id}::uuid`);
    return res.rows.some((r) => r.buyer_id === viewerId || (r.role !== null && roleHasPermission(r.role as OrgRole, 'orders.view')));
  }
  // Exam result report: owned by the patient; an approved professional with an active, unexpired share covering `results`
  // while the patient still consents. Only a file attached to a result counts.
  if (asset.purpose === 'health_result') {
    const res = await db.execute(sql`
      SELECT 1 FROM health_results r JOIN health_shares s ON s.patient_id = r.user_id AND s.professional_id = ${viewerId}::uuid
      JOIN health_professionals p ON p.user_id = s.professional_id AND p.status = 'approved'
      JOIN health_consents c ON c.user_id = r.user_id
      WHERE r.media_id = ${asset.id}::uuid AND s.revoked_at IS NULL AND s.expires_at > now() AND 'results' = ANY(s.kinds) LIMIT 1`);
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

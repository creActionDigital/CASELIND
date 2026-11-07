import { sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';

/**
 * The org member buyers are pointed to for support: the member chosen by the org (`support_user_id`)
 * while still an active member of an active account, else the oldest active owner.
 *
 * Returns null when there is none, when it is the viewer, or when the viewer and that member are blocked
 * either way (a blocked pair cannot open a conversation anyway, and the block must not leak through it).
 * `viewerId` null = anonymous (storefront without a token): always null, since blocks cannot be checked.
 */
export async function resolveContactUserId(db: Pick<Db, 'execute'>, orgId: string, viewerId: string | null): Promise<string | null> {
  // Anonymous callers get nothing: a blocked member could otherwise read the id by logging out.
  if (!viewerId) return null;
  const res = await db.execute(sql`
    SELECT om.user_id::text AS id
    FROM org_members om
    JOIN organizations o ON o.id = om.org_id
    JOIN users u ON u.id = om.user_id AND u.status = 'active'
    WHERE om.org_id = ${orgId}::uuid
      AND om.status = 'active'
      AND (om.user_id = o.support_user_id OR om.role = 'owner')
    ORDER BY (om.user_id IS NOT DISTINCT FROM o.support_user_id) DESC, om.joined_at ASC NULLS LAST, om.user_id
    LIMIT 1`);
  const id = (res.rows as { id: string }[])[0]?.id ?? null;
  if (!id) return null;
  if (id === viewerId) return null;
  const blocked = await db.execute(sql`
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = ${viewerId}::uuid AND blocked_id = ${id}::uuid)
       OR (blocker_id = ${id}::uuid AND blocked_id = ${viewerId}::uuid)
    LIMIT 1`);
  return blocked.rows.length > 0 ? null : id;
}

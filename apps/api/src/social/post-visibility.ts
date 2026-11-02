import type { PlatformRole } from '@caselind/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { posts, users } from '../db/schema.js';

export const isPrivileged = (roles: readonly PlatformRole[]): boolean => roles.includes('admin') || roles.includes('moderator');

/**
 * The post visibility matrix, as SQL over `posts` joined with the author (`users`).
 * Author: always (own deleted posts excepted). Others: not deleted, active author, not blocked
 * either way, not hidden by moderation (moderators/admins excepted), and
 *   public = anyone; followers = the viewer follows the author; friends = mutual follow;
 *   private = author only.
 * Shared by the post routes and the post media read policy (media/access.ts).
 */
export function postVisibleSql(viewerId: string, roles: readonly PlatformRole[]): SQL {
  return sql`(
    ${posts.deletedAt} IS NULL AND ${users.status} = 'active' AND (
      ${posts.authorId} = ${viewerId}::uuid
      OR (
        ${isPrivileged(roles) ? sql`true` : sql`NOT ${posts.hidden}`}
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = ${posts.authorId})
             OR (b.blocker_id = ${posts.authorId} AND b.blocked_id = ${viewerId}::uuid))
        AND (
          ${posts.visibility} = 'public'
          OR (
            ${posts.visibility} IN ('followers', 'friends')
            AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId}::uuid AND f.followee_id = ${posts.authorId})
            AND (${posts.visibility} = 'followers'
                 OR EXISTS (SELECT 1 FROM follows f2 WHERE f2.follower_id = ${posts.authorId} AND f2.followee_id = ${viewerId}::uuid))
          )
        )
      )
    )
  )`;
}

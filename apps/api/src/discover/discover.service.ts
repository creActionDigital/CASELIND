import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  type RecommendedMerchants,
  type RecommendedPeople,
} from '@caselind/contracts';
import { DB, type Db } from '../db/db.module.js';

/** Accueil (profils et commerçants recommandés). */
@Injectable()
export class DiscoverService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Active accounts the caller does not follow yet and has no block with, friends-of-friends first, then most followed. */
  async people(userId: string, limit: number): Promise<RecommendedPeople> {
    const res = await this.db.execute<{
      id: string;
      handle: string;
      display_name: string;
      avatar_url: string | null;
      bio: string | null;
      followers: number;
      mutual: number;
    }>(sql`
      SELECT u.id, u.handle::text AS handle, u.display_name, u.avatar_url, u.bio,
             (SELECT count(*)::int FROM follows f WHERE f.followee_id = u.id) AS followers,
             (SELECT count(*)::int FROM follows a JOIN follows b ON b.follower_id = a.followee_id
               WHERE a.follower_id = ${userId}::uuid AND b.followee_id = u.id) AS mutual
        FROM users u
       WHERE u.status = 'active' AND u.id <> ${userId}::uuid
         AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${userId}::uuid AND f.followee_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM user_blocks b
               WHERE (b.blocker_id = ${userId}::uuid AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ${userId}::uuid))
       ORDER BY mutual DESC, followers DESC, u.created_at DESC
       LIMIT ${limit}`);
    return {
      items: res.rows.map((r) => ({
        userId: r.id,
        handle: r.handle,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        bio: r.bio,
        followersCount: r.followers,
        mutualCount: r.mutual,
      })),
    };
  }

  /** Public, active businesses: verified first, then newest. */
  async merchants(limit: number): Promise<RecommendedMerchants> {
    const res = await this.db.execute<{
      id: string;
      slug: string;
      name: string;
      kind: string;
      logo_url: string | null;
      city: string | null;
      verified: boolean;
    }>(sql`
      SELECT id, slug::text AS slug, name, kind, logo_url, city, (verification_status = 'verified') AS verified
        FROM organizations
       WHERE status = 'active' AND visibility = 'public'
       ORDER BY (verification_status = 'verified') DESC, created_at DESC
       LIMIT ${limit}`);
    return {
      items: res.rows.map((r) => ({ orgId: r.id, slug: r.slug, name: r.name, kind: r.kind, logoUrl: r.logo_url, city: r.city, verified: r.verified })),
    };
  }

}

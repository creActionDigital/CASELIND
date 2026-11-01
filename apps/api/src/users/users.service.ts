import { Inject, Injectable } from '@nestjs/common';
import type { Me, PublicProfile, SecurityEvent, UpdateMeRequest } from '@caselind/contracts';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { auditEvents, users, type UserRow } from '../db/schema.js';
import { PrivacyService } from '../privacy/privacy.service.js';

function toMe(u: UserRow): Me {
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    email: u.email,
    phone: u.phone,
    locale: u.locale as Me['locale'],
    country: u.country,
    roles: u.roles as Me['roles'],
    status: u.status,
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly privacy: PrivacyService,
  ) {}

  async me(userId: string): Promise<Me> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw AppError.notFound('User not found');
    return toMe(u);
  }

  async updateMe(userId: string, patch: UpdateMeRequest, meta: RequestMeta): Promise<Me> {
    try {
      const [u] = await this.db.update(users).set(patch).where(eq(users.id, userId)).returning();
      if (!u) throw AppError.notFound('User not found');
      await this.audit.record({
        action: 'user.profile_updated',
        actorUserId: userId,
        meta,
        metadata: { fields: Object.keys(patch) },
      });
      return toMe(u);
    } catch (err) {
      const pgErr = ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
      if (pgErr.code === '23505' && pgErr.constraint === 'users_handle_key') {
        throw AppError.conflict('This handle is already taken', { field: 'handle' });
      }
      throw err;
    }
  }

  /**
   * Only active accounts without a pending deletion request are visible, and never across a block (in either direction);
   * anything else is indistinguishable from "not found".
   */
  async publicProfile(handle: string, viewerId: string): Promise<PublicProfile> {
    const [u] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.handle, handle), eq(users.status, 'active'), isNull(users.deletionRequestedAt)))
      .limit(1);
    if (!u) throw AppError.notFound('Profile not found');
    if (u.id !== viewerId && (await this.privacy.isBlockedEitherWay(viewerId, u.id))) {
      throw AppError.notFound('Profile not found');
    }
    return { id: u.id, handle: u.handle, displayName: u.displayName, bio: u.bio, avatarUrl: u.avatarUrl };
  }

  async securityEvents(userId: string, limit = 50): Promise<SecurityEvent[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.subjectUserId, userId))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id.toString(),
      action: r.action,
      occurredAt: r.occurredAt.toISOString(),
      ip: r.ip,
      userAgent: r.userAgent,
    }));
  }
}

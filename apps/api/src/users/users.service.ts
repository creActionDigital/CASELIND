import { Inject, Injectable } from '@nestjs/common';
import type { MatchContactsResponse, Me, PublicProfile, SecurityEvent, UpdateMeRequest } from '@caselind/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { auditEvents, userTotp, users, type UserRow } from '../db/schema.js';
import { PrivacyService } from '../privacy/privacy.service.js';

function toMe(u: UserRow, twoFactorEnabled: boolean): Me {
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
    twoFactorEnabled,
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
    return toMe(u, await this.hasTotp(userId));
  }

  async matchContacts(viewerId: string, phones: string[]): Promise<MatchContactsResponse> {
    const list = [...new Set(phones)];
    const res = await this.db.execute(sql`
      SELECT u.id, u.handle::text AS handle, u.display_name, u.avatar_url FROM users u
      WHERE u.phone IN (${sql.join(list.map((p) => sql`${p}`), sql`, `)}) AND u.discoverable_by_phone AND u.status = 'active' AND u.id <> ${viewerId}::uuid
        AND NOT EXISTS (SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ${viewerId}::uuid))
      ORDER BY lower(u.display_name) LIMIT 500`);
    const rows = res.rows as unknown as { id: string; handle: string; display_name: string; avatar_url: string | null }[];
    return { items: rows.map((r) => ({ id: r.id, handle: r.handle, displayName: r.display_name, avatarUrl: r.avatar_url })) };
  }

  private async hasTotp(userId: string): Promise<boolean> {
    const [t] = await this.db.select({ at: userTotp.enabledAt }).from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
    return !!t?.at;
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
      return toMe(u, await this.hasTotp(userId));
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
      .where(and(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handle) ? eq(users.id, handle) : eq(users.handle, handle), eq(users.status, 'active'), isNull(users.deletionRequestedAt)))
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

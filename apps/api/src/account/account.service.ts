import { Inject, Injectable } from '@nestjs/common';
import {
  type AccountExport,
  type DeletionRequestResponse,
  ErrorCodes,
  type LastOwnerConflictDetails,
  type MediaMime,
} from '@caselind/contracts';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { auditEvents, mediaAssets, organizations, orgMembers, sessions, users } from '../db/schema.js';
import { contentUrlOf } from '../media/media.service.js';
import type { Tx } from '../orgs/orgs.service.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import { PasswordService } from '../security/password.service.js';
import { UsersService } from '../users/users.service.js';

const DAY_MS = 86_400_000;

/** Right of access (export) and right of erasure (deletion request) for the signed-in user. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly passwords: PasswordService,
    private readonly users: UsersService,
    private readonly privacy: PrivacyService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Everything held about the caller. Columns are selected explicitly so that password hashes,
   * refresh-token hashes, OTP codes and audit metadata can never leak into the export.
   */
  async export(auth: AuthUser, meta: RequestMeta): Promise<AccountExport> {
    const [profile, privacy, blocks] = await Promise.all([
      this.users.me(auth.userId),
      this.privacy.getSettings(auth.userId),
      this.privacy.listBlocks(auth.userId),
    ]);
    const sessionRows = await this.db
      .select({
        id: sessions.id,
        deviceName: sessions.deviceName,
        platform: sessions.platform,
        ip: sessions.ip,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, auth.userId))
      .orderBy(desc(sessions.createdAt));
    const eventRows = await this.db
      .select({
        action: auditEvents.action,
        occurredAt: auditEvents.occurredAt,
        ip: auditEvents.ip,
        userAgent: auditEvents.userAgent,
      })
      .from(auditEvents)
      .where(eq(auditEvents.subjectUserId, auth.userId))
      .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id));
    // Memberships and pending invitations, with the org's public identity only.
    const membershipRows = await this.db
      .select({
        orgId: orgMembers.orgId,
        slug: organizations.slug,
        name: organizations.name,
        role: orgMembers.role,
        status: orgMembers.status,
        joinedAt: orgMembers.joinedAt,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(eq(orgMembers.userId, auth.userId))
      .orderBy(asc(orgMembers.createdAt), asc(orgMembers.orgId));
    // Never the storage key (internal object location) nor the checksum.
    const mediaRows = await this.db
      .select({
        id: mediaAssets.id,
        purpose: mediaAssets.purpose,
        mime: mediaAssets.mime,
        sizeBytes: mediaAssets.sizeBytes,
        status: mediaAssets.status,
        createdAt: mediaAssets.createdAt,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.ownerUserId, auth.userId))
      .orderBy(asc(mediaAssets.createdAt), asc(mediaAssets.id));

    const result: AccountExport = {
      exportedAt: new Date().toISOString(),
      profile,
      privacy,
      sessions: sessionRows.map((s) => ({
        id: s.id,
        deviceName: s.deviceName,
        platform: s.platform,
        ip: s.ip,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        revokedAt: s.revokedAt?.toISOString() ?? null,
      })),
      blocks,
      securityEvents: eventRows.map((e) => ({
        action: e.action,
        occurredAt: e.occurredAt.toISOString(),
        ip: e.ip,
        userAgent: e.userAgent,
      })),
      orgMemberships: membershipRows.map((m) => ({
        orgId: m.orgId,
        slug: m.slug,
        name: m.name,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt?.toISOString() ?? null,
      })),
      media: mediaRows.map((m) => ({
        id: m.id,
        purpose: m.purpose,
        mime: (m.mime as MediaMime | null) ?? null,
        sizeBytes: m.sizeBytes,
        status: m.status,
        contentUrl: m.status === 'ready' ? contentUrlOf(m.id) : null,
        createdAt: m.createdAt.toISOString(),
      })),
    };
    await this.audit.record({
      action: 'user.data_exported',
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      meta,
    });
    return result;
  }

  /**
   * Schedules the deletion after ACCOUNT_DELETION_GRACE_DAYS and signs the user out everywhere.
   * A wrong password is a plain 401: it does not count towards the login lockout (the caller
   * already holds a valid session; the global rate limit still applies).
   *
   * Refused with 409 `last_owner` (nothing changes) while the caller is the last active owner of an
   * active organisation: ownership must be transferred (or another owner added) first, otherwise
   * the purge would leave the org without an owner. See lastOwnedOrgs for the locking.
   */
  async requestDeletion(auth: AuthUser, password: string, meta: RequestMeta): Promise<DeletionRequestResponse> {
    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    if (!user) throw AppError.unauthenticated();
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new AppError(401, ErrorCodes.invalidCredentials, 'Incorrect password');
    }

    const requestedAt = new Date();
    await this.db.transaction(async (tx) => {
      const orphaned = await this.lastOwnedOrgs(tx, auth.userId);
      if (orphaned.length > 0) {
        const details: LastOwnerConflictDetails = { reason: 'last_owner', orgs: orphaned };
        throw AppError.conflict(
          'You are the last owner of one or more organizations: transfer ownership or add another owner first',
          details,
        );
      }
      await tx.update(users).set({ deletionRequestedAt: requestedAt }).where(eq(users.id, auth.userId));
      await tx
        .update(sessions)
        .set({ revokedAt: requestedAt, revokeReason: 'account_deletion_requested' })
        .where(and(eq(sessions.userId, auth.userId), isNull(sessions.revokedAt)));
    });
    const deletionScheduledFor = new Date(requestedAt.getTime() + this.env.ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
    await this.audit.record({
      action: 'user.deletion_requested',
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      meta,
      metadata: { deletionScheduledFor: deletionScheduledFor.toISOString() },
    });
    return { deletionScheduledFor: deletionScheduledFor.toISOString() };
  }

  /**
   * Active organisations of which `userId` is the only eligible active owner (same definition as
   * OrgMembersService.hasOtherActiveOwner: co-owners with a pending deletion or an inactive account
   * do not count).
   *
   * Locking: every org the user actively owns is first locked FOR UPDATE, in id order, before the
   * user row is written. OrgMembersService locks the org row before anything else (and
   * assertOwnerQuota locks the user row after it), so this keeps the same org -> user order (no
   * deadlock) and serialises with concurrent role changes, removals and acceptances in those orgs.
   * The owner count runs in a second statement so it sees everything committed before the locks
   * were granted (READ COMMITTED takes a new snapshot per statement).
   *
   * Suspended orgs never block: their members are read-only (ownership cannot be transferred), so
   * blocking would make deletion impossible. The purge records them as orphaned instead.
   */
  private async lastOwnedOrgs(tx: Tx, userId: string): Promise<LastOwnerConflictDetails['orgs']> {
    await tx.execute(sql`
      SELECT o.id FROM organizations o
      JOIN org_members m ON m.org_id = o.id
      WHERE m.user_id = ${userId} AND m.role = 'owner' AND m.status = 'active'
      ORDER BY o.id
      FOR UPDATE OF o`);
    const res = await tx.execute<{ id: string; slug: string; name: string }>(sql`
      SELECT o.id, o.slug::text AS slug, o.name FROM organizations o
      JOIN org_members m ON m.org_id = o.id
      WHERE m.user_id = ${userId} AND m.role = 'owner' AND m.status = 'active' AND o.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM org_members m2 JOIN users u ON u.id = m2.user_id
          WHERE m2.org_id = o.id AND m2.user_id <> ${userId} AND m2.role = 'owner' AND m2.status = 'active'
            AND u.status = 'active' AND u.deletion_requested_at IS NULL
        )
      ORDER BY o.slug`);
    return res.rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
  }
}

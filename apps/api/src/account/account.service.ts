import { Inject, Injectable } from '@nestjs/common';
import {
  type AccountExport,
  type DeletionRequestResponse,
  ErrorCodes,
} from '@caselind/contracts';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { auditEvents, sessions, users } from '../db/schema.js';
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
}

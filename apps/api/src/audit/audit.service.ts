import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { auditEvents } from '../db/schema.js';

export type AuditAction =
  | 'auth.register'
  | 'auth.register_existing_identifier'
  | 'auth.otp_verified'
  | 'auth.otp_failed'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.account_locked'
  | 'auth.refresh_token_reuse'
  | 'auth.logout'
  | 'auth.session_revoked'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.deletion_cancelled'
  | 'user.profile_updated'
  | 'user.privacy_updated'
  | 'user.blocked'
  | 'user.unblocked'
  | 'user.data_exported'
  | 'user.deletion_requested'
  | 'user.deleted'
  | 'admin.flag_updated'
  | 'media.uploaded'
  | 'media.rejected'
  | 'media.deleted'
  | 'user.avatar_updated'
  | 'org.created'
  | 'org.updated'
  | 'org.member_invited'
  | 'org.invitation_accepted'
  | 'org.invitation_declined'
  | 'org.member_role_changed'
  | 'org.member_removed'
  /** System (maintenance): the org's last active owner was purged; metadata.orgId. */
  | 'org.suspended_orphaned';

export interface AuditInput {
  action: AuditAction;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  sessionId?: string | null;
  meta?: RequestMeta;
  /** Never put secrets (passwords, codes, tokens) here. */
  metadata?: Record<string, unknown>;
}

/** Writes to the append-only audit_events table (UPDATE/DELETE are rejected by a DB trigger). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@Inject(DB) private readonly db: Db) {}

  /** `executor`: pass a transaction so the audit row commits (or rolls back) with the change. */
  async record(input: AuditInput, executor: Pick<Db, 'insert'> = this.db): Promise<void> {
    await executor.insert(auditEvents).values({
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      subjectUserId: input.subjectUserId ?? input.actorUserId ?? null,
      sessionId: input.sessionId ?? null,
      ip: input.meta?.ip ?? null,
      userAgent: input.meta?.userAgent ?? null,
      requestId: input.meta?.requestId ?? null,
      metadata: input.metadata ?? {},
    });
    this.logger.log({ action: input.action, subject: input.subjectUserId ?? input.actorUserId }, 'audit');
  }
}

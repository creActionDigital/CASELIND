import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type AdminApproval,
  type AdminApprovalList,
  type ApprovalKind,
  type ApprovalPending,
  type ApprovalStatus,
  grantPlatformRoleRequestSchema,
  issueSanctionRequestSchema,
  putSettingRequestSchema,
  setUserStatusRequestSchema,
  updateFeatureFlagRequestSchema,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { FlagsService } from '../flags/flags.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CommissionService } from '../platform-ops/commission.service.js';
import { SanctionsService } from '../platform-ops/sanctions.service.js';
import { SettingsService } from '../platform-ops/settings.service.js';
import { GovernanceService } from './governance.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

type Row = {
  id: string;
  kind: ApprovalKind;
  subject_id: string | null;
  payload: Record<string, unknown>;
  reason: string | null;
  status: ApprovalStatus;
  requested_by: string;
  requested_by_name: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  executed_at: Date | null;
  expires_at: Date;
  created_at: Date;
  expired: boolean;
};

const toApproval = (r: Row): AdminApproval => ({
  id: r.id,
  kind: r.kind,
  subjectId: r.subject_id,
  payload: r.payload,
  reason: r.reason,
  // Expiry is written by the maintenance run; a pending request past its deadline already reads as expired.
  status: r.status === 'pending' && r.expired ? 'expired' : r.status,
  requestedBy: r.requested_by,
  requestedByName: r.requested_by_name,
  decidedBy: r.decided_by,
  decidedByName: r.decided_by_name,
  decidedAt: iso(r.decided_at),
  executedAt: iso(r.executed_at),
  expiresAt: iso(r.expires_at)!,
  createdAt: iso(r.created_at)!,
});

export interface GuardInput {
  kind: ApprovalKind;
  subjectId: string | null;
  /** Ids and setting values only: never personal content. */
  payload: Record<string, unknown>;
  reason?: string | null;
  actorId: string;
  meta: RequestMeta;
  /** Runs only when the double validation is active (existence checks), so a request is never created for nothing. */
  precheck?: () => Promise<void>;
}

const SELECT = sql`
  SELECT a.id, a.kind, a.subject_id, a.payload, a.reason, a.status, a.requested_by, ru.display_name AS requested_by_name,
         a.decided_by, du.display_name AS decided_by_name, a.decided_at, a.executed_at, a.expires_at, a.created_at,
         (a.status = 'pending' AND a.expires_at <= now()) AS expired
  FROM admin_approvals a
  JOIN users ru ON ru.id = a.requested_by
  LEFT JOIN users du ON du.id = a.decided_by`;

/**
 * Double validation of sensitive administrator operations (CDC §17/§26). When active, `guard` turns the operation into a pending
 * request; ANOTHER administrator approves it (the operation then runs once, in the same transaction as the decision) or rejects it.
 * Requests expire after 24 hours. Audits and notifications carry kinds and ids only, never the payload content.
 */
@Injectable()
export class AdminApprovalsService implements OnModuleInit {
  private readonly logger = new Logger(AdminApprovalsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly flags: FlagsService,
    private readonly gov: GovernanceService,
    private readonly wallet: WalletService,
    private readonly sanctions: SanctionsService,
    private readonly settings: SettingsService,
    private readonly commissions: CommissionService,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === 'production' && this.env.ADMIN_DUAL_APPROVAL === 'false') {
      this.logger.warn('ADMIN_DUAL_APPROVAL=false in production: sensitive administrator operations run without a second administrator.');
    }
  }

  /** Read at each call so a change of configuration (or a test) applies at once. Default: on in production only. */
  isActive(): boolean {
    const v = this.env.ADMIN_DUAL_APPROVAL;
    return v ? v === 'true' : this.env.NODE_ENV === 'production';
  }

  /** `null` = mode inactive, the caller runs the operation. Otherwise the pending request (the caller answers 202). */
  async guard(i: GuardInput): Promise<ApprovalPending | null> {
    if (!this.isActive()) return null;
    await i.precheck?.();
    const payload = JSON.stringify(i.payload);
    const id = await this.db.transaction(async (tx) => {
      // Same administrator asking twice for the same thing: the same request, not a second one.
      const dup = await tx.execute<{ id: string }>(sql`
        SELECT id FROM admin_approvals
        WHERE status = 'pending' AND expires_at > now() AND kind = ${i.kind} AND subject_id IS NOT DISTINCT FROM ${i.subjectId}
          AND requested_by = ${i.actorId}::uuid AND payload = ${payload}::jsonb LIMIT 1`);
      if (dup.rows[0]) return dup.rows[0].id;
      const ins = await tx.execute<{ id: string }>(sql`
        INSERT INTO admin_approvals (kind, subject_id, payload, reason, requested_by)
        VALUES (${i.kind}, ${i.subjectId}, ${payload}::jsonb, ${i.reason ?? null}, ${i.actorId}::uuid) RETURNING id`);
      const approvalId = ins.rows[0]!.id;
      await this.audit.record({ action: 'admin.approval_requested', actorUserId: i.actorId, meta: i.meta, metadata: { approvalId, kind: i.kind, subjectId: i.subjectId } }, tx);
      return approvalId;
    });
    await this.notifyAdmins(i.actorId, id, i.kind);
    return { approvalId: id, status: 'pending' };
  }

  async list(status: ApprovalStatus | undefined, limit: number): Promise<AdminApprovalList> {
    // Read only: the effective status is computed here, the maintenance run writes the expiry.
    const where = !status
      ? sql``
      : status === 'expired'
        ? sql`WHERE (a.status = 'expired' OR (a.status = 'pending' AND a.expires_at <= now()))`
        : status === 'pending'
          ? sql`WHERE a.status = 'pending' AND a.expires_at > now()`
          : sql`WHERE a.status = ${status}`;
    const r = await this.db.execute<Row>(sql`${SELECT} ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit}`);
    return { items: r.rows.map(toApproval) };
  }

  /** Approves and executes in ONE transaction: if the operation fails, the request stays pending. */
  async approve(id: string, adminId: string, meta: RequestMeta): Promise<AdminApproval> {
    const out = await this.db.transaction(async (tx) => {
      const a = await this.lock(tx, id, adminId);
      if (a.expired) {
        await tx.execute(sql`UPDATE admin_approvals SET status = 'expired' WHERE id = ${id}::uuid`);
        return { expired: true as const };
      }
      const sanctionId = await this.execute(tx, a, meta);
      await tx.execute(sql`
        UPDATE admin_approvals SET status = 'executed', decided_by = ${adminId}::uuid, decided_at = now(), executed_at = now() WHERE id = ${id}::uuid`);
      const base = { approvalId: id, kind: a.kind, subjectId: a.subject_id };
      await this.audit.record({ action: 'admin.approval_decided', actorUserId: adminId, meta, metadata: { ...base, decision: 'approved' } }, tx);
      await this.audit.record({ action: 'admin.approval_executed', actorUserId: adminId, meta, metadata: base }, tx);
      return { expired: false as const, a, sanctionId, view: await this.get(tx, id) };
    });
    if (out.expired) throw AppError.conflict('This request has expired', { reason: 'expired' });
    await this.notifyRequester(out.a.requested_by, id, out.a.kind, 'approved');
    if (out.sanctionId) await this.sanctions.notifyIssued(out.a.subject_id ?? '', out.sanctionId);
    return out.view;
  }

  async reject(id: string, adminId: string, meta: RequestMeta): Promise<AdminApproval> {
    const out = await this.db.transaction(async (tx) => {
      const a = await this.lock(tx, id, adminId);
      if (a.expired) {
        await tx.execute(sql`UPDATE admin_approvals SET status = 'expired' WHERE id = ${id}::uuid`);
        return { expired: true as const };
      }
      await tx.execute(sql`UPDATE admin_approvals SET status = 'rejected', decided_by = ${adminId}::uuid, decided_at = now() WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'admin.approval_decided', actorUserId: adminId, meta, metadata: { approvalId: id, kind: a.kind, subjectId: a.subject_id, decision: 'rejected' } }, tx);
      return { expired: false as const, a, view: await this.get(tx, id) };
    });
    if (out.expired) throw AppError.conflict('This request has expired', { reason: 'expired' });
    await this.notifyRequester(out.a.requested_by, id, out.a.kind, 'rejected');
    return out.view;
  }

  /** The author withdraws a request that is still pending. */
  async cancel(id: string, adminId: string, meta: RequestMeta): Promise<AdminApproval> {
    return this.db.transaction(async (tx) => {
      const a = await this.find(tx, id);
      if (a.requested_by !== adminId) throw AppError.forbidden('Only the author can cancel a request');
      if (a.status !== 'pending') throw AppError.conflict('This request is no longer pending', { reason: 'not_pending', status: a.status });
      await tx.execute(sql`UPDATE admin_approvals SET status = 'cancelled' WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'admin.approval_cancelled', actorUserId: adminId, meta, metadata: { approvalId: id, kind: a.kind, subjectId: a.subject_id } }, tx);
      return this.get(tx, id);
    });
  }

  private async find(tx: Pick<Db, 'execute'>, id: string): Promise<Row> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Request not found');
    const r = await tx.execute<Row>(sql`${SELECT} WHERE a.id = ${id}::uuid FOR UPDATE OF a`);
    if (!r.rows[0]) throw AppError.notFound('Request not found');
    return r.rows[0];
  }

  private async get(tx: Pick<Db, 'execute'>, id: string): Promise<AdminApproval> {
    const r = await tx.execute<Row>(sql`${SELECT} WHERE a.id = ${id}::uuid`);
    return toApproval(r.rows[0]!);
  }

  /** Row locked for the decision: nobody decides their own request; only a pending one can be decided. */
  private async lock(tx: Pick<Db, 'execute'>, id: string, adminId: string): Promise<Row> {
    const a = await this.find(tx, id);
    if (a.requested_by === adminId) throw AppError.forbidden('You cannot decide your own request');
    if (a.subject_id === adminId) throw AppError.forbidden('You cannot decide a request about yourself');
    if (a.status !== 'pending') throw AppError.conflict('This request is no longer pending', { reason: 'not_pending', status: a.status });
    const still = await tx.execute(sql`SELECT 1 FROM users WHERE id = ${a.requested_by}::uuid AND status = 'active' AND 'admin' = ANY(roles)`);
    if (still.rows.length === 0) throw AppError.conflict('The requester is no longer an active administrator', { reason: 'requester_not_admin' });
    return a;
  }

  /** Runs the sensitive operation inside the decision's transaction, attributed to the requester; returns the sanction id it issued, if any (notified after the commit). */
  private async execute(tx: Pick<Db, 'transaction'>, a: Row, meta: RequestMeta): Promise<string | void> {
    const p = a.payload;
    switch (a.kind) {
      case 'flag.regulated.change': {
        const patch = updateFeatureFlagRequestSchema.parse(p.patch);
        await this.flags.update(String(p.key), patch, a.requested_by, meta, tx);
        return;
      }
      case 'user.platform_role.grant': {
        const body = grantPlatformRoleRequestSchema.parse({ role: p.role, reason: a.reason });
        await this.gov.grantPlatformRole(a.requested_by, a.subject_id ?? '', body, meta, tx);
        return;
      }
      case 'ledger.account.freeze':
        await this.wallet.applyFrozen(a.subject_id ?? '', p.frozen === true, a.requested_by, null, meta, tx);
        return;
      case 'user.suspend.staff': {
        const body = setUserStatusRequestSchema.parse({ status: p.status, reason: a.reason });
        await this.gov.setUserStatus(a.requested_by, a.subject_id ?? '', body, meta, tx);
        return;
      }
      case 'sanction.issue': {
        const body = issueSanctionRequestSchema.parse({ kind: p.kind, durationDays: p.durationDays, reportId: p.reportId, reason: a.reason });
        // The requester was checked as an active administrator when the decision locked the request.
        return this.sanctions.issueTx({ userId: a.requested_by, roles: ['admin'] }, a.subject_id ?? '', body, meta, tx, true);
      }
      case 'setting.sensitive': {
        if (p.key === 'org.commissionBps') {
          await this.commissions.setOrgBps(a.requested_by, String(p.orgId), { bps: p.bps as number | null, reason: a.reason ?? '' }, meta, tx);
          return;
        }
        await this.settings.put(a.requested_by, putSettingRequestSchema.parse({ key: p.key, scope: p.scope, value: p.value, reason: a.reason }), meta, tx);
        return;
      }
    }
  }

  private async notifyAdmins(actorId: string, approvalId: string, kind: ApprovalKind): Promise<void> {
    const r = await this.db.execute<{ id: string }>(sql`SELECT id FROM users WHERE 'admin' = ANY(roles) AND status = 'active' AND id <> ${actorId}::uuid`);
    await this.notifications.notifyMany(
      r.rows.map((u) => ({ userId: u.id, category: 'system' as const, title: 'CASELIND Admin', body: 'Une opération sensible attend votre validation.', data: { approvalId, kind } })),
    );
  }

  private async notifyRequester(userId: string, approvalId: string, kind: ApprovalKind, decision: 'approved' | 'rejected'): Promise<void> {
    await this.notifications.notify({
      userId,
      category: 'system',
      title: 'CASELIND Admin',
      body: decision === 'approved' ? 'Votre demande a été approuvée et exécutée.' : 'Votre demande a été rejetée.',
      data: { approvalId, kind, decision },
    });
  }
}

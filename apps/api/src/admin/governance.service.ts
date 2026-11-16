import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminListQuery,
  type AdminOrgList,
  type AdminUserList,
  type SetOrgStatusRequest,
  type SetOrgVerificationRequest,
  type SetUserStatusRequest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | string) => new Date(d).toISOString();
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Back-office governance. Every change needs a reason and leaves an audit event; nothing here reads private content. */
@Injectable()
export class GovernanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async listUsers(q: AdminListQuery): Promise<AdminUserList> {
    const search = q.q ? sql`AND (u.handle::text ILIKE ${like(q.q)} ESCAPE '\\' OR u.display_name ILIKE ${like(q.q)} ESCAPE '\\')` : sql``;
    const status = q.status ? sql`AND u.status::text = ${q.status}` : sql``;
    const r = await this.db.execute<{ id: string; handle: string; display_name: string; status: string; roles: string[]; created_at: Date }>(sql`
      SELECT u.id, u.handle::text AS handle, u.display_name, u.status::text AS status, u.roles, u.created_at
      FROM users u WHERE true ${search} ${status} ORDER BY u.created_at DESC, u.id LIMIT ${q.limit}`);
    return { items: r.rows.map((u) => ({ id: u.id, handle: u.handle, displayName: u.display_name, status: u.status, roles: u.roles, createdAt: iso(u.created_at) })) };
  }

  /** Active <-> suspended only. Another administrator or yourself cannot be suspended here (no admin wars, no lock-out). */
  async setUserStatus(adminId: string, userId: string, body: SetUserStatusRequest, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(userId)) throw AppError.notFound('User not found');
    if (userId === adminId) throw AppError.conflict('You cannot change your own status', { reason: 'self' });
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ status: string; roles: string[] }>(sql`SELECT status::text AS status, roles FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
      const u = r.rows[0];
      if (!u) throw AppError.notFound('User not found');
      if (u.roles.includes('admin')) throw AppError.conflict('An administrator cannot be suspended here', { reason: 'target_is_admin' });
      if (u.status !== 'active' && u.status !== 'suspended') throw AppError.conflict('Only an active or suspended account can change', { reason: 'bad_status', status: u.status });
      if (u.status === body.status) throw AppError.conflict('The account already has this status', { reason: 'unchanged' });
      await tx.execute(sql`UPDATE users SET status = ${body.status}::user_status WHERE id = ${userId}::uuid`);
      await this.audit.record({ action: 'admin.user_status', actorUserId: adminId, subjectUserId: userId, meta, metadata: { from: u.status, to: body.status, reason: body.reason } }, tx);
    });
  }

  async listOrgs(q: AdminListQuery): Promise<AdminOrgList> {
    const search = q.q ? sql`AND (o.slug::text ILIKE ${like(q.q)} ESCAPE '\\' OR o.name ILIKE ${like(q.q)} ESCAPE '\\')` : sql``;
    const status = q.status ? sql`AND (o.status = ${q.status} OR o.verification_status = ${q.status})` : sql``;
    const r = await this.db.execute<{ id: string; slug: string; name: string; kind: string; status: string; verification_status: string; created_at: Date }>(sql`
      SELECT o.id, o.slug::text AS slug, o.name, o.kind, o.status, o.verification_status, o.created_at
      FROM organizations o WHERE true ${search} ${status} ORDER BY o.created_at DESC, o.id LIMIT ${q.limit}`);
    return { items: r.rows.map((o) => ({ id: o.id, slug: o.slug, name: o.name, kind: o.kind, status: o.status, verificationStatus: o.verification_status, createdAt: iso(o.created_at) })) };
  }

  async setOrgStatus(adminId: string, orgId: string, body: SetOrgStatusRequest, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(orgId)) throw AppError.notFound('Organization not found');
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ status: string }>(sql`SELECT status FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`);
      if (!r.rows[0]) throw AppError.notFound('Organization not found');
      if (r.rows[0].status === body.status) throw AppError.conflict('The organization already has this status', { reason: 'unchanged' });
      await tx.execute(sql`UPDATE organizations SET status = ${body.status} WHERE id = ${orgId}::uuid`);
      await this.audit.record({ action: 'admin.org_status', actorUserId: adminId, meta, metadata: { orgId, from: r.rows[0].status, to: body.status, reason: body.reason } }, tx);
    });
  }

  /** The verification badge shown on storefronts. Setting it to `verified` needs a reason (what was checked). */
  async setOrgVerification(adminId: string, orgId: string, body: SetOrgVerificationRequest, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(orgId)) throw AppError.notFound('Organization not found');
    if (body.status === 'verified' && !body.reason) {
      throw AppError.conflict('A reason is required to verify an organization', { reason: 'reason_required' });
    }
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ verification_status: string }>(sql`SELECT verification_status FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`);
      if (!r.rows[0]) throw AppError.notFound('Organization not found');
      if (r.rows[0].verification_status === body.status) throw AppError.conflict('The organization already has this verification status', { reason: 'unchanged' });
      await tx.execute(sql`UPDATE organizations SET verification_status = ${body.status} WHERE id = ${orgId}::uuid`);
      await this.audit.record({ action: 'admin.org_verification', actorUserId: adminId, meta, metadata: { orgId, from: r.rows[0].verification_status, to: body.status, ...(body.reason ? { reason: body.reason } : {}) } }, tx);
    });
  }
}

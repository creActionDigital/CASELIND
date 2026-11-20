import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateLeaveRequest,
  type CreateShiftRequest,
  type DecideLeaveRequest,
  type Employee,
  type EmployeeDetail,
  type EmployeeList,
  type EmployeeProfile,
  ErrorCodes,
  type ExportedHr,
  HR_EMPLOYEES_MAX,
  type LeaveBalance,
  type LeaveList,
  type LeaveListQuery,
  type LeaveRequest,
  leaveDays,
  type MyLeaves,
  type OrgRole,
  type SalaryLine,
  type SalaryList,
  type SalaryListQuery,
  type SaveEmployeeProfileRequest,
  type SaveSalaryLineRequest,
  type Shift,
  type ShiftList,
  type ShiftListQuery,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { UUID_RE } from '../orgs/org.guard.js';
import { ORG_ROLE_PERMISSIONS, roleHasPermission } from '../orgs/org-permissions.js';
import type { Tx } from '../orgs/orgs.service.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { dateRangesOverlap, leaveBalance, timeRangesOverlap } from './hr.logic.js';

const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
const employeeNotFound = () => AppError.notFound('Employee not found');
const iso = (d: Date | string) => new Date(d).toISOString();

export interface HrCaller {
  userId: string;
  role: OrgRole;
}

/** Roles whose members hold `permission` (read from the permission map, never hard-coded). */
const rolesWith = (permission: Parameters<typeof roleHasPermission>[1]): OrgRole[] =>
  (Object.keys(ORG_ROLE_PERMISSIONS) as OrgRole[]).filter((r) => ORG_ROLE_PERMISSIONS[r].has(permission));

type ProfileCols = {
  job_title: string | null;
  department: string | null;
  employment_type: EmployeeProfile['employmentType'] | null;
  started_on: string | null;
  ended_on: string | null;
  manager_user_id: string | null;
  annual_leave_days: number | null;
  note: string | null;
};
const PROFILE_SELECT = sql`p.job_title, p.department, p.employment_type, p.started_on::text AS started_on, p.ended_on::text AS ended_on,
  p.manager_user_id, p.annual_leave_days, p.note`;

function toProfile(r: ProfileCols, withNote: boolean): EmployeeProfile | null {
  if (!r.job_title || !r.employment_type || !r.started_on) return null;
  return {
    jobTitle: r.job_title,
    department: r.department,
    employmentType: r.employment_type,
    startedOn: r.started_on,
    endedOn: r.ended_on,
    managerUserId: r.manager_user_id,
    annualLeaveDays: r.annual_leave_days,
    note: withNote ? r.note : null,
  };
}

type LeaveRow = {
  id: string;
  user_id: string;
  handle: string;
  display_name: string;
  kind: LeaveRequest['kind'];
  starts_on: string;
  ends_on: string;
  days: number;
  reason: string | null;
  status: LeaveRequest['status'];
  decided_by: string | null;
  decision_note: string | null;
  created_at: Date;
};
const LEAVE_SELECT = sql`l.id, l.user_id, u.handle, u.display_name, l.kind, l.starts_on::text AS starts_on, l.ends_on::text AS ends_on, l.days,
  l.reason, l.status, l.decided_by, l.decision_note, l.created_at`;
/** The reason of a sick leave is health-related: only its author and the holders of hr.manage read it (not the direct manager). */
const toLeave = (r: LeaveRow, viewer?: { userId: string; hr: boolean }): LeaveRequest => ({
  id: r.id,
  userId: r.user_id,
  handle: r.handle,
  displayName: r.display_name,
  kind: r.kind,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  days: r.days,
  reason: r.kind === 'sick' && viewer && !viewer.hr && viewer.userId !== r.user_id ? null : r.reason,
  status: r.status,
  decidedBy: r.decided_by,
  decisionNote: r.decision_note,
  createdAt: iso(r.created_at),
});

type ShiftRow = {
  id: string;
  user_id: string;
  handle: string;
  display_name: string;
  shift_date: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
};
const SHIFT_SELECT = sql`s.id, s.user_id, u.handle, u.display_name, s.shift_date::text AS shift_date, to_char(s.starts_at, 'HH24:MI') AS starts_at,
  to_char(s.ends_at, 'HH24:MI') AS ends_at, s.note`;
const toShift = (r: ShiftRow): Shift => ({ id: r.id, userId: r.user_id, handle: r.handle, displayName: r.display_name, shiftDate: r.shift_date, startsAt: r.starts_at, endsAt: r.ends_at, note: r.note });

type SalaryRow = {
  id: string;
  user_id: string;
  handle: string;
  display_name: string;
  period: string;
  gross_minor: string | number;
  currency: string;
  note: string | null;
  recorded_by: string | null;
  created_at: Date;
};
const SALARY_SELECT = sql`r.id, r.user_id, u.handle, u.display_name, r.period::text AS period, r.gross_minor, r.currency, r.note, r.recorded_by, r.created_at`;
const toSalary = (r: SalaryRow): SalaryLine => ({
  id: r.id,
  userId: r.user_id,
  handle: r.handle,
  displayName: r.display_name,
  period: r.period,
  grossMinor: Number(r.gross_minor),
  currency: r.currency.trim(),
  note: r.note,
  recordedBy: r.recorded_by,
  createdAt: iso(r.created_at),
});

function encodeCursor(startsOn: string, id: string): string {
  return Buffer.from(JSON.stringify([startsOn, id])).toString('base64url');
}
function decodeCursor(cursor: string): { startsOn: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v[0]) && typeof v[1] === 'string' && UUID_RE.test(v[1])) return { startsOn: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid cursor');
}

/**
 * Ressources humaines (CDC §8). Audit: ids, statuses and periods only: never amounts, reasons or notes.
 * Notifications are generic. The salary register is a hand-entered statement: nothing is computed here.
 */
@Injectable()
export class HrService {
  private readonly logger = new Logger(HrService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- helpers ------------------------------------------------------------------------------

  /** Active member of the org (the only people HR data can be about). 404 otherwise, so another org's member is never revealed. */
  private async member(db: Pick<Db, 'execute'>, orgId: string, userId: string): Promise<{ handle: string; displayName: string; role: OrgRole }> {
    if (!UUID_RE.test(userId)) throw employeeNotFound();
    const res = await db.execute<{ handle: string; display_name: string; role: OrgRole }>(sql`
      SELECT u.handle, u.display_name, m.role FROM org_members m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid AND m.status = 'active'`);
    const r = res.rows[0];
    if (!r) throw employeeNotFound();
    return { handle: r.handle, displayName: r.display_name, role: r.role };
  }

  private async isManagerOf(db: Pick<Db, 'execute'>, orgId: string, managerId: string, userId: string): Promise<boolean> {
    const res = await db.execute(sql`SELECT 1 FROM employee_profiles WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND manager_user_id = ${managerId}::uuid`);
    return res.rows.length > 0;
  }

  /** HR (hr.manage) or the employee's direct manager. */
  private async canManage(db: Pick<Db, 'execute'>, orgId: string, caller: HrCaller, userId: string): Promise<boolean> {
    return roleHasPermission(caller.role, 'hr.manage') || (await this.isManagerOf(db, orgId, caller.userId, userId));
  }

  private lock(tx: Tx, key: string) {
    return tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  /** Today's date (YYYY-MM-DD) in the organisation's time zone, like the profitability periods. */
  private async orgToday(orgId: string, exec: Pick<Db, 'execute'> = this.db): Promise<string> {
    const r = await exec.execute<{ d: string }>(sql`SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS d FROM organizations WHERE id = ${orgId}::uuid`);
    return r.rows[0]?.d ?? new Date().toISOString().slice(0, 10);
  }

  private async balance(orgId: string, userId: string, quota: number | null): Promise<LeaveBalance> {
    const year = Number((await this.orgToday(orgId)).slice(0, 4));
    const res = await this.db.execute<{ kind: LeaveRequest['kind']; status: 'requested' | 'approved'; starts_on: string; ends_on: string }>(sql`
      SELECT kind, status, starts_on::text AS starts_on, ends_on::text AS ends_on FROM leave_requests
      WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND status IN ('requested', 'approved')
        AND starts_on <= ${`${year}-12-31`}::date AND ends_on >= ${`${year}-01-01`}::date`);
    return leaveBalance(res.rows.map((r) => ({ kind: r.kind, status: r.status, startsOn: r.starts_on, endsOn: r.ends_on })), quota, year);
  }

  // ---- fiches employé -----------------------------------------------------------------------

  async listEmployees(orgId: string): Promise<EmployeeList> {
    const res = await this.db.execute<ProfileCols & { user_id: string; handle: string; display_name: string; role: string }>(sql`
      SELECT m.user_id, u.handle, u.display_name, m.role, ${PROFILE_SELECT}
      FROM org_members m JOIN users u ON u.id = m.user_id
      LEFT JOIN employee_profiles p ON p.org_id = m.org_id AND p.user_id = m.user_id
      WHERE m.org_id = ${orgId}::uuid AND m.status = 'active' ORDER BY lower(u.display_name), m.user_id LIMIT ${HR_EMPLOYEES_MAX}`);
    return { items: res.rows.map((r): Employee => ({ userId: r.user_id, handle: r.handle, displayName: r.display_name, role: r.role, profile: toProfile(r, true) })) };
  }

  /** HR, the employee, or the employee's direct manager. The HR note is never shown to anyone but HR. */
  async getEmployee(orgId: string, caller: HrCaller, userId: string): Promise<EmployeeDetail> {
    const isHr = roleHasPermission(caller.role, 'hr.manage');
    const self = caller.userId.toLowerCase() === userId.toLowerCase();
    if (!isHr && !self && !(UUID_RE.test(userId) && (await this.isManagerOf(this.db, orgId, caller.userId, userId)))) throw AppError.forbidden();
    const m = await this.member(this.db, orgId, userId);
    const res = await this.db.execute<ProfileCols>(sql`SELECT ${PROFILE_SELECT} FROM (SELECT 1) x LEFT JOIN employee_profiles p ON p.org_id = ${orgId}::uuid AND p.user_id = ${userId}::uuid`);
    const profile = toProfile(res.rows[0]!, isHr);
    return { userId, handle: m.handle, displayName: m.displayName, role: m.role, profile, balance: await this.balance(orgId, userId, profile?.annualLeaveDays ?? null) };
  }

  async saveProfile(orgId: string, caller: HrCaller, userId: string, b: SaveEmployeeProfileRequest, meta: RequestMeta): Promise<EmployeeDetail> {
    await this.db.transaction(async (tx) => {
      await this.member(tx, orgId, userId);
      if (b.managerUserId) {
        if (b.managerUserId.toLowerCase() === userId.toLowerCase()) throw invalid('managerUserId', 'an employee cannot be their own manager');
        const mgr = await tx.execute(sql`SELECT 1 FROM org_members WHERE org_id = ${orgId}::uuid AND user_id = ${b.managerUserId}::uuid AND status = 'active'`);
        if (mgr.rows.length === 0) throw invalid('managerUserId', 'the manager must be an active member of the organization');
      }
      await tx.execute(sql`
        INSERT INTO employee_profiles (org_id, user_id, job_title, department, employment_type, started_on, ended_on, manager_user_id, annual_leave_days, note)
        VALUES (${orgId}::uuid, ${userId}::uuid, ${b.jobTitle}, ${b.department ?? null}, ${b.employmentType}, ${b.startedOn}::date, ${b.endedOn ?? null}::date,
                ${b.managerUserId ?? null}::uuid, ${b.annualLeaveDays ?? null}, ${b.note ?? null})
        ON CONFLICT (org_id, user_id) DO UPDATE SET job_title = EXCLUDED.job_title, department = EXCLUDED.department, employment_type = EXCLUDED.employment_type,
          started_on = EXCLUDED.started_on, ended_on = EXCLUDED.ended_on, manager_user_id = EXCLUDED.manager_user_id,
          annual_leave_days = EXCLUDED.annual_leave_days, note = EXCLUDED.note, updated_at = now()`);
      await this.audit.record({ action: 'hr.profile_saved', actorUserId: caller.userId, meta, metadata: { orgId, employeeId: userId } }, tx);
    });
    return this.getEmployee(orgId, caller, userId);
  }

  // ---- congés -------------------------------------------------------------------------------

  async requestLeave(orgId: string, userId: string, b: CreateLeaveRequest, meta: RequestMeta): Promise<LeaveRequest> {
    const id = await this.db.transaction(async (tx) => {
      await this.lock(tx, `hr-leave:${orgId}:${userId}`);
      const active = await tx.execute<{ starts_on: string; ends_on: string }>(sql`
        SELECT starts_on::text AS starts_on, ends_on::text AS ends_on FROM leave_requests
        WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND status IN ('requested', 'approved') AND ends_on >= ${b.startsOn}::date`);
      if (active.rows.some((r) => dateRangesOverlap({ startsOn: r.starts_on, endsOn: r.ends_on }, b))) {
        throw AppError.conflict('This leave overlaps another requested or approved leave', { reason: 'leave_overlap' });
      }
      const days = leaveDays(b.startsOn, b.endsOn);
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO leave_requests (org_id, user_id, kind, starts_on, ends_on, days, reason)
        VALUES (${orgId}::uuid, ${userId}::uuid, ${b.kind}, ${b.startsOn}::date, ${b.endsOn}::date, ${days}, ${b.reason ?? null}) RETURNING id`);
      const newId = r.rows[0]!.id;
      await this.audit.record({ action: 'hr.leave_requested', actorUserId: userId, meta, metadata: { orgId, leaveId: newId, kind: b.kind, days } }, tx);
      return newId;
    });
    // Recipients: HR (hr.manage) and the direct manager, never the requester. Generic text.
    await bestEffort(this.logger, 'leave notification', async () => {
      const rec = await this.db.execute<{ user_id: string }>(sql`
        SELECT m.user_id FROM org_members m WHERE m.org_id = ${orgId}::uuid AND m.status = 'active' AND m.user_id <> ${userId}::uuid
          AND (m.role IN (${sql.join(rolesWith('hr.manage').map((r) => sql`${r}`), sql`, `)})
            OR m.user_id = (SELECT manager_user_id FROM employee_profiles WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid))`);
      await this.notifications.notifyMany(rec.rows.map((x) => ({ userId: x.user_id, category: 'system' as const, title: 'Demande de congé', body: 'Une demande de congé attend votre décision.', data: { type: 'hr.leave_requested', orgId, leaveId: id } })));
    });
    return this.oneLeave(orgId, id);
  }

  private async oneLeave(orgId: string, id: string, viewer?: { userId: string; hr: boolean }): Promise<LeaveRequest> {
    const res = await this.db.execute<LeaveRow>(sql`SELECT ${LEAVE_SELECT} FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.id = ${id}::uuid AND l.org_id = ${orgId}::uuid`);
    return toLeave(res.rows[0]!, viewer);
  }

  async cancelLeave(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<LeaveRequest> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Leave request not found');
    await this.db.transaction(async (tx) => {
      const cur = (await tx.execute<{ status: string; starts_on: string }>(sql`
        SELECT status, starts_on::text AS starts_on FROM leave_requests WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw AppError.notFound('Leave request not found');
      const today = await this.orgToday(orgId, tx);
      // An approved leave can be withdrawn only before it starts.
      if (!(cur.status === 'requested' || (cur.status === 'approved' && cur.starts_on > today))) {
        throw AppError.conflict('This leave can no longer be cancelled', { reason: 'leave_not_cancellable' });
      }
      await tx.execute(sql`UPDATE leave_requests SET status = 'cancelled' WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'hr.leave_cancelled', actorUserId: userId, meta, metadata: { orgId, leaveId: id, from: cur.status } }, tx);
    });
    return this.oneLeave(orgId, id);
  }

  async decideLeave(orgId: string, caller: HrCaller, id: string, b: DecideLeaveRequest, meta: RequestMeta): Promise<LeaveRequest> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Leave request not found');
    const owner = await this.db.transaction(async (tx) => {
      const cur = (await tx.execute<{ user_id: string; status: string }>(sql`
        SELECT user_id, status FROM leave_requests WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw AppError.notFound('Leave request not found');
      // Nobody decides their own request, whatever their role.
      if (cur.user_id === caller.userId) throw AppError.forbidden('You cannot decide your own leave request');
      if (!(await this.canManage(tx, orgId, caller, cur.user_id))) throw AppError.forbidden();
      if (cur.status !== 'requested') throw AppError.conflict('This request was already handled', { reason: 'leave_not_pending' });
      const status = b.decision === 'approve' ? 'approved' : 'rejected';
      await tx.execute(sql`UPDATE leave_requests SET status = ${status}, decided_by = ${caller.userId}::uuid, decision_note = ${b.note ?? null} WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'hr.leave_decided', actorUserId: caller.userId, meta, metadata: { orgId, leaveId: id, status } }, tx);
      return cur.user_id;
    });
    await this.notifications.notify({ userId: owner, category: 'system', title: 'Congé', body: 'Votre demande de congé a été traitée. Consultez-la dans l’application.', data: { type: 'hr.leave_decided', orgId, leaveId: id } });
    return this.oneLeave(orgId, id, { userId: caller.userId, hr: roleHasPermission(caller.role, 'hr.manage') });
  }

  /** HR: every request of the org. A direct manager: those of their reports. Anyone else: nothing. */
  async listLeaves(orgId: string, caller: HrCaller, q: LeaveListQuery): Promise<LeaveList> {
    const hr = roleHasPermission(caller.role, 'hr.manage');
    const where = [sql`l.org_id = ${orgId}::uuid`];
    if (!hr) where.push(sql`EXISTS (SELECT 1 FROM employee_profiles p WHERE p.org_id = l.org_id AND p.user_id = l.user_id AND p.manager_user_id = ${caller.userId}::uuid)`);
    if (q.status) where.push(sql`l.status = ${q.status}`);
    if (q.userId) where.push(sql`l.user_id = ${q.userId}::uuid`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      where.push(sql`(l.starts_on, l.id) < (${c.startsOn}::date, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<LeaveRow>(sql`
      SELECT ${LEAVE_SELECT} FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE ${sql.join(where, sql` AND `)}
      ORDER BY l.starts_on DESC, l.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => toLeave(r, { userId: caller.userId, hr })), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.starts_on, last.id) : null };
  }

  async myLeaves(orgId: string, userId: string): Promise<MyLeaves> {
    await this.member(this.db, orgId, userId);
    const res = await this.db.execute<LeaveRow>(sql`
      SELECT ${LEAVE_SELECT} FROM leave_requests l JOIN users u ON u.id = l.user_id
      WHERE l.org_id = ${orgId}::uuid AND l.user_id = ${userId}::uuid ORDER BY l.starts_on DESC, l.id DESC LIMIT 100`);
    const quota = await this.db.execute<{ q: number | null }>(sql`SELECT annual_leave_days AS q FROM employee_profiles WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
    return { items: res.rows.map((r) => toLeave(r)), balance: await this.balance(orgId, userId, quota.rows[0]?.q ?? null) };
  }

  // ---- plannings ----------------------------------------------------------------------------

  async createShift(orgId: string, caller: HrCaller, b: CreateShiftRequest, meta: RequestMeta): Promise<Shift> {
    const id = await this.db.transaction(async (tx) => {
      await this.member(tx, orgId, b.userId);
      if (!(await this.canManage(tx, orgId, caller, b.userId))) throw AppError.forbidden();
      await this.lock(tx, `hr-shift:${orgId}:${b.userId}`);
      const same = await tx.execute<{ starts_at: string; ends_at: string }>(sql`
        SELECT to_char(starts_at, 'HH24:MI') AS starts_at, to_char(ends_at, 'HH24:MI') AS ends_at FROM work_shifts
        WHERE org_id = ${orgId}::uuid AND user_id = ${b.userId}::uuid AND shift_date = ${b.shiftDate}::date`);
      if (same.rows.some((r) => timeRangesOverlap({ startsAt: r.starts_at, endsAt: r.ends_at }, b))) {
        throw AppError.conflict('This shift overlaps another shift of the employee', { reason: 'shift_overlap' });
      }
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO work_shifts (org_id, user_id, shift_date, starts_at, ends_at, note, created_by)
        VALUES (${orgId}::uuid, ${b.userId}::uuid, ${b.shiftDate}::date, ${b.startsAt}::time, ${b.endsAt}::time, ${b.note ?? null}, ${caller.userId}::uuid) RETURNING id`);
      await this.audit.record({ action: 'hr.shift_created', actorUserId: caller.userId, meta, metadata: { orgId, shiftId: r.rows[0]!.id, employeeId: b.userId } }, tx);
      return r.rows[0]!.id;
    });
    const res = await this.db.execute<ShiftRow>(sql`SELECT ${SHIFT_SELECT} FROM work_shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ${id}::uuid`);
    return toShift(res.rows[0]!);
  }

  async deleteShift(orgId: string, caller: HrCaller, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Shift not found');
    await this.db.transaction(async (tx) => {
      const cur = (await tx.execute<{ user_id: string }>(sql`SELECT user_id FROM work_shifts WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw AppError.notFound('Shift not found');
      if (!(await this.canManage(tx, orgId, caller, cur.user_id))) throw AppError.forbidden();
      await tx.execute(sql`DELETE FROM work_shifts WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'hr.shift_deleted', actorUserId: caller.userId, meta, metadata: { orgId, shiftId: id } }, tx);
    });
  }

  /** HR: the whole org (optionally one employee). A direct manager: their reports. */
  async listShifts(orgId: string, caller: HrCaller, q: ShiftListQuery): Promise<ShiftList> {
    const where = [sql`s.org_id = ${orgId}::uuid`, sql`s.shift_date BETWEEN ${q.from}::date AND ${q.to}::date`];
    if (!roleHasPermission(caller.role, 'hr.manage')) where.push(sql`EXISTS (SELECT 1 FROM employee_profiles p WHERE p.org_id = s.org_id AND p.user_id = s.user_id AND p.manager_user_id = ${caller.userId}::uuid)`);
    if (q.userId) where.push(sql`s.user_id = ${q.userId}::uuid`);
    return this.shifts(where);
  }

  async myShifts(orgId: string, userId: string, from: string, to: string): Promise<ShiftList> {
    await this.member(this.db, orgId, userId);
    return this.shifts([sql`s.org_id = ${orgId}::uuid`, sql`s.user_id = ${userId}::uuid`, sql`s.shift_date BETWEEN ${from}::date AND ${to}::date`]);
  }

  private async shifts(where: ReturnType<typeof sql>[]): Promise<ShiftList> {
    const res = await this.db.execute<ShiftRow>(sql`
      SELECT ${SHIFT_SELECT} FROM work_shifts s JOIN users u ON u.id = s.user_id WHERE ${sql.join(where, sql` AND `)}
      ORDER BY s.shift_date, s.starts_at, u.handle, s.id LIMIT 2000`);
    return { items: res.rows.map(toShift) };
  }

  // ---- registre de salaire (état saisi à la main) -------------------------------------------

  async saveSalary(orgId: string, actorId: string, b: SaveSalaryLineRequest, meta: RequestMeta): Promise<SalaryLine> {
    const id = await this.db.transaction(async (tx) => {
      await this.member(tx, orgId, b.userId);
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO salary_register (org_id, user_id, period, gross_minor, currency, note, recorded_by)
        VALUES (${orgId}::uuid, ${b.userId}::uuid, ${b.period}::date, ${b.grossMinor}, ${b.currency}, ${b.note ?? null}, ${actorId}::uuid)
        ON CONFLICT (org_id, user_id, period) DO UPDATE SET gross_minor = EXCLUDED.gross_minor, currency = EXCLUDED.currency, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by
        RETURNING id`);
      // Never the amount: who, which period.
      await this.audit.record({ action: 'hr.salary_saved', actorUserId: actorId, meta, metadata: { orgId, salaryId: r.rows[0]!.id, employeeId: b.userId, period: b.period } }, tx);
      return r.rows[0]!.id;
    });
    const res = await this.db.execute<SalaryRow>(sql`SELECT ${SALARY_SELECT} FROM salary_register r JOIN users u ON u.id = r.user_id WHERE r.id = ${id}::uuid`);
    return toSalary(res.rows[0]!);
  }

  async deleteSalary(orgId: string, actorId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Salary line not found');
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ user_id: string; period: string }>(sql`DELETE FROM salary_register WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid RETURNING user_id, period::text AS period`);
      if (!r.rows[0]) throw AppError.notFound('Salary line not found');
      await this.audit.record({ action: 'hr.salary_deleted', actorUserId: actorId, meta, metadata: { orgId, salaryId: id, employeeId: r.rows[0].user_id, period: r.rows[0].period } }, tx);
    });
  }

  async listSalary(orgId: string, q: SalaryListQuery): Promise<SalaryList> {
    const where = [sql`r.org_id = ${orgId}::uuid`];
    if (q.userId) where.push(sql`r.user_id = ${q.userId}::uuid`);
    if (q.year) where.push(sql`extract(year FROM r.period) = ${q.year}`);
    return this.salary(where);
  }

  /** The employee's own lines only. */
  async mySalary(orgId: string, userId: string): Promise<SalaryList> {
    await this.member(this.db, orgId, userId);
    return this.salary([sql`r.org_id = ${orgId}::uuid`, sql`r.user_id = ${userId}::uuid`]);
  }

  private async salary(where: ReturnType<typeof sql>[]): Promise<SalaryList> {
    const res = await this.db.execute<SalaryRow>(sql`
      SELECT ${SALARY_SELECT} FROM salary_register r JOIN users u ON u.id = r.user_id WHERE ${sql.join(where, sql` AND `)}
      ORDER BY r.period DESC, u.handle, r.id LIMIT 1000`);
    return { items: res.rows.map(toSalary) };
  }

  // ---- export de compte ---------------------------------------------------------------------

  /** Everything HR holds about the user (all organisations). The HR note is excluded. */
  async exportFor(userId: string): Promise<ExportedHr> {
    const [p, l, s, r] = await Promise.all([
      this.db.execute<ProfileCols & { org_id: string }>(sql`SELECT p.org_id, ${PROFILE_SELECT} FROM employee_profiles p WHERE p.user_id = ${userId}::uuid ORDER BY p.org_id`),
      this.db.execute<{ org_id: string; id: string; kind: LeaveRequest['kind']; starts_on: string; ends_on: string; days: number; reason: string | null; status: LeaveRequest['status']; created_at: Date }>(sql`
        SELECT org_id, id, kind, starts_on::text AS starts_on, ends_on::text AS ends_on, days, reason, status, created_at FROM leave_requests WHERE user_id = ${userId}::uuid ORDER BY starts_on, id`),
      this.db.execute<{ org_id: string; id: string; shift_date: string; starts_at: string; ends_at: string; note: string | null }>(sql`
        SELECT org_id, id, shift_date::text AS shift_date, to_char(starts_at, 'HH24:MI') AS starts_at, to_char(ends_at, 'HH24:MI') AS ends_at, note FROM work_shifts WHERE user_id = ${userId}::uuid ORDER BY shift_date, starts_at, id`),
      this.db.execute<{ org_id: string; id: string; period: string; gross_minor: string | number; currency: string; note: string | null }>(sql`
        SELECT org_id, id, period::text AS period, gross_minor, currency, note FROM salary_register WHERE user_id = ${userId}::uuid ORDER BY period, id`),
    ]);
    return {
      profiles: p.rows.map((x) => {
        const { note: _omit, ...profile } = toProfile(x, false)!;
        return { orgId: x.org_id, ...profile };
      }),
      leaves: l.rows.map((x) => ({ orgId: x.org_id, id: x.id, kind: x.kind, startsOn: x.starts_on, endsOn: x.ends_on, days: x.days, reason: x.reason, status: x.status, createdAt: iso(x.created_at) })),
      shifts: s.rows.map((x) => ({ orgId: x.org_id, id: x.id, shiftDate: x.shift_date, startsAt: x.starts_at, endsAt: x.ends_at, note: x.note })),
      salary: r.rows.map((x) => ({ orgId: x.org_id, id: x.id, period: x.period, grossMinor: Number(x.gross_minor), currency: x.currency.trim(), note: x.note })),
    };
  }
}

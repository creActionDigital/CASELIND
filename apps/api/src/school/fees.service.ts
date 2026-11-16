import { Inject, Injectable } from '@nestjs/common';
import { ErrorCodes, type CreateFeeRequest, type FeeStatusList, type MarkFeeRequest, type MyFeeList, type SchoolFee, type SchoolFeeList } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d); // rejects 2026-13-45 and 2026-02-31
};

type FeeRow = { id: string; title: string; amount_minor: string; currency: string; due_on: string | null; paid: number; students: number };

/** School fee statements: a record kept by the school, no money moves here. Audit holds ids only, never names or amounts. */
@Injectable()
export class FeesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private async assertClass(orgId: string, classId: string): Promise<void> {
    if (!UUID_RE.test(classId)) throw AppError.notFound('Class not found');
    const r = await this.db.execute(sql`SELECT 1 FROM school_classes WHERE id = ${classId}::uuid AND org_id = ${orgId}::uuid`);
    if (r.rows.length === 0) throw AppError.notFound('Class not found');
  }

  private async assertFee(classId: string, feeId: string): Promise<void> {
    if (!UUID_RE.test(feeId)) throw AppError.notFound('Fee not found');
    const r = await this.db.execute(sql`SELECT 1 FROM school_fees WHERE id = ${feeId}::uuid AND class_id = ${classId}::uuid`);
    if (r.rows.length === 0) throw AppError.notFound('Fee not found');
  }

  async create(orgId: string, userId: string, classId: string, body: CreateFeeRequest, meta: RequestMeta): Promise<SchoolFee> {
    await this.assertClass(orgId, classId);
    if (body.dueOn && !validDay(body.dueOn)) throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'dueOn', message: 'not a real date' }]);
    const r = await this.db.execute<{ id: string }>(sql`
      INSERT INTO school_fees (class_id, title, amount_minor, currency, due_on, created_by)
      VALUES (${classId}::uuid, ${body.title}, ${body.amountMinor}, ${body.currency}, ${body.dueOn ?? null}::date, ${userId}::uuid) RETURNING id`);
    await this.audit.record({ action: 'school.fee_created', actorUserId: userId, meta, metadata: { orgId, classId, feeId: r.rows[0]!.id } });
    const students = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM school_enrollments WHERE class_id = ${classId}::uuid AND role = 'student'`);
    return { id: r.rows[0]!.id, title: body.title, amountMinor: body.amountMinor, currency: body.currency, dueOn: body.dueOn ?? null, paidCount: 0, studentCount: students.rows[0]?.n ?? 0 };
  }

  async list(orgId: string, classId: string): Promise<SchoolFeeList> {
    await this.assertClass(orgId, classId);
    const r = await this.db.execute<FeeRow>(sql`
      SELECT f.id, f.title, f.amount_minor::text AS amount_minor, f.currency::text AS currency, to_char(f.due_on, 'YYYY-MM-DD') AS due_on,
        (SELECT count(*)::int FROM school_fee_payments p JOIN school_enrollments e ON e.user_id = p.user_id AND e.class_id = f.class_id AND e.role = 'student' WHERE p.fee_id = f.id) AS paid,
        (SELECT count(*)::int FROM school_enrollments e WHERE e.class_id = f.class_id AND e.role = 'student') AS students
      FROM school_fees f WHERE f.class_id = ${classId}::uuid ORDER BY f.created_at DESC, f.id LIMIT 100`);
    return { items: r.rows.map((f) => ({ id: f.id, title: f.title, amountMinor: Number(f.amount_minor), currency: f.currency, dueOn: f.due_on, paidCount: f.paid, studentCount: f.students })) };
  }

  async statuses(orgId: string, classId: string, feeId: string): Promise<FeeStatusList> {
    await this.assertClass(orgId, classId);
    await this.assertFee(classId, feeId);
    const r = await this.db.execute<{ handle: string; display_name: string; paid: boolean }>(sql`
      SELECT u.handle::text AS handle, u.display_name, (p.user_id IS NOT NULL) AS paid
      FROM school_enrollments e JOIN users u ON u.id = e.user_id
      LEFT JOIN school_fee_payments p ON p.fee_id = ${feeId}::uuid AND p.user_id = e.user_id
      WHERE e.class_id = ${classId}::uuid AND e.role = 'student' ORDER BY u.display_name LIMIT 500`);
    return { items: r.rows.map((s) => ({ handle: s.handle, displayName: s.display_name, paid: s.paid })) };
  }

  /** The school records that a student paid (or not) outside the platform. Only enrolled students can be marked. */
  async mark(orgId: string, userId: string, classId: string, feeId: string, body: MarkFeeRequest, meta: RequestMeta): Promise<void> {
    await this.assertClass(orgId, classId);
    await this.assertFee(classId, feeId);
    const st = await this.db.execute<{ user_id: string }>(sql`
      SELECT e.user_id FROM school_enrollments e JOIN users u ON u.id = e.user_id WHERE e.class_id = ${classId}::uuid AND e.role = 'student' AND u.handle = ${body.handle}`);
    const target = st.rows[0]?.user_id;
    if (!target) throw AppError.notFound('Student not found in this class');
    if (body.paid) {
      await this.db.execute(sql`INSERT INTO school_fee_payments (fee_id, user_id, marked_by) VALUES (${feeId}::uuid, ${target}::uuid, ${userId}::uuid) ON CONFLICT (fee_id, user_id) DO NOTHING`);
    } else {
      await this.db.execute(sql`DELETE FROM school_fee_payments WHERE fee_id = ${feeId}::uuid AND user_id = ${target}::uuid`);
    }
    await this.audit.record({ action: 'school.fee_marked', actorUserId: userId, subjectUserId: target, meta, metadata: { orgId, classId, feeId, paid: body.paid } });
  }

  /** Fees of the classes the caller is enrolled in; `paid` is null for non-students. */
  async mine(userId: string): Promise<MyFeeList> {
    const r = await this.db.execute<{ id: string; class_name: string; school_name: string; title: string; amount_minor: string; currency: string; due_on: string | null; role: string; paid: boolean }>(sql`
      SELECT f.id, c.name AS class_name, o.name AS school_name, f.title, f.amount_minor::text AS amount_minor, f.currency::text AS currency,
        to_char(f.due_on, 'YYYY-MM-DD') AS due_on, e.role, (p.user_id IS NOT NULL) AS paid
      FROM school_enrollments e JOIN school_classes c ON c.id = e.class_id JOIN organizations o ON o.id = c.org_id
      JOIN school_fees f ON f.class_id = c.id
      LEFT JOIN school_fee_payments p ON p.fee_id = f.id AND p.user_id = e.user_id
      WHERE e.user_id = ${userId}::uuid ORDER BY f.due_on NULLS LAST, f.created_at DESC LIMIT 100`);
    return { items: r.rows.map((f) => ({ id: f.id, className: f.class_name, schoolName: f.school_name, title: f.title, amountMinor: Number(f.amount_minor), currency: f.currency, dueOn: f.due_on, paid: f.role === 'student' ? f.paid : null })) };
  }
}

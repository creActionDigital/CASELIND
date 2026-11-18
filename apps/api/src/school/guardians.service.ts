import { Inject, Injectable } from '@nestjs/common';
import type { ChildClassList, ChildFeeList, CreateGuardianRequest, ExportedGuardian, GuardianStatus, MyChildList, MyGuardianshipList, SchoolGuardian, SchoolGuardianList } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FeesService } from './fees.service.js';
import { SchoolService } from './school.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | string) => new Date(d).toISOString();
const bare = (h: string) => h.replace(/^@/, '');

type LinkRow = { id: string; student_handle: string; student_name: string; guardian_handle: string; guardian_name: string; relation: string; status: GuardianStatus; created_at: Date };

/**
 * Optional parent-pupil link of a school (the school stays answerable for minors and consent; no parent account is required).
 * Staff (org.members.manage) link an ENROLLED pupil to a parent by handle; the parent accepts or declines; an ACTIVE parent reads the
 * pupil's classes and fee status through the existing services. Audit holds ids only, never names; notifications name nobody.
 */
@Injectable()
export class GuardiansService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly school: SchoolService,
    private readonly fees: FeesService,
  ) {}

  // ---- Staff ------------------------------------------------------------------------------------

  async create(orgId: string, userId: string, body: CreateGuardianRequest, meta: RequestMeta): Promise<SchoolGuardian> {
    const org = await this.db.execute<{ kind: string }>(sql`SELECT kind FROM organizations WHERE id = ${orgId}::uuid`);
    if (org.rows[0]?.kind !== 'school') throw AppError.conflict('Only a school can link parents', { reason: 'not_a_school' });
    const find = async (handle: string) => (await this.db.execute<{ id: string }>(sql`SELECT id FROM users WHERE handle = ${bare(handle)} AND status = 'active'`)).rows[0]?.id;
    const [studentId, guardianId] = [await find(body.studentHandle), await find(body.guardianHandle)];
    if (!studentId || !guardianId) throw AppError.notFound('User not found');
    if (studentId === guardianId) throw AppError.conflict('A pupil cannot be their own parent', { reason: 'same_person' });
    const enrolled = await this.db.execute(sql`
      SELECT 1 FROM school_enrollments e JOIN school_classes c ON c.id = e.class_id
      WHERE e.user_id = ${studentId}::uuid AND e.role = 'student' AND c.org_id = ${orgId}::uuid LIMIT 1`);
    if (enrolled.rows.length === 0) throw AppError.notFound('Student not found in this school');
    const ins = await this.db.execute<{ id: string }>(sql`
      INSERT INTO school_guardians (org_id, student_user_id, guardian_user_id, relation, created_by)
      VALUES (${orgId}::uuid, ${studentId}::uuid, ${guardianId}::uuid, ${body.relation}, ${userId}::uuid)
      ON CONFLICT (org_id, student_user_id, guardian_user_id) DO NOTHING RETURNING id`);
    const id = ins.rows[0]?.id;
    if (!id) throw AppError.conflict('This parent is already linked to this pupil', { reason: 'duplicate_guardian' });
    await this.audit.record({ action: 'school.guardian_invited', actorUserId: userId, subjectUserId: guardianId, meta, metadata: { orgId, guardianshipId: id, studentId } });
    // Generic on purpose (no school, no pupil name): the details are read in the app. Best effort: the link is already saved.
    try {
      await this.notifications.notify({ userId: guardianId, category: 'system', title: 'Invitation', body: 'Un établissement vous invite à suivre la scolarité d’un élève. Acceptez ou refusez dans l’application.', data: { guardianshipId: id } });
    } catch {
      // not essential
    }
    return (await this.list(orgId, id)).items[0]!;
  }

  async list(orgId: string, onlyId?: string): Promise<SchoolGuardianList> {
    const r = await this.db.execute<LinkRow>(sql`
      SELECT g.id, s.handle::text AS student_handle, s.display_name AS student_name, p.handle::text AS guardian_handle, p.display_name AS guardian_name, g.relation, g.status, g.created_at
      FROM school_guardians g JOIN users s ON s.id = g.student_user_id JOIN users p ON p.id = g.guardian_user_id
      WHERE g.org_id = ${orgId}::uuid ${onlyId ? sql`AND g.id = ${onlyId}::uuid` : sql``} ORDER BY g.created_at DESC, g.id LIMIT 500`);
    return { items: r.rows.map((l) => ({ id: l.id, studentHandle: l.student_handle, studentDisplayName: l.student_name, guardianHandle: l.guardian_handle, guardianDisplayName: l.guardian_name, relation: l.relation, status: l.status, createdAt: iso(l.created_at) })) };
  }

  async remove(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Link not found');
    const r = await this.db.execute<{ guardian_user_id: string; student_user_id: string }>(sql`DELETE FROM school_guardians WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid RETURNING guardian_user_id, student_user_id`);
    if (!r.rows[0]) throw AppError.notFound('Link not found');
    await this.audit.record({ action: 'school.guardian_removed', actorUserId: userId, subjectUserId: r.rows[0].guardian_user_id, meta, metadata: { orgId, guardianshipId: id, studentId: r.rows[0].student_user_id } });
  }

  // ---- Parent -----------------------------------------------------------------------------------

  async mine(guardianId: string): Promise<MyGuardianshipList> {
    const r = await this.db.execute<{ id: string; school_name: string; student_name: string; relation: string; status: GuardianStatus }>(sql`
      SELECT g.id, o.name AS school_name, s.display_name AS student_name, g.relation, g.status
      FROM school_guardians g JOIN organizations o ON o.id = g.org_id JOIN users s ON s.id = g.student_user_id
      WHERE g.guardian_user_id = ${guardianId}::uuid ORDER BY g.status, g.created_at DESC LIMIT 100`);
    return { items: r.rows.map((g) => ({ id: g.id, schoolName: g.school_name, studentDisplayName: g.student_name, relation: g.relation, status: g.status })) };
  }

  /** Idempotent: accepting an active link changes nothing. Only the invited parent can answer (anyone else: 404). */
  async accept(guardianId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Invitation not found');
    const r = await this.db.execute<{ org_id: string; student_user_id: string }>(sql`UPDATE school_guardians SET status = 'active' WHERE id = ${id}::uuid AND guardian_user_id = ${guardianId}::uuid RETURNING org_id, student_user_id`);
    if (!r.rows[0]) throw AppError.notFound('Invitation not found');
    await this.audit.record({ action: 'school.guardian_accepted', actorUserId: guardianId, meta, metadata: { orgId: r.rows[0].org_id, guardianshipId: id, studentId: r.rows[0].student_user_id } });
  }

  /** Refuses an invitation or ends an active link (the row goes, so the school may invite again). */
  async decline(guardianId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Invitation not found');
    const r = await this.db.execute<{ org_id: string; student_user_id: string }>(sql`DELETE FROM school_guardians WHERE id = ${id}::uuid AND guardian_user_id = ${guardianId}::uuid RETURNING org_id, student_user_id`);
    if (!r.rows[0]) throw AppError.notFound('Invitation not found');
    await this.audit.record({ action: 'school.guardian_declined', actorUserId: guardianId, meta, metadata: { orgId: r.rows[0].org_id, guardianshipId: id, studentId: r.rows[0].student_user_id } });
  }

  async children(guardianId: string): Promise<MyChildList> {
    const r = await this.db.execute<{ id: string; student_user_id: string; student_name: string; school_name: string; relation: string }>(sql`
      SELECT g.id, g.student_user_id, s.display_name AS student_name, o.name AS school_name, g.relation
      FROM school_guardians g JOIN organizations o ON o.id = g.org_id JOIN users s ON s.id = g.student_user_id
      WHERE g.guardian_user_id = ${guardianId}::uuid AND g.status = 'active' ORDER BY s.display_name, o.name LIMIT 100`);
    return { items: r.rows.map((c) => ({ id: c.id, studentId: c.student_user_id, displayName: c.student_name, schoolName: c.school_name, relation: c.relation })) };
  }

  /** No ACTIVE link to this pupil: 404 (a pending one does not open anything). */
  private async assertActive(guardianId: string, studentId: string): Promise<void> {
    if (!UUID_RE.test(studentId)) throw AppError.notFound('Child not found');
    const r = await this.db.execute(sql`SELECT 1 FROM school_guardians WHERE guardian_user_id = ${guardianId}::uuid AND student_user_id = ${studentId}::uuid AND status = 'active' LIMIT 1`);
    if (r.rows.length === 0) throw AppError.notFound('Child not found');
  }

  async childFees(guardianId: string, studentId: string): Promise<ChildFeeList> {
    await this.assertActive(guardianId, studentId);
    const r = await this.fees.mine(studentId, guardianId);
    return { items: r.items.filter((f) => f.paid !== null).map((f) => ({ ...f, paid: f.paid === true })) };
  }

  async childClasses(guardianId: string, studentId: string): Promise<ChildClassList> {
    await this.assertActive(guardianId, studentId);
    const classes = await this.school.myClasses(studentId, guardianId);
    return { items: await Promise.all(classes.items.map((c) => this.school.myClass(studentId, c.id))) };
  }

  /** Links where the user is the parent or the pupil, for the personal data export (ids and relation only). */
  async exportFor(userId: string): Promise<ExportedGuardian[]> {
    const r = await this.db.execute<{ id: string; guardian_user_id: string; student_user_id: string; relation: string; status: GuardianStatus }>(sql`
      SELECT id, guardian_user_id, student_user_id, relation, status FROM school_guardians
      WHERE guardian_user_id = ${userId}::uuid OR student_user_id = ${userId}::uuid ORDER BY created_at, id`);
    return r.rows.map((g) => (g.guardian_user_id === userId ? { id: g.id, role: 'guardian' as const, otherUserId: g.student_user_id, relation: g.relation, status: g.status } : { id: g.id, role: 'student' as const, otherUserId: g.guardian_user_id, relation: g.relation, status: g.status }));
  }
}

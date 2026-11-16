import { Inject, Injectable } from '@nestjs/common';
import {
  type Announcement,
  type ClassMemberList,
  type CreateAnnouncementRequest,
  type CreateClassRequest,
  type CreateLessonRequest,
  type EnrollRequest,
  type SchoolLesson,
  type MyClass,
  type MyClassDetail,
  type MyClassList,
  type SchoolClass,
  type SchoolClassList,
  type SchoolRole,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | string) => new Date(d).toISOString();

type ClassRow = { id: string; name: string; year_label: string; n: number };
type MineRow = { id: string; name: string; year_label: string; school_name: string; role: SchoolRole };
const toMine = (r: MineRow): MyClass => ({ id: r.id, name: r.name, yearLabel: r.year_label, schoolName: r.school_name, role: r.role });

/** Classes of a school: staff (org.members.manage) manage them, enrolled people read them. Audit holds ids only, never names of pupils. */
@Injectable()
export class SchoolService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ---- Staff ------------------------------------------------------------------------------------

  private async assertSchool(orgId: string): Promise<void> {
    const r = await this.db.execute<{ kind: string }>(sql`SELECT kind FROM organizations WHERE id = ${orgId}::uuid`);
    if (r.rows[0]?.kind !== 'school') throw AppError.conflict('Only a school can manage classes', { reason: 'not_a_school' });
  }

  private async assertClass(orgId: string, classId: string): Promise<void> {
    if (!UUID_RE.test(classId)) throw AppError.notFound('Class not found');
    const r = await this.db.execute(sql`SELECT 1 FROM school_classes WHERE id = ${classId}::uuid AND org_id = ${orgId}::uuid`);
    if (r.rows.length === 0) throw AppError.notFound('Class not found');
  }

  async createClass(orgId: string, userId: string, body: CreateClassRequest, meta: RequestMeta): Promise<SchoolClass> {
    await this.assertSchool(orgId);
    try {
      const r = await this.db.execute<{ id: string }>(sql`INSERT INTO school_classes (org_id, name, year_label) VALUES (${orgId}::uuid, ${body.name}, ${body.yearLabel}) RETURNING id`);
      await this.audit.record({ action: 'school.class_created', actorUserId: userId, meta, metadata: { orgId, classId: r.rows[0]!.id } });
      return { id: r.rows[0]!.id, name: body.name, yearLabel: body.yearLabel, memberCount: 0 };
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
      if (code === '23505') throw AppError.conflict('This class already exists', { reason: 'duplicate_class' });
      throw e;
    }
  }

  async listClasses(orgId: string): Promise<SchoolClassList> {
    const r = await this.db.execute<ClassRow>(sql`
      SELECT c.id, c.name, c.year_label, (SELECT count(*)::int FROM school_enrollments e WHERE e.class_id = c.id) AS n
      FROM school_classes c WHERE c.org_id = ${orgId}::uuid ORDER BY c.year_label DESC, c.name LIMIT 200`);
    return { items: r.rows.map((c) => ({ id: c.id, name: c.name, yearLabel: c.year_label, memberCount: c.n })) };
  }

  async enroll(orgId: string, userId: string, classId: string, body: EnrollRequest, meta: RequestMeta): Promise<void> {
    await this.assertClass(orgId, classId);
    const u = await this.db.execute<{ id: string }>(sql`SELECT id FROM users WHERE handle = ${body.handle} AND status = 'active'`);
    if (!u.rows[0]) throw AppError.notFound('User not found');
    await this.db.execute(sql`
      INSERT INTO school_enrollments (class_id, user_id, role, added_by) VALUES (${classId}::uuid, ${u.rows[0].id}::uuid, ${body.role}, ${userId}::uuid)
      ON CONFLICT (class_id, user_id) DO UPDATE SET role = EXCLUDED.role`);
    await this.audit.record({ action: 'school.enrolled', actorUserId: userId, subjectUserId: u.rows[0].id, meta, metadata: { orgId, classId, role: body.role } });
  }

  async members(orgId: string, classId: string): Promise<ClassMemberList> {
    await this.assertClass(orgId, classId);
    const r = await this.db.execute<{ handle: string; display_name: string; role: SchoolRole }>(sql`
      SELECT u.handle::text AS handle, u.display_name, e.role FROM school_enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.class_id = ${classId}::uuid ORDER BY e.role, u.display_name LIMIT 500`);
    return { items: r.rows.map((m) => ({ handle: m.handle, displayName: m.display_name, role: m.role })) };
  }

  async unenroll(orgId: string, userId: string, classId: string, handle: string, meta: RequestMeta): Promise<void> {
    await this.assertClass(orgId, classId);
    const r = await this.db.execute<{ user_id: string }>(sql`
      DELETE FROM school_enrollments WHERE class_id = ${classId}::uuid AND user_id = (SELECT id FROM users WHERE handle = ${handle}) RETURNING user_id`);
    if (!r.rows[0]) throw AppError.notFound('This person is not in the class');
    await this.audit.record({ action: 'school.unenrolled', actorUserId: userId, subjectUserId: r.rows[0].user_id, meta, metadata: { orgId, classId } });
  }

  async addLesson(orgId: string, classId: string, body: CreateLessonRequest): Promise<SchoolLesson> {
    await this.assertClass(orgId, classId);
    const r = await this.db.execute<{ id: string }>(sql`
      INSERT INTO school_lessons (class_id, weekday, starts_at, ends_at, subject, room) VALUES (${classId}::uuid, ${body.weekday}, ${body.startsAt}, ${body.endsAt}, ${body.subject}, ${body.room}) RETURNING id`);
    return { id: r.rows[0]!.id, weekday: body.weekday, startsAt: body.startsAt, endsAt: body.endsAt, subject: body.subject, room: body.room };
  }

  async removeLesson(orgId: string, classId: string, lessonId: string): Promise<void> {
    await this.assertClass(orgId, classId);
    if (!UUID_RE.test(lessonId)) throw AppError.notFound('SchoolLesson not found');
    const r = await this.db.execute(sql`DELETE FROM school_lessons WHERE id = ${lessonId}::uuid AND class_id = ${classId}::uuid RETURNING id`);
    if (r.rows.length === 0) throw AppError.notFound('SchoolLesson not found');
  }

  async announce(orgId: string, userId: string, classId: string, body: CreateAnnouncementRequest, meta: RequestMeta): Promise<Announcement> {
    await this.assertClass(orgId, classId);
    const r = await this.db.execute<{ id: string; created_at: Date }>(sql`
      INSERT INTO school_announcements (class_id, author_id, title, body) VALUES (${classId}::uuid, ${userId}::uuid, ${body.title}, ${body.body}) RETURNING id, created_at`);
    await this.audit.record({ action: 'school.announced', actorUserId: userId, meta, metadata: { orgId, classId, announcementId: r.rows[0]!.id } });
    return { id: r.rows[0]!.id, title: body.title, body: body.body, createdAt: iso(r.rows[0]!.created_at) };
  }

  // ---- Enrolled people ---------------------------------------------------------------------------

  async myClasses(userId: string): Promise<MyClassList> {
    const r = await this.db.execute<MineRow>(sql`
      SELECT c.id, c.name, c.year_label, o.name AS school_name, e.role
      FROM school_enrollments e JOIN school_classes c ON c.id = e.class_id JOIN organizations o ON o.id = c.org_id
      WHERE e.user_id = ${userId}::uuid ORDER BY o.name, c.name LIMIT 100`);
    return { items: r.rows.map(toMine) };
  }

  /** Only an enrolled person sees a class (anyone else: 404). */
  async myClass(userId: string, classId: string): Promise<MyClassDetail> {
    if (!UUID_RE.test(classId)) throw AppError.notFound('Class not found');
    const c = await this.db.execute<MineRow>(sql`
      SELECT c.id, c.name, c.year_label, o.name AS school_name, e.role
      FROM school_enrollments e JOIN school_classes c ON c.id = e.class_id JOIN organizations o ON o.id = c.org_id
      WHERE e.user_id = ${userId}::uuid AND c.id = ${classId}::uuid`);
    if (!c.rows[0]) throw AppError.notFound('Class not found');
    const lessons = await this.db.execute<{ id: string; weekday: number; starts_at: string; ends_at: string; subject: string; room: string }>(sql`
      SELECT id, weekday, starts_at, ends_at, subject, room FROM school_lessons WHERE class_id = ${classId}::uuid ORDER BY weekday, starts_at`);
    const news = await this.db.execute<{ id: string; title: string; body: string; created_at: Date }>(sql`
      SELECT id, title, body, created_at FROM school_announcements WHERE class_id = ${classId}::uuid ORDER BY created_at DESC, id DESC LIMIT 30`);
    return {
      class: toMine(c.rows[0]),
      lessons: lessons.rows.map((l) => ({ id: l.id, weekday: l.weekday, startsAt: l.starts_at, endsAt: l.ends_at, subject: l.subject, room: l.room })),
      announcements: news.rows.map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: iso(a.created_at) })),
    };
  }

  /** The user's own enrolments, for the personal data export. */
  async exportFor(userId: string): Promise<{ schoolName: string; className: string; role: SchoolRole }[]> {
    const r = await this.myClasses(userId);
    return r.items.map((c) => ({ schoolName: c.schoolName, className: c.name, role: c.role }));
  }
}

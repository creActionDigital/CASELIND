import { randomInt } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ErrorCodes,
  type Certificate,
  type CertificateList,
  type CertificateVerification,
  type Course,
  type CourseDetail,
  type CourseList,
  type CourseListQuery,
  type CourseReview,
  type CourseReviewList,
  type CourseReviewRequest,
  type CourseStudents,
  type CreateCourseRequest,
  type EnrollmentList,
  type ExamHistory,
  type ExamResult,
  type ExamSession,
  type SetExamRequest,
  type Quiz,
  type QuizAttemptRequest,
  type QuizResult,
  type SetLessonsRequest,
  type SetQuizRequest,
  type UpdateCourseRequest,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EXAM_DAILY_LIMIT = 3;
const notFound = () => AppError.notFound('Course not found');
const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
const iso = (d: Date | string) => new Date(d).toISOString();

type Tx = Pick<Db, 'execute' | 'insert'>;

const encodeCursor = (at: Date, id: string) => Buffer.from(JSON.stringify([iso(at), id])).toString('base64url');
function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && !Number.isNaN(Date.parse(v[0])) && typeof v[1] === 'string' && UUID_RE.test(v[1])) return { at: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid cursor');
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const newCode = (): string => Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

type CourseRow = {
  id: string;
  title: string;
  description: string;
  level: Course['level'];
  language: Course['language'];
  status: Course['status'];
  pass_percent: number;
  created_at: Date;
  author_id: string;
  author_name: string;
  author_handle: string;
  lesson_count: number;
  question_count: number;
  enrolled: boolean;
  rating_avg: number | null;
  rating_count: number;
};

/** Visible to the viewer: the author, a learner already enrolled, or anyone while published, not hidden and not blocked with the author. */
const visibleSql = (viewerId: string): SQL => sql`(
  c.author_id = ${viewerId}::uuid
  OR EXISTS (SELECT 1 FROM course_enrollments e WHERE e.course_id = c.id AND e.user_id = ${viewerId}::uuid)
  OR (c.status = 'published' AND NOT c.hidden AND NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = c.author_id) OR (b.blocker_id = c.author_id AND b.blocked_id = ${viewerId}::uuid))))`;

const toCourse = (r: CourseRow, viewerId: string): Course => ({
  id: r.id,
  title: r.title,
  description: r.description,
  level: r.level,
  language: r.language,
  status: r.status,
  passPercent: r.pass_percent,
  author: { id: r.author_id, displayName: r.author_name, handle: r.author_handle },
  mine: r.author_id === viewerId,
  lessonCount: r.lesson_count,
  questionCount: r.question_count,
  enrolled: r.enrolled,
  ratingAvg: r.rating_avg,
  ratingCount: r.rating_count,
  createdAt: iso(r.created_at),
});

/** Courses with lessons, a quiz, progress tracking and verifiable certificates. */
@Injectable()
export class EducationService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationRegistry,
  ) {}

  onModuleInit(): void {
    this.moderation.register('course', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`SELECT 1 FROM courses c WHERE c.id = ${id}::uuid AND ${visibleSql(viewerId)}`);
        return res.rows.length > 0;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute<{ author_id: string }>(sql`SELECT author_id FROM courses WHERE id = ${id}::uuid`);
        return res.rows[0]?.author_id ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE courses SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
    this.moderation.register('course_review', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`
          SELECT 1 FROM course_reviews rv JOIN courses c ON c.id = rv.course_id
          WHERE rv.id = ${id}::uuid AND (NOT rv.hidden OR rv.user_id = ${viewerId}::uuid) AND ${visibleSql(viewerId)}`);
        return res.rows.length > 0;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute<{ user_id: string }>(sql`SELECT user_id FROM course_reviews WHERE id = ${id}::uuid`);
        return res.rows[0]?.user_id ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE course_reviews SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
  }

  // ---- Reviews (lot 17d) ------------------------------------------------------------------------

  /** Visible reviews, newest first; a hidden review stays visible to its own author only. */
  async reviews(viewerId: string, courseId: string, q: { limit: number; cursor?: string }): Promise<CourseReviewList> {
    await this.getCourse(viewerId, courseId);
    const f: SQL[] = [sql`rv.course_id = ${courseId}::uuid`, sql`(NOT rv.hidden OR rv.user_id = ${viewerId}::uuid)`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(rv.created_at, rv.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<{ id: string; rating: number; body: string; user_id: string; created_at: Date; display_name: string; handle: string }>(sql`
      SELECT rv.id, rv.rating, rv.body, rv.user_id, rv.created_at, u.display_name, u.handle::text AS handle
      FROM course_reviews rv JOIN users u ON u.id = rv.user_id WHERE ${sql.join(f, sql` AND `)}
      ORDER BY rv.created_at DESC, rv.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    const items: CourseReview[] = rows.map((r) => ({ id: r.id, rating: r.rating, body: r.body, author: { displayName: r.display_name, handle: r.handle }, mine: r.user_id === viewerId, createdAt: iso(r.created_at) }));
    return { items, nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.created_at, last.id) : null };
  }

  /** Create or replace my review. Enrolled learners only (so never the author, who cannot enroll). */
  async saveReview(userId: string, courseId: string, body: CourseReviewRequest, meta: RequestMeta): Promise<CourseDetail> {
    const course = await this.getCourse(userId, courseId);
    if (course.mine) throw AppError.forbidden('You cannot review your own course');
    if (!course.enrolled) throw AppError.forbidden('Enroll in the course before reviewing it');
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO course_reviews (course_id, user_id, rating, body) VALUES (${courseId}::uuid, ${userId}::uuid, ${body.rating}, ${body.body})
        ON CONFLICT (course_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = now()`);
      await this.audit.record({ action: 'education.review_saved', actorUserId: userId, meta, metadata: { courseId, rating: body.rating } }, tx);
    });
    return this.get(userId, courseId);
  }

  async deleteReview(userId: string, courseId: string, meta: RequestMeta): Promise<void> {
    await this.getCourse(userId, courseId);
    await this.db.transaction(async (tx) => {
      const cur = await tx.execute<{ hidden: boolean }>(sql`SELECT hidden FROM course_reviews WHERE course_id = ${courseId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`);
      if (!cur.rows[0]) throw AppError.notFound('Review not found');
      // A moderated review cannot be deleted and posted again as a fresh, visible one.
      if (cur.rows[0].hidden) throw AppError.conflict('This review was hidden by moderation', { reason: 'moderated' });
      await tx.execute(sql`DELETE FROM course_reviews WHERE course_id = ${courseId}::uuid AND user_id = ${userId}::uuid`);
      await this.audit.record({ action: 'education.review_deleted', actorUserId: userId, meta, metadata: { courseId } }, tx);
    });
  }

  // ---- Author side ------------------------------------------------------------------------------

  async create(userId: string, body: CreateCourseRequest, meta: RequestMeta): Promise<CourseDetail> {
    const id = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO courses (author_id, title, description, level, language) VALUES (${userId}::uuid, ${body.title}, ${body.description}, ${body.level}, ${body.language}) RETURNING id`);
      const courseId = res.rows[0]!.id;
      await this.audit.record({ action: 'education.course_created', actorUserId: userId, meta, metadata: { courseId } }, tx);
      return courseId;
    });
    return this.get(userId, id);
  }

  async update(userId: string, id: string, body: UpdateCourseRequest): Promise<CourseDetail> {
    const cur = await this.ownCourse(userId, id);
    await this.db.execute(sql`
      UPDATE courses SET title = ${body.title ?? cur.title}, description = ${body.description ?? cur.description}, level = ${body.level ?? cur.level},
        language = ${body.language ?? cur.language}, updated_at = now() WHERE id = ${id}::uuid`);
    return this.get(userId, id);
  }

  /** Replaces the lessons. Refused once someone is enrolled: it would erase their progress. */
  async setLessons(userId: string, id: string, body: SetLessonsRequest): Promise<CourseDetail> {
    await this.ownCourse(userId, id);
    await this.db.transaction(async (tx) => {
      await this.assertNoLearners(tx, id);
      await tx.execute(sql`DELETE FROM course_lessons WHERE course_id = ${id}::uuid`);
      for (const [position, l] of body.lessons.entries()) {
        await tx.execute(sql`INSERT INTO course_lessons (course_id, position, title, content) VALUES (${id}::uuid, ${position}, ${l.title}, ${l.content})`);
      }
    });
    return this.get(userId, id);
  }

  /** Replaces the quiz (an empty list removes it). Refused once someone is enrolled: attempts would no longer compare. */
  async setQuiz(userId: string, id: string, body: SetQuizRequest): Promise<CourseDetail> {
    await this.ownCourse(userId, id);
    await this.db.transaction(async (tx) => {
      await this.assertNoLearners(tx, id);
      await tx.execute(sql`DELETE FROM course_questions WHERE course_id = ${id}::uuid`);
      for (const [position, q] of body.questions.entries()) {
        await tx.execute(sql`
          INSERT INTO course_questions (course_id, position, prompt, options, correct_index)
          VALUES (${id}::uuid, ${position}, ${q.prompt}, ${JSON.stringify(q.options)}::jsonb, ${q.correctIndex})`);
      }
      await tx.execute(sql`UPDATE courses SET pass_percent = ${body.passPercent}, updated_at = now() WHERE id = ${id}::uuid`);
    });
    return this.get(userId, id);
  }

  async setPublished(userId: string, id: string, published: boolean, meta: RequestMeta): Promise<CourseDetail> {
    const cur = await this.ownCourse(userId, id);
    const target = published ? 'published' : 'draft';
    if (cur.status !== target) {
      if (published && cur.lessonCount === 0) throw AppError.conflict('Add at least one lesson before publishing', { reason: 'course_empty' });
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE courses SET status = ${target}, updated_at = now() WHERE id = ${id}::uuid`);
        await this.audit.record({ action: published ? 'education.course_published' : 'education.course_unpublished', actorUserId: userId, meta, metadata: { courseId: id } }, tx);
      });
    }
    return this.get(userId, id);
  }

  /** Author only: how many follow the course and how far each got. */
  async students(userId: string, id: string): Promise<CourseStudents> {
    await this.ownCourse(userId, id);
    const res = await this.db.execute<{ handle: string; display_name: string; done: number; total: number; completed: boolean }>(sql`
      SELECT u.handle::text AS handle, u.display_name,
        (SELECT count(*)::int FROM lesson_progress p WHERE p.enrollment_id = e.id) AS done,
        (SELECT count(*)::int FROM course_lessons l WHERE l.course_id = e.course_id) AS total,
        (e.completed_at IS NOT NULL) AS completed
      FROM course_enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = ${id}::uuid ORDER BY e.enrolled_at DESC LIMIT 200`);
    const items = res.rows.map((r) => ({ handle: r.handle, displayName: r.display_name, progressPercent: r.total === 0 ? 0 : Math.floor((r.done * 100) / r.total), completed: r.completed }));
    return { enrolledCount: items.length, completedCount: items.filter((i) => i.completed).length, items };
  }

  private async ownCourse(userId: string, id: string): Promise<Course> {
    const c = await this.getCourse(userId, id);
    if (!c.mine) throw notFound();
    return c;
  }

  private async assertNoLearners(tx: Tx, courseId: string): Promise<void> {
    const n = await tx.execute(sql`SELECT 1 FROM course_enrollments WHERE course_id = ${courseId}::uuid LIMIT 1`);
    if (n.rows.length > 0) throw AppError.conflict('Learners are already enrolled: lessons and quiz can no longer change', { reason: 'course_has_learners' });
  }

  // ---- Catalogue --------------------------------------------------------------------------------

  async list(viewerId: string, q: CourseListQuery): Promise<CourseList> {
    const f: SQL[] = [sql`c.status = 'published'`, sql`NOT c.hidden`, visibleSql(viewerId)];
    if (q.level) f.push(sql`c.level = ${q.level}`);
    if (q.language) f.push(sql`c.language = ${q.language}`);
    if (q.q) f.push(sql`(c.title ILIKE ${'%' + escapeLike(q.q) + '%'} OR c.description ILIKE ${'%' + escapeLike(q.q) + '%'})`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(c.created_at, c.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    return this.page(viewerId, f, q.limit);
  }

  async mine(userId: string, q: { limit: number; cursor?: string }): Promise<CourseList> {
    const f: SQL[] = [sql`c.author_id = ${userId}::uuid`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(c.created_at, c.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    return this.page(userId, f, q.limit);
  }

  private async page(viewerId: string, filters: SQL[], limit: number): Promise<CourseList> {
    const res = await this.db.execute<CourseRow>(sql`${this.base(viewerId)} WHERE ${sql.join(filters, sql` AND `)} ORDER BY c.created_at DESC, c.id DESC LIMIT ${limit + 1}`);
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => toCourse(r, viewerId)), nextCursor: res.rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null };
  }

  private base(viewerId: string): SQL {
    return sql`
      SELECT c.id, c.title, c.description, c.level, c.language, c.status, c.pass_percent, c.created_at,
        u.id AS author_id, u.display_name AS author_name, u.handle::text AS author_handle,
        (SELECT count(*)::int FROM course_lessons l WHERE l.course_id = c.id) AS lesson_count,
        (SELECT count(*)::int FROM course_questions q WHERE q.course_id = c.id) AS question_count,
        EXISTS (SELECT 1 FROM course_enrollments e WHERE e.course_id = c.id AND e.user_id = ${viewerId}::uuid) AS enrolled,
        (SELECT avg(rv.rating)::float8 FROM course_reviews rv WHERE rv.course_id = c.id AND NOT rv.hidden) AS rating_avg,
        (SELECT count(*)::int FROM course_reviews rv WHERE rv.course_id = c.id AND NOT rv.hidden) AS rating_count
      FROM courses c JOIN users u ON u.id = c.author_id`;
  }

  private async getCourse(viewerId: string, id: string): Promise<Course> {
    if (!UUID_RE.test(id)) throw notFound();
    const res = await this.db.execute<CourseRow>(sql`${this.base(viewerId)} WHERE c.id = ${id}::uuid AND ${visibleSql(viewerId)}`);
    if (!res.rows[0]) throw notFound();
    return toCourse(res.rows[0], viewerId);
  }

  /** The course with its lessons. The text of a lesson is for enrolled learners and the author only. */
  async get(viewerId: string, id: string): Promise<CourseDetail> {
    const course = await this.getCourse(viewerId, id);
    const enr = await this.db.execute<{ id: string; completed_at: Date | null }>(sql`SELECT id, completed_at FROM course_enrollments WHERE course_id = ${id}::uuid AND user_id = ${viewerId}::uuid`);
    const enrollment = enr.rows[0];
    const canRead = course.mine || !!enrollment;
    const lessons = await this.db.execute<{ id: string; position: number; title: string; content: string; done: boolean }>(sql`
      SELECT l.id, l.position, l.title, l.content,
        ${enrollment ? sql`EXISTS (SELECT 1 FROM lesson_progress p WHERE p.enrollment_id = ${enrollment.id}::uuid AND p.lesson_id = l.id)` : sql`false`} AS done
      FROM course_lessons l WHERE l.course_id = ${id}::uuid ORDER BY l.position`);
    const done = lessons.rows.filter((l) => l.done).length;
    let best: number | null = null;
    let code: string | null = null;
    if (enrollment) {
      const a = await this.db.execute<{ best: number | null }>(sql`SELECT max(score_percent)::int AS best FROM quiz_attempts WHERE enrollment_id = ${enrollment.id}::uuid`);
      best = a.rows[0]?.best ?? null;
      const c = await this.db.execute<{ code: string }>(sql`SELECT code FROM certificates WHERE enrollment_id = ${enrollment.id}::uuid`);
      code = c.rows[0]?.code ?? null;
    }
    return {
      ...course,
      lessons: lessons.rows.map((l) => ({ id: l.id, position: l.position, title: l.title, content: canRead ? l.content : null, done: l.done })),
      progressPercent: enrollment ? (lessons.rows.length === 0 ? 0 : Math.floor((done * 100) / lessons.rows.length)) : null,
      bestScorePercent: best,
      certificateCode: code,
      examMinutes: (await this.db.execute<{ m: number | null }>(sql`SELECT exam_minutes AS m FROM courses WHERE id = ${id}::uuid`)).rows[0]?.m ?? null,
    };
  }

  // ---- Learner side -----------------------------------------------------------------------------

  /** Idempotent. Not on your own course; only published courses (or ones you already follow). */
  async enroll(userId: string, id: string, meta: RequestMeta): Promise<CourseDetail> {
    const course = await this.getCourse(userId, id);
    if (course.mine) throw AppError.forbidden('You cannot enroll in your own course');
    if (!course.enrolled) {
      if (course.status !== 'published') throw notFound();
      await this.db.transaction(async (tx) => {
        const ins = await tx.execute(sql`INSERT INTO course_enrollments (course_id, user_id) VALUES (${id}::uuid, ${userId}::uuid) ON CONFLICT DO NOTHING`);
        if ((ins.rowCount ?? 0) > 0) await this.audit.record({ action: 'education.enrolled', actorUserId: userId, meta, metadata: { courseId: id } }, tx);
      });
    }
    return this.get(userId, id);
  }

  async completeLesson(userId: string, courseId: string, lessonId: string, meta: RequestMeta): Promise<CourseDetail> {
    if (!UUID_RE.test(courseId) || !UUID_RE.test(lessonId)) throw notFound();
    const code = await this.db.transaction(async (tx) => {
      const enr = await this.enrollmentOf(tx, userId, courseId);
      const lesson = await tx.execute(sql`SELECT 1 FROM course_lessons WHERE id = ${lessonId}::uuid AND course_id = ${courseId}::uuid`);
      if (lesson.rows.length === 0) throw notFound();
      await tx.execute(sql`INSERT INTO lesson_progress (enrollment_id, lesson_id) VALUES (${enr}::uuid, ${lessonId}::uuid) ON CONFLICT DO NOTHING`);
      return this.tryComplete(tx, enr, userId, courseId, meta);
    });
    if (code) await this.notifyCertificate(userId, courseId);
    return this.get(userId, courseId);
  }

  /** The quiz without its answer key, for the author and enrolled learners. */
  async quiz(userId: string, courseId: string): Promise<Quiz> {
    const course = await this.getCourse(userId, courseId);
    if (!course.mine && !course.enrolled) throw notFound();
    const res = await this.db.execute<{ id: string; prompt: string; options: string[] }>(sql`SELECT id, prompt, options FROM course_questions WHERE course_id = ${courseId}::uuid ORDER BY position`);
    if (res.rows.length === 0) throw AppError.notFound('This course has no quiz');
    return { passPercent: course.passPercent, questions: res.rows };
  }

  /** Grades one attempt (answers in question order). Unlimited retries; the best result counts. */
  async attempt(userId: string, courseId: string, body: QuizAttemptRequest, meta: RequestMeta): Promise<QuizResult> {
    if (!UUID_RE.test(courseId)) throw notFound();
    const out = await this.db.transaction(async (tx) => {
      const enr = await this.enrollmentOf(tx, userId, courseId);
      const qs = await tx.execute<{ correct_index: number; n_options: number }>(sql`
        SELECT correct_index, jsonb_array_length(options)::int AS n_options FROM course_questions WHERE course_id = ${courseId}::uuid ORDER BY position`);
      if (qs.rows.length === 0) throw AppError.notFound('This course has no quiz');
      if (body.answers.length !== qs.rows.length) throw invalid('answers', `expected ${qs.rows.length} answers`);
      if (body.answers.some((a, i) => a >= qs.rows[i]!.n_options)) throw invalid('answers', 'an answer points to an option that does not exist');
      const correct = body.answers.filter((a, i) => a === qs.rows[i]!.correct_index).length;
      const total = qs.rows.length;
      const score = Math.floor((correct * 100) / total);
      const pass = await tx.execute<{ pass_percent: number }>(sql`SELECT pass_percent FROM courses WHERE id = ${courseId}::uuid`);
      const passed = score >= (pass.rows[0]?.pass_percent ?? 70);
      await tx.execute(sql`INSERT INTO quiz_attempts (enrollment_id, score_percent, passed) VALUES (${enr}::uuid, ${score}, ${passed})`);
      await this.audit.record({ action: 'education.quiz_attempted', actorUserId: userId, meta, metadata: { courseId, scorePercent: score, passed } }, tx);
      const code = await this.tryComplete(tx, enr, userId, courseId, meta);
      return { scorePercent: score, passed, correct, total, certificateCode: code };
    });
    if (out.certificateCode) await this.notifyCertificate(userId, courseId);
    if (!out.certificateCode) {
      const have = await this.db.execute<{ code: string }>(sql`SELECT ce.code FROM certificates ce JOIN course_enrollments e ON e.id = ce.enrollment_id WHERE e.course_id = ${courseId}::uuid AND e.user_id = ${userId}::uuid`);
      out.certificateCode = have.rows[0]?.code ?? null;
    }
    return out;
  }

  // ---- Timed mock exams (lot 17f) ---------------------------------------------------------------

  /** Author only: sets (or clears) the mock exam duration. Needs a quiz. */
  async setExam(userId: string, id: string, body: SetExamRequest, meta: RequestMeta): Promise<CourseDetail> {
    const c = await this.ownCourse(userId, id);
    if (body.examMinutes !== null && c.questionCount === 0) throw AppError.conflict('Add a quiz before enabling the mock exam', { reason: 'no_quiz' });
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE courses SET exam_minutes = ${body.examMinutes}, updated_at = now() WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'education.exam_configured', actorUserId: userId, meta, metadata: { courseId: id, examMinutes: body.examMinutes } }, tx);
    });
    return this.get(userId, id);
  }

  /** Starts a session (or returns the one still open): the quiz questions in random order, without answers. 3 sessions a day (UTC) and course. */
  async startExam(userId: string, courseId: string, meta: RequestMeta): Promise<ExamSession> {
    if (!UUID_RE.test(courseId)) throw notFound();
    return this.db.transaction(async (tx) => {
      const enr = await this.enrollmentOf(tx, userId, courseId);
      await tx.execute(sql`SELECT 1 FROM course_enrollments WHERE id = ${enr}::uuid FOR UPDATE`);
      const minutes = (await tx.execute<{ m: number | null }>(sql`SELECT exam_minutes AS m FROM courses WHERE id = ${courseId}::uuid`)).rows[0]?.m;
      if (!minutes) throw AppError.conflict('This course has no mock exam', { reason: 'exam_not_enabled' });
      const qs = await tx.execute<{ id: string; prompt: string; options: string[] }>(sql`SELECT id, prompt, options FROM course_questions WHERE course_id = ${courseId}::uuid ORDER BY position`);
      if (qs.rows.length === 0) throw AppError.conflict('This course has no quiz', { reason: 'no_quiz' });
      const byId = new Map(qs.rows.map((q) => [q.id, q]));
      type S = { id: string; started_at: Date; expires_at: Date; question_ids: string[] };
      const open = await tx.execute<S>(sql`SELECT id, started_at, expires_at, question_ids FROM exam_sessions WHERE enrollment_id = ${enr}::uuid AND finished_at IS NULL AND expires_at > now() ORDER BY started_at DESC LIMIT 1`);
      let s = open.rows[0];
      if (!s) {
        const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM exam_sessions WHERE enrollment_id = ${enr}::uuid AND started_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`);
        if ((n.rows[0]?.n ?? 0) >= EXAM_DAILY_LIMIT) throw AppError.conflict('Daily limit of mock exams reached', { reason: 'daily_limit' });
        const order = qs.rows.map((q) => q.id);
        for (let i = order.length - 1; i > 0; i -= 1) {
          const j = randomInt(i + 1);
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        const ins = await tx.execute<S>(sql`
          INSERT INTO exam_sessions (enrollment_id, user_id, course_id, question_ids, expires_at, total)
          VALUES (${enr}::uuid, ${userId}::uuid, ${courseId}::uuid, (SELECT array_agg(v::uuid ORDER BY o) FROM jsonb_array_elements_text(${JSON.stringify(order)}::jsonb) WITH ORDINALITY AS t(v, o)), now() + make_interval(mins => ${minutes}), ${order.length})
          RETURNING id, started_at, expires_at, question_ids`);
        s = ins.rows[0]!;
        await this.audit.record({ action: 'education.exam_started', actorUserId: userId, meta, metadata: { courseId, sessionId: s.id } }, tx);
      }
      return {
        id: s.id,
        startedAt: iso(s.started_at),
        expiresAt: iso(s.expires_at),
        durationMinutes: minutes,
        questions: s.question_ids.flatMap((q) => byId.get(q) ?? []),
      };
    });
  }

  /** Grades once, up to 5 seconds after the deadline (grace for the network); then 409 expired. No certificate, no touch to quiz_attempts. */
  async submitExam(userId: string, courseId: string, sessionId: string, body: QuizAttemptRequest, meta: RequestMeta): Promise<ExamResult> {
    if (!UUID_RE.test(courseId) || !UUID_RE.test(sessionId)) throw notFound();
    return this.db.transaction(async (tx) => {
      const res = await tx.execute<{ question_ids: string[]; finished_at: Date | null; late: boolean; used: number }>(sql`
        SELECT question_ids, finished_at, (now() > expires_at + interval '5 seconds') AS late,
          GREATEST(0, round(extract(epoch FROM (LEAST(now(), expires_at) - started_at))))::int AS used
        FROM exam_sessions WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid AND course_id = ${courseId}::uuid FOR UPDATE`);
      const s = res.rows[0];
      if (!s) throw AppError.notFound('Exam session not found');
      if (s.finished_at) throw AppError.conflict('This exam is already finished', { reason: 'already_finished' });
      if (s.late) throw AppError.conflict('Time is up', { reason: 'expired' });
      if (body.answers.length !== s.question_ids.length) throw invalid('answers', `expected ${s.question_ids.length} answers`);
      const keys = await tx.execute<{ id: string; correct_index: number; n: number }>(sql`
        SELECT id, correct_index, jsonb_array_length(options)::int AS n FROM course_questions WHERE course_id = ${courseId}::uuid`);
      const byId = new Map(keys.rows.map((k) => [k.id, k]));
      // A question the author deleted after the session started is left out of the grade instead of blocking the submission.
      const live = s.question_ids.map((qid, i) => ({ k: byId.get(qid), a: body.answers[i]! })).filter((x): x is { k: { id: string; correct_index: number; n: number }; a: number } => !!x.k);
      if (live.some((x) => x.a >= x.k.n)) throw invalid('answers', 'an answer points to an option that does not exist');
      const total = live.length;
      const correct = live.filter((x) => x.a === x.k.correct_index).length;
      const score = total === 0 ? 0 : Math.floor((correct * 100) / total);
      const pass = (await tx.execute<{ p: number }>(sql`SELECT pass_percent AS p FROM courses WHERE id = ${courseId}::uuid`)).rows[0]?.p ?? 70;
      await tx.execute(sql`UPDATE exam_sessions SET finished_at = now(), score_percent = ${score}, correct = ${correct} WHERE id = ${sessionId}::uuid`);
      await this.audit.record({ action: 'education.exam_finished', actorUserId: userId, meta, metadata: { courseId, sessionId, scorePercent: score } }, tx);
      return { scorePercent: score, correct, total, passed: score >= pass, usedSeconds: s.used };
    });
  }

  /** Own finished attempts, newest first, and how many sessions remain today. */
  async examHistory(userId: string, courseId: string): Promise<ExamHistory> {
    if (!UUID_RE.test(courseId)) throw notFound();
    const enr = await this.enrollmentOf(this.db, userId, courseId);
    const res = await this.db.execute<{ id: string; started_at: Date; score_percent: number; used: number }>(sql`
      SELECT id, started_at, score_percent, round(extract(epoch FROM (finished_at - started_at)))::int AS used
      FROM exam_sessions WHERE enrollment_id = ${enr}::uuid AND finished_at IS NOT NULL ORDER BY started_at DESC, id DESC LIMIT 50`);
    const today = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM exam_sessions WHERE enrollment_id = ${enr}::uuid AND started_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`);
    return {
      attemptsLeftToday: Math.max(0, EXAM_DAILY_LIMIT - (today.rows[0]?.n ?? 0)),
      items: res.rows.map((r) => ({ id: r.id, startedAt: iso(r.started_at), scorePercent: r.score_percent, usedSeconds: r.used })),
    };
  }

  async myEnrollments(userId: string, q: { limit: number; cursor?: string }): Promise<EnrollmentList> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<{ course_id: string; title: string; author: string; done: number; total: number; completed: boolean; enrolled_at: Date; id: string; code: string | null }>(sql`
      SELECT e.id, e.course_id, c.title, u.display_name AS author, e.enrolled_at, (e.completed_at IS NOT NULL) AS completed,
        (SELECT count(*)::int FROM lesson_progress p WHERE p.enrollment_id = e.id) AS done,
        (SELECT count(*)::int FROM course_lessons l WHERE l.course_id = e.course_id) AS total,
        (SELECT ce.code FROM certificates ce WHERE ce.enrollment_id = e.id) AS code
      FROM course_enrollments e JOIN courses c ON c.id = e.course_id JOIN users u ON u.id = c.author_id
      WHERE e.user_id = ${userId}::uuid ${cursor ? sql`AND (e.enrolled_at, e.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY e.enrolled_at DESC, e.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({
        courseId: r.course_id,
        title: r.title,
        author: r.author,
        progressPercent: r.total === 0 ? 0 : Math.floor((r.done * 100) / r.total),
        completed: r.completed,
        certificateCode: r.code,
        enrolledAt: iso(r.enrolled_at),
      })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.enrolled_at, last.id) : null,
    };
  }

  async myCertificates(userId: string): Promise<CertificateList> {
    const res = await this.db.execute<{ code: string; course_id: string; title: string; name: string; issued_at: Date }>(sql`
      SELECT ce.code, ce.course_id, c.title, u.display_name AS name, ce.issued_at
      FROM certificates ce JOIN courses c ON c.id = ce.course_id JOIN users u ON u.id = ce.user_id WHERE ce.user_id = ${userId}::uuid ORDER BY ce.issued_at DESC`);
    return { items: res.rows.map((r): Certificate => ({ code: r.code, courseId: r.course_id, courseTitle: r.title, holderName: r.name, issuedAt: iso(r.issued_at) })) };
  }

  /** Public: anyone with the code can check a certificate (holder name, course, date). A wrong code is a plain 404. */
  async verify(code: string): Promise<CertificateVerification> {
    if (!/^[A-Z0-9]{12}$/.test(code)) throw AppError.notFound('Certificate not found');
    const res = await this.db.execute<{ title: string; name: string; issued_at: Date }>(sql`
      SELECT c.title, u.display_name AS name, ce.issued_at FROM certificates ce JOIN courses c ON c.id = ce.course_id JOIN users u ON u.id = ce.user_id WHERE ce.code = ${code}`);
    const r = res.rows[0];
    if (!r) throw AppError.notFound('Certificate not found');
    return { valid: true, courseTitle: r.title, holderName: r.name, issuedAt: iso(r.issued_at) };
  }

  private async enrollmentOf(tx: Tx, userId: string, courseId: string): Promise<string> {
    const res = await tx.execute<{ id: string }>(sql`SELECT id FROM course_enrollments WHERE course_id = ${courseId}::uuid AND user_id = ${userId}::uuid`);
    if (!res.rows[0]) throw notFound();
    return res.rows[0].id;
  }

  /** Completes the enrollment and issues the certificate when every lesson is done and, if there is a quiz, it was passed. Returns the new code. */
  private async tryComplete(tx: Tx, enrollmentId: string, userId: string, courseId: string, meta: RequestMeta): Promise<string | null> {
    const st = await tx.execute<{ done: boolean; quiz_ok: boolean; completed: boolean }>(sql`
      SELECT
        (SELECT count(*) FROM course_lessons WHERE course_id = ${courseId}::uuid) > 0
          AND (SELECT count(*) FROM course_lessons l WHERE l.course_id = ${courseId}::uuid AND NOT EXISTS (SELECT 1 FROM lesson_progress p WHERE p.enrollment_id = ${enrollmentId}::uuid AND p.lesson_id = l.id)) = 0 AS done,
        (NOT EXISTS (SELECT 1 FROM course_questions WHERE course_id = ${courseId}::uuid)
          OR EXISTS (SELECT 1 FROM quiz_attempts WHERE enrollment_id = ${enrollmentId}::uuid AND passed)) AS quiz_ok,
        (SELECT completed_at IS NOT NULL FROM course_enrollments WHERE id = ${enrollmentId}::uuid) AS completed`);
    const s = st.rows[0];
    if (!s || s.completed || !s.done || !s.quiz_ok) return null;
    await tx.execute(sql`UPDATE course_enrollments SET completed_at = now() WHERE id = ${enrollmentId}::uuid`);
    for (let i = 0; i < 5; i += 1) {
      const code = newCode();
      const ins = await tx.execute(sql`INSERT INTO certificates (code, enrollment_id, user_id, course_id) VALUES (${code}, ${enrollmentId}::uuid, ${userId}::uuid, ${courseId}::uuid) ON CONFLICT (code) DO NOTHING`);
      if ((ins.rowCount ?? 0) > 0) {
        await this.audit.record({ action: 'education.certificate_issued', actorUserId: userId, meta, metadata: { courseId } }, tx);
        return code;
      }
    }
    throw new AppError(500, ErrorCodes.internal, 'Could not issue a certificate code');
  }

  private async notifyCertificate(userId: string, courseId: string): Promise<void> {
    const res = await this.db.execute<{ title: string }>(sql`SELECT title FROM courses WHERE id = ${courseId}::uuid`);
    await this.notifications.notify({ userId, category: 'system', title: res.rows[0]?.title ?? 'Cours', body: 'Félicitations, votre certificat est disponible.', data: { courseId } });
  }
}

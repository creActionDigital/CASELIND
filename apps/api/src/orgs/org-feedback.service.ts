import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ORG_QUESTIONS_PER_DAY,
  type MyOrgQuestion,
  type MyOrgQuestionList,
  type MyStoreReview,
  type OrgQuestion,
  type OrgQuestionList,
  type OrgQuestionListQuery,
  type PublicOrgQuestionList,
  type SaveStoreReviewRequest,
  type StoreReview,
  type StoreReviewList,
  type StoreReviewListQuery,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../orders/orders.shared.js';
import { orgNotFound } from './org.guard.js';

const PUBLIC_ORG: SQL = sql`o.visibility = 'public' AND o.status = 'active'`;
const iso = (d: Date | string) => new Date(d).toISOString();
const reviewNotFound = () => AppError.notFound('Review not found');
const questionNotFound = () => AppError.notFound('Question not found');

type ReviewRow = {
  id: string;
  rating: number;
  body: string | null;
  reply: string | null;
  replied_at: Date | null;
  created_at: Date;
  updated_at: Date;
  exact: string;
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
};
const REVIEW_COLS = sql`r.id, r.rating, r.body, r.reply, r.replied_at, r.created_at, r.updated_at, r.created_at::text AS exact,
  u.id AS user_id, u.handle::text AS handle, u.display_name, u.avatar_url`;
const toReview = (r: ReviewRow): StoreReview => ({
  id: r.id,
  rating: r.rating,
  body: r.body,
  author: { userId: r.user_id, handle: r.handle, displayName: r.display_name, avatarUrl: r.avatar_url },
  reply: r.reply && r.replied_at ? { body: r.reply, repliedAt: iso(r.replied_at) } : null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

type QuestionRow = {
  id: string;
  question: string;
  answer: string | null;
  answered_at: Date | null;
  created_at: Date;
  exact: string;
};

/**
 * Reviews of an organisation by its buyers, and questions from visitors answered by the organisation.
 * Audit holds ids, rating and organisation only, never the text; notifications are generic (no text either).
 */
@Injectable()
export class OrgFeedbackService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly moderation: ModerationRegistry,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    const staffOf = (userId: string, orgCol: SQL) => sql`EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = ${orgCol} AND m.user_id = ${userId}::uuid AND m.status = 'active')`;
    this.moderation.register('org_review', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`SELECT 1 FROM org_reviews r JOIN organizations o ON o.id = r.org_id WHERE r.id = ${id}::uuid
          AND ((${PUBLIC_ORG} AND NOT r.hidden) OR r.user_id = ${viewerId}::uuid OR ${staffOf(viewerId, sql`r.org_id`)})`);
        return res.rows.length > 0;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute<{ a: string }>(sql`SELECT user_id AS a FROM org_reviews WHERE id = ${id}::uuid`);
        return res.rows[0]?.a ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE org_reviews SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
    // An unanswered question is private to its author and the organisation: only answered ones can be reported by others.
    this.moderation.register('org_question', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`SELECT 1 FROM org_questions q JOIN organizations o ON o.id = q.org_id WHERE q.id = ${id}::uuid
          AND ((${PUBLIC_ORG} AND NOT q.hidden AND q.answer IS NOT NULL) OR q.asker_user_id = ${viewerId}::uuid OR ${staffOf(viewerId, sql`q.org_id`)})`);
        return res.rows.length > 0;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute<{ a: string }>(sql`SELECT asker_user_id AS a FROM org_questions WHERE id = ${id}::uuid`);
        return res.rows[0]?.a ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE org_questions SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
  }

  /** Public and active organisations only: anything else (private, suspended, unknown) is a plain 404. */
  private async publicOrg(slugOrId: { slug: string } | { id: string }): Promise<{ id: string; name: string }> {
    const where = 'slug' in slugOrId ? sql`o.slug = ${slugOrId.slug}` : sql`o.id = ${slugOrId.id}::uuid`;
    if ('id' in slugOrId && !UUID_RE.test(slugOrId.id)) throw orgNotFound();
    const res = await this.db.execute<{ id: string; name: string }>(sql`SELECT o.id, o.name FROM organizations o WHERE ${where} AND ${PUBLIC_ORG}`);
    if (!res.rows[0]) throw orgNotFound();
    return res.rows[0];
  }

  private async isMember(orgId: string, userId: string): Promise<boolean> {
    const res = await this.db.execute(sql`SELECT 1 FROM org_members WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND status = 'active'`);
    return res.rows.length > 0;
  }

  // ---- Reviews ----------------------------------------------------------------------------------

  private async deliveredOrder(orgId: string, userId: string): Promise<string | null> {
    const res = await this.db.execute<{ id: string }>(sql`SELECT id FROM orders WHERE org_id = ${orgId}::uuid AND buyer_id = ${userId}::uuid AND status = 'delivered' ORDER BY created_at DESC LIMIT 1`);
    return res.rows[0]?.id ?? null;
  }

  private async reviewPage(orgId: string, q: StoreReviewListQuery, viewerId: string | null, staff: boolean): Promise<StoreReviewList> {
    const f: SQL[] = [sql`r.org_id = ${orgId}::uuid`, sql`NOT r.hidden`];
    if (staff && q.status === 'unanswered') f.push(sql`r.reply IS NULL`);
    // Public list with a token: authors blocked with the reader (either way) are left out. Anonymous readers see all.
    if (!staff && viewerId) f.push(sql`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = r.user_id) OR (b.blocker_id = r.user_id AND b.blocked_id = ${viewerId}::uuid))`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(r.created_at, r.id) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<ReviewRow>(sql`SELECT ${REVIEW_COLS} FROM org_reviews r JOIN users u ON u.id = r.user_id
      WHERE ${sql.join(f, sql` AND `)} ORDER BY r.created_at DESC, r.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows.at(-1);
    return { items: rows.map(toReview), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.exact, last.id) : null };
  }

  /** viewerId: optional token of the reader, only to skip blocked authors. */
  async publicReviews(slug: string, q: StoreReviewListQuery, viewerId: string | null): Promise<StoreReviewList> {
    const org = await this.publicOrg({ slug });
    return this.reviewPage(org.id, q, viewerId, false);
  }

  staffReviews(orgId: string, q: StoreReviewListQuery): Promise<StoreReviewList> {
    return this.reviewPage(orgId, q, null, true);
  }

  private async reviewOf(orgId: string, userId: string): Promise<{ review: StoreReview; hidden: boolean } | null> {
    const res = await this.db.execute<ReviewRow & { hidden: boolean }>(sql`SELECT ${REVIEW_COLS}, r.hidden FROM org_reviews r JOIN users u ON u.id = r.user_id
      WHERE r.org_id = ${orgId}::uuid AND r.user_id = ${userId}::uuid`);
    return res.rows[0] ? { review: toReview(res.rows[0]), hidden: res.rows[0].hidden } : null;
  }

  async myReview(userId: string, orgId: string): Promise<MyStoreReview> {
    const org = await this.publicOrg({ id: orgId });
    const mine = await this.reviewOf(org.id, userId);
    const canReview = !(await this.isMember(org.id, userId)) && (mine !== null || (await this.deliveredOrder(org.id, userId)) !== null);
    return { canReview, review: mine?.review ?? null, hidden: mine?.hidden ?? false };
  }

  /** Creates or replaces the caller's review. Only a buyer of a delivered order of the organisation (not one of its members). */
  async saveReview(userId: string, orgId: string, b: SaveStoreReviewRequest, meta: RequestMeta): Promise<StoreReview> {
    const org = await this.publicOrg({ id: orgId });
    if (await this.isMember(org.id, userId)) throw new AppError(403, 'forbidden', 'Members cannot review their own organization', { reason: 'member' });
    const orderId = await this.deliveredOrder(org.id, userId);
    if (!orderId) throw new AppError(403, 'forbidden', 'Only buyers of a delivered order can review this organization', { reason: 'not_purchased' });
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO org_reviews (org_id, user_id, order_id, rating, body) VALUES (${org.id}::uuid, ${userId}::uuid, ${orderId}::uuid, ${b.rating}, ${b.body ?? null})
        ON CONFLICT (org_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = now() WHERE NOT org_reviews.hidden
        RETURNING id`);
      // A moderated review cannot be edited into a fresh, visible one.
      if (!r.rows[0]) throw AppError.conflict('This review was hidden by moderation', { reason: 'moderated' });
      await this.audit.record({ action: 'org.review_saved', actorUserId: userId, meta, metadata: { orgId: org.id, reviewId: r.rows[0].id, rating: b.rating } }, tx);
    });
    return (await this.reviewOf(org.id, userId))!.review;
  }

  async deleteReview(userId: string, orgId: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(orgId)) throw reviewNotFound();
    await this.db.transaction(async (tx) => {
      const cur = await tx.execute<{ id: string; hidden: boolean }>(sql`SELECT id, hidden FROM org_reviews WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`);
      if (!cur.rows[0]) throw reviewNotFound();
      if (cur.rows[0].hidden) throw AppError.conflict('This review was hidden by moderation', { reason: 'moderated' });
      await tx.execute(sql`DELETE FROM org_reviews WHERE id = ${cur.rows[0].id}::uuid`);
      await this.audit.record({ action: 'org.review_deleted', actorUserId: userId, meta, metadata: { orgId, reviewId: cur.rows[0].id } }, tx);
    });
  }

  /** One reply per review (a new reply replaces it). The review must belong to the organisation and not be hidden. */
  async replyReview(orgId: string, actorId: string, reviewId: string, body: string, meta: RequestMeta): Promise<StoreReview> {
    if (!UUID_RE.test(reviewId)) throw reviewNotFound();
    const authorId = await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ user_id: string }>(sql`UPDATE org_reviews SET reply = ${body}, replied_at = now(), replied_by = ${actorId}::uuid
        WHERE id = ${reviewId}::uuid AND org_id = ${orgId}::uuid AND NOT hidden RETURNING user_id`);
      if (!r.rows[0]) throw reviewNotFound();
      await this.audit.record({ action: 'org.review_replied', actorUserId: actorId, meta, metadata: { orgId, reviewId } }, tx);
      return r.rows[0].user_id;
    });
    await this.notifications.notify({ userId: authorId, category: 'commerce', title: 'Réponse de la boutique', body: 'La boutique a répondu à votre avis.', data: { orgId, reviewId } });
    return (await this.reviewOf(orgId, authorId))!.review;
  }

  // ---- Questions --------------------------------------------------------------------------------

  /** A signed-in account, not a member of the organisation, not blocked with any member; 5 per rolling 24 h. */
  async ask(userId: string, orgId: string, question: string, meta: RequestMeta): Promise<MyOrgQuestion> {
    const org = await this.publicOrg({ id: orgId });
    if (await this.isMember(org.id, userId)) throw new AppError(403, 'forbidden', 'Members cannot ask their own organization', { reason: 'member' });
    // A block must not leak: a blocked visitor gets the same 404 as for an unknown organisation.
    const blocked = await this.db.execute(sql`SELECT 1 FROM org_members m JOIN user_blocks b ON (b.blocker_id = m.user_id AND b.blocked_id = ${userId}::uuid) OR (b.blocker_id = ${userId}::uuid AND b.blocked_id = m.user_id)
      WHERE m.org_id = ${org.id}::uuid AND m.status = 'active' LIMIT 1`);
    if (blocked.rows.length > 0) throw orgNotFound();
    const id = await this.db.transaction(async (tx) => {
      // Serialises one account's questions so the daily cap cannot be overshot by parallel requests.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'org_question:' + userId}, 0))`);
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM org_questions WHERE asker_user_id = ${userId}::uuid AND created_at > now() - interval '24 hours'`);
      if ((n.rows[0]?.n ?? 0) >= ORG_QUESTIONS_PER_DAY) throw AppError.conflict(`At most ${ORG_QUESTIONS_PER_DAY} questions per day`, { reason: 'rate_limited', limit: ORG_QUESTIONS_PER_DAY });
      const r = await tx.execute<{ id: string }>(sql`INSERT INTO org_questions (org_id, asker_user_id, question) VALUES (${org.id}::uuid, ${userId}::uuid, ${question}) RETURNING id`);
      await this.audit.record({ action: 'org.question_asked', actorUserId: userId, meta, metadata: { orgId: org.id, questionId: r.rows[0]!.id } }, tx);
      return r.rows[0]!.id;
    });
    const staff = await this.db.execute<{ user_id: string }>(sql`SELECT user_id FROM org_members WHERE org_id = ${org.id}::uuid AND status = 'active' AND role IN ('owner', 'admin') AND user_id <> ${userId}::uuid`);
    for (const s of staff.rows) {
      await this.notifications.notify({ userId: s.user_id, category: 'commerce', title: 'Nouvelle question', body: 'Un visiteur a posé une question sur votre vitrine.', data: { orgId: org.id, questionId: id } });
    }
    return (await this.myQuestions(userId, { limit: 1 }, id)).items[0]!;
  }

  private mine(r: QuestionRow & { hidden: boolean; org_id: string; slug: string; name: string }): MyOrgQuestion {
    return {
      id: r.id,
      org: { id: r.org_id, slug: r.slug, name: r.name },
      question: r.question,
      answer: r.answer,
      answeredAt: r.answered_at ? iso(r.answered_at) : null,
      hidden: r.hidden,
      createdAt: iso(r.created_at),
    };
  }

  /** The author's own questions, newest first (answered or not; hidden ones included for them). */
  async myQuestions(userId: string, q: { limit: number; cursor?: string }, onlyId?: string): Promise<MyOrgQuestionList> {
    const f: SQL[] = [sql`q.asker_user_id = ${userId}::uuid`];
    if (onlyId) f.push(sql`q.id = ${onlyId}::uuid`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(q.created_at, q.id) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<QuestionRow & { hidden: boolean; org_id: string; slug: string; name: string }>(sql`
      SELECT q.id, q.question, q.answer, q.answered_at, q.created_at, q.created_at::text AS exact, q.hidden, o.id AS org_id, o.slug, o.name
      FROM org_questions q JOIN organizations o ON o.id = q.org_id WHERE ${sql.join(f, sql` AND `)} ORDER BY q.created_at DESC, q.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows.at(-1);
    return { items: rows.map((r) => this.mine(r)), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.exact, last.id) : null };
  }

  /** No token: answered, not hidden questions only, newest answer first. The asker stays anonymous. */
  async publicQuestions(slug: string, q: { limit: number; cursor?: string }): Promise<PublicOrgQuestionList> {
    const org = await this.publicOrg({ slug });
    const f: SQL[] = [sql`q.org_id = ${org.id}::uuid`, sql`q.answer IS NOT NULL`, sql`NOT q.hidden`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(q.answered_at, q.id) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<QuestionRow & { exact_answered: string }>(sql`
      SELECT q.id, q.question, q.answer, q.answered_at, q.created_at, q.answered_at::text AS exact_answered
      FROM org_questions q WHERE ${sql.join(f, sql` AND `)} ORDER BY q.answered_at DESC, q.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((r) => ({ id: r.id, question: r.question, answer: r.answer!, answeredAt: iso(r.answered_at!), createdAt: iso(r.created_at) })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.exact_answered, last.id) : null,
    };
  }

  /** Staff view, newest first; questions hidden by moderation are left out. */
  async staffQuestions(orgId: string, q: OrgQuestionListQuery): Promise<OrgQuestionList> {
    const f: SQL[] = [sql`q.org_id = ${orgId}::uuid`, sql`NOT q.hidden`];
    if (q.status === 'pending') f.push(sql`q.answer IS NULL`);
    if (q.status === 'answered') f.push(sql`q.answer IS NOT NULL`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(q.created_at, q.id) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<QuestionRow & { asker_id: string; handle: string; display_name: string }>(sql`
      SELECT q.id, q.question, q.answer, q.answered_at, q.created_at, q.created_at::text AS exact, u.id AS asker_id, u.handle::text AS handle, u.display_name
      FROM org_questions q JOIN users u ON u.id = q.asker_user_id WHERE ${sql.join(f, sql` AND `)} ORDER BY q.created_at DESC, q.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((r): OrgQuestion => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        answeredAt: r.answered_at ? iso(r.answered_at) : null,
        createdAt: iso(r.created_at),
        asker: { userId: r.asker_id, handle: r.handle, displayName: r.display_name },
      })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.exact, last.id) : null,
    };
  }

  /** Answers (or edits the answer of) a question of the organisation; the author is notified the first time. */
  async answer(orgId: string, actorId: string, id: string, answer: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw questionNotFound();
    const first = await this.db.transaction(async (tx) => {
      const cur = (await tx.execute<{ asker_user_id: string; answer: string | null }>(sql`SELECT asker_user_id, answer FROM org_questions
        WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid AND NOT hidden FOR UPDATE`)).rows[0];
      if (!cur) throw questionNotFound();
      await tx.execute(sql`UPDATE org_questions SET answer = ${answer}, answered_at = now(), answered_by = ${actorId}::uuid WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'org.question_answered', actorUserId: actorId, meta, metadata: { orgId, questionId: id } }, tx);
      return cur.answer === null ? cur.asker_user_id : null;
    });
    if (first) await this.notifications.notify({ userId: first, category: 'commerce', title: 'Réponse à votre question', body: 'Une boutique a répondu à votre question.', data: { orgId, questionId: id } });
  }

  async removeQuestion(orgId: string, actorId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw questionNotFound();
    await this.db.transaction(async (tx) => {
      const r = await tx.execute(sql`DELETE FROM org_questions WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid RETURNING id`);
      if (r.rows.length === 0) throw questionNotFound();
      await this.audit.record({ action: 'org.question_deleted', actorUserId: actorId, meta, metadata: { orgId, questionId: id } }, tx);
    });
  }
}

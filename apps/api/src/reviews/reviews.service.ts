import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type CreateReviewRequest,
  type Review,
  type ReviewList,
  type ReviewListQuery,
  type ReviewReplyRequest,
  type UpdateReviewRequest,
} from '@caselind/contracts';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CatalogPort } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { orderItems, orders, reviews, users, type ReviewRow } from '../db/schema.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { pgErrorOf } from '../orgs/orgs.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../orders/orders.shared.js';

const productNotFound = () => AppError.notFound('Product not found');
const reviewNotFound = () => AppError.notFound('Review not found');

interface AuthorRow {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

function toReview(r: ReviewRow, a: AuthorRow): Review {
  return {
    id: r.id,
    productId: r.productId,
    rating: r.rating,
    body: r.body,
    author: { userId: a.userId, handle: a.handle, displayName: a.displayName, avatarUrl: a.avatarUrl },
    verifiedPurchase: true,
    reply: r.replyBody && r.repliedAt ? { body: r.replyBody, repliedAt: r.repliedAt.toISOString() } : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const authorColumns = {
  userId: users.id,
  handle: sql<string>`${users.handle}::text`,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
};

/** Verified reviews (E-08): only a buyer whose order line for the product was delivered can review it, once. */
@Injectable()
export class ReviewsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogPort,
    private readonly moderation: ModerationRegistry,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.moderation.register('review', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const [r] = await this.db.select({ hidden: reviews.hidden, userId: reviews.userId }).from(reviews).where(eq(reviews.id, id)).limit(1);
        return !!r && (!r.hidden || r.userId === viewerId);
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const [r] = await this.db.select({ a: reviews.userId }).from(reviews).where(eq(reviews.id, id)).limit(1);
        return r?.a ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.update(reviews).set({ hidden }).where(eq(reviews.id, id));
      },
    });
  }

  async create(userId: string, productId: string, req: CreateReviewRequest): Promise<Review> {
    if (!UUID_RE.test(productId) || !(await this.catalog.productExists(productId, userId))) throw productNotFound();
    const [delivered] = await this.db
      .select({ orgId: orders.orgId })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.productId, productId), eq(orders.buyerId, userId), eq(orders.status, 'delivered')))
      .limit(1);
    if (!delivered) {
      throw new AppError(403, 'forbidden', 'Only buyers of a delivered order can review this product', {
        reason: 'not_purchased',
      });
    }
    let row: ReviewRow;
    try {
      [row] = (await this.db
        .insert(reviews)
        .values({ productId, orgId: delivered.orgId, userId, rating: req.rating, body: req.body ?? null })
        .returning()) as [ReviewRow];
    } catch (err) {
      if (pgErrorOf(err).constraint === 'reviews_product_user_unique') {
        throw AppError.conflict('You already reviewed this product', { reason: 'already_reviewed' });
      }
      throw err;
    }
    return this.view(row);
  }

  async list(viewerId: string, productId: string, q: ReviewListQuery): Promise<ReviewList> {
    if (!UUID_RE.test(productId) || !(await this.catalog.productExists(productId, viewerId))) throw productNotFound();
    const filters = [eq(reviews.productId, productId), or(eq(reviews.hidden, false), eq(reviews.userId, viewerId))!];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${reviews.createdAt}, ${reviews.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({ row: reviews, author: authorColumns, exact: sql<string>`${reviews.createdAt}::text` })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(and(...filters))
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);

    const stats = await this.db
      .select({ rating: reviews.rating, n: sql<number>`count(*)::int` })
      .from(reviews)
      .where(and(eq(reviews.productId, productId), eq(reviews.hidden, false)))
      .groupBy(reviews.rating);
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let count = 0;
    let sum = 0;
    for (const s of stats) {
      distribution[String(s.rating) as keyof typeof distribution] = s.n;
      count += s.n;
      sum += s.rating * s.n;
    }
    return {
      items: page.map((r) => toReview(r.row, r.author)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.exact, last.row.id) : null,
      summary: { ratingCount: count, averageRating: count > 0 ? Math.round((sum / count) * 100) / 100 : null, distribution },
    };
  }

  async update(userId: string, reviewId: string, patch: UpdateReviewRequest): Promise<Review> {
    const existing = await this.findForAuthor(userId, reviewId);
    const set: Partial<typeof reviews.$inferInsert> = { updatedAt: new Date() };
    if (patch.rating !== undefined) set.rating = patch.rating;
    if (patch.body !== undefined) set.body = patch.body;
    const [row] = await this.db.update(reviews).set(set).where(eq(reviews.id, existing.id)).returning();
    return this.view(row!);
  }

  async remove(userId: string, reviewId: string): Promise<void> {
    const existing = await this.findForAuthor(userId, reviewId);
    await this.db.delete(reviews).where(eq(reviews.id, existing.id));
  }

  /** Reply of the seller (one per review, replaced by a new reply). The review must belong to the org. */
  async reply(orgId: string, actorUserId: string, reviewId: string, req: ReviewReplyRequest): Promise<Review> {
    if (!UUID_RE.test(reviewId)) throw reviewNotFound();
    const [row] = await this.db
      .update(reviews)
      .set({ replyBody: req.body, replyBy: actorUserId, repliedAt: new Date() })
      .where(and(eq(reviews.id, reviewId), eq(reviews.orgId, orgId), eq(reviews.hidden, false)))
      .returning();
    if (!row) throw reviewNotFound();
    await this.notifications.notify({
      userId: row.userId,
      category: 'commerce',
      title: 'Réponse du vendeur',
      body: 'Le vendeur a répondu à votre avis.',
      data: { reviewId: row.id, productId: row.productId },
    });
    return this.view(row);
  }

  private async findForAuthor(userId: string, reviewId: string): Promise<ReviewRow> {
    if (!UUID_RE.test(reviewId)) throw reviewNotFound();
    const [row] = await this.db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
    if (!row || (row.hidden && row.userId !== userId)) throw reviewNotFound();
    if (row.userId !== userId) throw AppError.forbidden();
    return row;
  }

  private async view(row: ReviewRow): Promise<Review> {
    const [a] = await this.db.select(authorColumns).from(users).where(eq(users.id, row.userId)).limit(1);
    return toReview(row, a!);
  }
}

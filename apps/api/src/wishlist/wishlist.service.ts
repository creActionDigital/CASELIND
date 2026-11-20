import { Inject, Injectable } from '@nestjs/common';
import { type PageQuery, WISHLIST_MAX, type WishlistList } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { decodeCursor, encodeCursor, productNotFound, UUID_RE } from '../catalog/catalog.shared.js';
import { StorefrontService } from '../catalog/storefront.service.js';
import { AppError } from '../common/app-error.js';
import { CatalogPort } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';

/** Products a user wishes to buy later. Adding and removing are idempotent; only a product the user can see can be added. */
@Injectable()
export class WishlistService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogPort,
    private readonly storefront: StorefrontService,
  ) {}

  async add(userId: string, productId: string): Promise<void> {
    if (!UUID_RE.test(productId) || !(await this.catalog.productExists(productId, userId))) throw productNotFound();
    await this.db.transaction(async (tx) => {
      // Serialises the cap check of one user's concurrent additions.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wishlist:${userId}`}, 0))`);
      const exists = await tx.execute(sql`SELECT 1 FROM wishlist_items WHERE user_id = ${userId}::uuid AND product_id = ${productId}::uuid`);
      if (exists.rows.length > 0) return;
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM wishlist_items WHERE user_id = ${userId}::uuid`);
      if ((n.rows[0]?.n ?? 0) >= WISHLIST_MAX) throw AppError.conflict('The wishlist is full', { reason: 'wishlist_full', max: WISHLIST_MAX });
      await tx.execute(sql`INSERT INTO wishlist_items (user_id, product_id) VALUES (${userId}::uuid, ${productId}::uuid)`);
    });
  }

  async remove(userId: string, productId: string): Promise<void> {
    if (!UUID_RE.test(productId)) return;
    await this.db.execute(sql`DELETE FROM wishlist_items WHERE user_id = ${userId}::uuid AND product_id = ${productId}::uuid`);
  }

  /** Newest first. A product that is no longer visible stays in the list as `available: false` with no details. */
  async list(userId: string, q: PageQuery): Promise<WishlistList> {
    const c = q.cursor ? decodeCursor(q.cursor, 'time') : null;
    const res = await this.db.execute<{ product_id: string; added: Date; ts: string }>(sql`
      SELECT product_id, created_at AS added, created_at::text AS ts FROM wishlist_items
      WHERE user_id = ${userId}::uuid ${c ? sql`AND (created_at, product_id) < (${c.key}::timestamptz, ${c.id}::uuid)` : sql``}
      ORDER BY created_at DESC, product_id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    const cards = new Map((await this.storefront.byIds(userId, rows.map((r) => r.product_id))).map((p) => [p.id, p]));
    return {
      items: rows.map((r) => ({ productId: r.product_id, addedAt: new Date(r.added).toISOString(), available: cards.has(r.product_id), product: cards.get(r.product_id) ?? null })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.product_id) : null,
    };
  }
}

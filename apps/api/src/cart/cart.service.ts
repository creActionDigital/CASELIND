import { Inject, Injectable } from '@nestjs/common';
import { type Cart, CART_LINES_MAX, type CartGroup } from '@caselind/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CatalogPort } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { cartItems, organizations } from '../db/schema.js';
import { UUID_RE } from '../social/social.shared.js';

/** One cart per user, multi-vendor. It never reserves stock: prices and availability are read live from the catalogue. */
@Injectable()
export class CartService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogPort,
  ) {}

  async get(userId: string): Promise<Cart> {
    const rows = await this.db
      .select({ variantId: cartItems.variantId, quantity: cartItems.quantity })
      .from(cartItems)
      .where(eq(cartItems.userId, userId))
      .orderBy(asc(cartItems.createdAt), asc(cartItems.variantId));
    if (rows.length === 0) return { groups: [], unavailable: [], itemCount: 0 };

    const priced = await this.catalog.price(rows.map((r) => ({ variantId: r.variantId, quantity: r.quantity })), userId);
    const byVariant = new Map(priced.map((p) => [p.variantId, p]));
    const orgIds = [...new Set(priced.map((p) => p.orgId))];
    const orgRows =
      orgIds.length > 0
        ? await this.db
            .select({ id: organizations.id, name: organizations.name, slug: sql<string>`${organizations.slug}::text` })
            .from(organizations)
            .where(inArray(organizations.id, orgIds))
        : [];
    const orgs = new Map(orgRows.map((o) => [o.id, o]));

    const groups = new Map<string, CartGroup>();
    const unavailable: Cart['unavailable'] = [];
    let itemCount = 0;
    for (const r of rows) {
      const p = byVariant.get(r.variantId);
      if (!p) {
        unavailable.push({ variantId: r.variantId, quantity: r.quantity });
        continue;
      }
      itemCount += r.quantity;
      const key = `${p.orgId}|${p.currency}`;
      let g = groups.get(key);
      if (!g) {
        const org = orgs.get(p.orgId);
        g = { orgId: p.orgId, orgName: org?.name ?? '', orgSlug: org?.slug ?? '', currency: p.currency, subtotalMinor: 0, lines: [] };
        groups.set(key, g);
      }
      const lineTotalMinor = p.unitPriceMinor * r.quantity;
      g.subtotalMinor += lineTotalMinor;
      g.lines.push({
        variantId: p.variantId,
        productId: p.productId,
        title: p.title,
        variantLabel: p.variantLabel,
        sku: p.sku,
        imageAssetId: p.imageAssetId,
        unitPriceMinor: p.unitPriceMinor,
        quantity: r.quantity,
        lineTotalMinor,
      });
    }
    return { groups: [...groups.values()], unavailable, itemCount };
  }

  /** quantity 0 removes the line. An unknown or unbuyable variant is a 404; a 101st distinct line is a 409. */
  async setItem(userId: string, variantId: string, quantity: number): Promise<Cart> {
    if (!UUID_RE.test(variantId)) throw AppError.notFound('Variant not found');
    if (quantity === 0) {
      await this.db.delete(cartItems).where(and(eq(cartItems.userId, userId), eq(cartItems.variantId, variantId)));
      return this.get(userId);
    }
    const priced = await this.catalog.price([{ variantId, quantity }], userId);
    if (priced.length === 0) throw AppError.notFound('Variant not found');
    await this.db.transaction(async (tx) => {
      // Serialises the line-count check of one user's concurrent additions.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`cart:${userId}`}, 0))`);
      const [existing] = await tx
        .select({ v: cartItems.variantId })
        .from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.variantId, variantId)))
        .limit(1);
      if (!existing) {
        const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(cartItems).where(eq(cartItems.userId, userId));
        if ((c?.n ?? 0) >= CART_LINES_MAX) {
          throw AppError.conflict('The cart is full', { reason: 'cart_full', max: CART_LINES_MAX });
        }
      }
      await tx
        .insert(cartItems)
        .values({ userId, variantId, quantity })
        .onConflictDoUpdate({ target: [cartItems.userId, cartItems.variantId], set: { quantity, updatedAt: new Date() } });
    });
    return this.get(userId);
  }

  async clear(userId: string): Promise<void> {
    await this.db.delete(cartItems).where(eq(cartItems.userId, userId));
  }
}

import { Inject, Injectable } from '@nestjs/common';
import type {
  AdjustStockRequest,
  CreateProductRequest,
  OrgProductListQuery,
  Product,
  ProductCategoryList,
  ProductList,
  UpdateProductRequest,
  Variant,
  VariantInput,
} from '@caselind/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import {
  mediaAssets,
  orgMembers,
  productCategories,
  productMedia,
  type ProductRow,
  productVariants,
  type ProductVariantRow,
  products,
  stockMovements,
} from '../db/schema.js';
import { contentUrlOf } from '../media/media.service.js';
import { pgErrorOf, type Tx } from '../orgs/orgs.service.js';
import {
  decodeCursor,
  encodeCursor,
  productNotFound,
  searchSql,
  UUID_RE,
  validationError,
} from './catalog.shared.js';

const SKU_CONSTRAINT = 'product_variants_org_sku_unique';

const publishWithoutVariant = () =>
  AppError.conflict('A published product needs at least one active variant', { reason: 'publish_without_variant' });

export function toVariant(v: ProductVariantRow): Variant {
  return {
    id: v.id,
    sku: v.sku,
    options: v.options,
    priceMinor: Number(v.priceMinor),
    currency: v.currency,
    stock: v.stock,
    trackStock: v.trackStock,
    active: v.active,
  };
}

/** Seller side of the catalogue: categories, products with variants, stock. */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  async categories(): Promise<ProductCategoryList> {
    const rows = await this.db.select().from(productCategories).orderBy(asc(productCategories.position), asc(productCategories.slug));
    return { items: rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, parentId: c.parentId })) };
  }

  // ---- read ---------------------------------------------------------------------------------

  async list(orgId: string, q: OrgProductListQuery): Promise<ProductList> {
    const cursor = q.cursor ? decodeCursor(q.cursor, 'time') : null;
    const res = await this.db.execute(sql`
      SELECT p.id, p.created_at::text AS ts
      FROM products p
      WHERE p.org_id = ${orgId}::uuid
        ${q.status ? sql`AND p.status = ${q.status}` : sql``}
        ${searchSql(q.q)}
        ${cursor ? sql`AND (p.created_at, p.id) < (${cursor.key}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${q.limit + 1}`);
    const rows = res.rows as { id: string; ts: string }[];
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const items = await this.hydrateByIds(page.map((r) => r.id));
    return { items, nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  async get(orgId: string, productId: string): Promise<Product> {
    if (!UUID_RE.test(productId)) throw productNotFound();
    const [row] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.orgId, orgId)))
      .limit(1);
    if (!row) throw productNotFound();
    return (await this.hydrate([row]))[0]!;
  }

  private async hydrateByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(products).where(inArray(products.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return this.hydrate(ids.map((id) => byId.get(id)).filter((r): r is ProductRow => r !== undefined));
  }

  private async hydrate(rows: ProductRow[]): Promise<Product[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [mediaRows, variantRows] = await Promise.all([
      this.db
        .select({ productId: productMedia.productId, id: mediaAssets.id, mime: mediaAssets.mime })
        .from(productMedia)
        .innerJoin(mediaAssets, eq(mediaAssets.id, productMedia.mediaId))
        .where(inArray(productMedia.productId, ids))
        .orderBy(asc(productMedia.position)),
      this.db
        .select()
        .from(productVariants)
        .where(inArray(productVariants.productId, ids))
        .orderBy(asc(productVariants.createdAt), asc(productVariants.id)),
    ]);
    return rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      title: r.title,
      description: r.description,
      categoryId: r.categoryId,
      status: r.status,
      hidden: r.hidden,
      media: mediaRows
        .filter((m) => m.productId === r.id)
        .map((m) => ({ id: m.id, mime: m.mime, contentUrl: contentUrlOf(m.id) })),
      variants: variantRows.filter((v) => v.productId === r.id).map(toVariant),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---- write --------------------------------------------------------------------------------

  async create(orgId: string, userId: string, req: CreateProductRequest, meta: RequestMeta): Promise<Product> {
    this.checkVariants(req.variants);
    await this.checkCategory(req.categoryId ?? null);
    await this.checkMedia(this.db, orgId, req.mediaIds);
    if (req.status === 'published' && !req.variants.some((v) => v.active)) {
      throw publishWithoutVariant();
    }
    try {
      const id = await this.db.transaction(async (tx) => {
        const [p] = await tx
          .insert(products)
          .values({
            orgId,
            createdBy: userId,
            categoryId: req.categoryId ?? null,
            title: req.title,
            description: req.description ?? null,
            status: req.status,
          })
          .returning({ id: products.id });
        const productId = p!.id;
        for (const v of req.variants) await this.insertVariant(tx, orgId, productId, userId, v);
        if (req.mediaIds.length > 0) {
          await tx.insert(productMedia).values(req.mediaIds.map((mediaId, position) => ({ productId, mediaId, position })));
        }
        await this.audit.record({ action: 'product.created', actorUserId: userId, meta, metadata: { orgId, productId } }, tx);
        if (req.status === 'published') {
          await this.audit.record({ action: 'product.published', actorUserId: userId, meta, metadata: { orgId, productId } }, tx);
        }
        return productId;
      });
      return await this.get(orgId, id);
    } catch (err) {
      throw await this.mapWriteError(err, orgId, req.variants);
    }
  }

  async update(orgId: string, userId: string, productId: string, req: UpdateProductRequest, meta: RequestMeta): Promise<Product> {
    if (!UUID_RE.test(productId)) throw productNotFound();
    if (req.variants) this.checkVariants(req.variants);
    if (req.categoryId) await this.checkCategory(req.categoryId);
    if (req.mediaIds) await this.checkMedia(this.db, orgId, req.mediaIds);
    try {
      await this.db.transaction(async (tx) => {
        const [cur] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, productId), eq(products.orgId, orgId)))
          .for('update')
          .limit(1);
        if (!cur) throw productNotFound();

        if (req.variants) {
          for (const v of req.variants) {
            if (!v.id) {
              await this.insertVariant(tx, orgId, productId, userId, v);
              continue;
            }
            const res = await tx
              .update(productVariants)
              .set({
                sku: v.sku,
                options: v.options,
                priceMinor: v.priceMinor,
                currency: v.currency,
                trackStock: v.trackStock,
                active: v.active,
              })
              .where(and(eq(productVariants.id, v.id), eq(productVariants.productId, productId)))
              .returning({ id: productVariants.id });
            if (res.length === 0) throw validationError('variants', 'unknown variant id for this product');
          }
        }
        if (req.mediaIds) {
          await tx.delete(productMedia).where(eq(productMedia.productId, productId));
          if (req.mediaIds.length > 0) {
            await tx.insert(productMedia).values(req.mediaIds.map((mediaId, position) => ({ productId, mediaId, position })));
          }
        }

        const status = req.status ?? cur.status;
        if (status === 'published') {
          const [n] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(productVariants)
            .where(and(eq(productVariants.productId, productId), eq(productVariants.active, true)));
          if ((n?.n ?? 0) === 0) throw publishWithoutVariant();
        }

        await tx
          .update(products)
          .set({
            ...(req.title !== undefined ? { title: req.title } : {}),
            ...(req.description !== undefined ? { description: req.description } : {}),
            ...(req.categoryId !== undefined ? { categoryId: req.categoryId } : {}),
            status,
            updatedAt: new Date(),
          })
          .where(eq(products.id, productId));

        if (status !== cur.status && (status === 'published' || status === 'archived')) {
          await this.audit.record(
            { action: status === 'published' ? 'product.published' : 'product.archived', actorUserId: userId, meta, metadata: { orgId, productId } },
            tx,
          );
        }
      });
    } catch (err) {
      throw await this.mapWriteError(err, orgId, req.variants);
    }
    return this.get(orgId, productId);
  }

  /** Physical deletion is never done (orders keep a reference): DELETE archives the product. Idempotent. */
  async archive(orgId: string, userId: string, productId: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(productId)) throw productNotFound();
    await this.db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ status: products.status })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.orgId, orgId)))
        .for('update')
        .limit(1);
      if (!cur) throw productNotFound();
      if (cur.status === 'archived') return;
      await tx.update(products).set({ status: 'archived', updatedAt: new Date() }).where(eq(products.id, productId));
      await this.audit.record({ action: 'product.archived', actorUserId: userId, meta, metadata: { orgId, productId } }, tx);
    });
  }

  // ---- stock --------------------------------------------------------------------------------

  async adjustStock(orgId: string, userId: string, variantId: string, req: AdjustStockRequest, meta: RequestMeta): Promise<Variant> {
    if (!UUID_RE.test(variantId)) throw AppError.notFound('Variant not found');
    return this.db.transaction(async (tx) => {
      const [v] = await tx
        .select()
        .from(productVariants)
        .where(and(eq(productVariants.id, variantId), eq(productVariants.orgId, orgId)))
        .for('update')
        .limit(1);
      if (!v) throw AppError.notFound('Variant not found');
      if (!v.trackStock) throw AppError.conflict('Stock is not tracked for this variant', { reason: 'stock_not_tracked' });
      const next = v.stock + req.delta;
      if (next < 0) throw AppError.conflict('Stock cannot become negative', { reason: 'stock_negative' });
      const [updated] = await tx.update(productVariants).set({ stock: next }).where(eq(productVariants.id, variantId)).returning();
      await tx.insert(stockMovements).values({
        variantId,
        orgId,
        delta: req.delta,
        stockAfter: next,
        reason: req.reason,
        actorUserId: userId,
      });
      await this.audit.record(
        { action: 'stock.adjusted', actorUserId: userId, meta, metadata: { orgId, variantId, delta: req.delta, reason: req.reason } },
        tx,
      );
      return toVariant(updated!);
    });
  }

  // ---- helpers ------------------------------------------------------------------------------

  private async insertVariant(tx: Tx, orgId: string, productId: string, userId: string, v: VariantInput): Promise<void> {
    const [row] = await tx
      .insert(productVariants)
      .values({
        productId,
        orgId,
        sku: v.sku,
        options: v.options,
        priceMinor: v.priceMinor,
        currency: v.currency,
        stock: v.trackStock ? v.stock : 0,
        trackStock: v.trackStock,
        active: v.active,
      })
      .returning({ id: productVariants.id });
    if (v.trackStock && v.stock > 0) {
      await tx.insert(stockMovements).values({
        variantId: row!.id,
        orgId,
        delta: v.stock,
        stockAfter: v.stock,
        reason: 'initial',
        actorUserId: userId,
      });
    }
  }

  private checkVariants(variants: VariantInput[]): void {
    const skus = new Set<string>();
    variants.forEach((v, i) => {
      if (!this.env.COMMERCE_CURRENCIES.includes(v.currency)) {
        throw validationError(`variants.${i}.currency`, `currency must be one of ${this.env.COMMERCE_CURRENCIES.join(', ')}`);
      }
      if (skus.has(v.sku)) {
        throw AppError.conflict(`Duplicate SKU in the request: ${v.sku}`, { reason: 'duplicate_sku_in_request', field: 'sku', sku: v.sku });
      }
      skus.add(v.sku);
    });
  }

  private async checkCategory(categoryId: string | null): Promise<void> {
    if (!categoryId) return;
    const [c] = await this.db.select({ id: productCategories.id }).from(productCategories).where(eq(productCategories.id, categoryId)).limit(1);
    if (!c) throw validationError('categoryId', 'unknown category');
  }

  /** Each media must be a ready "product" upload owned by an active member of the org. */
  private async checkMedia(db: Pick<Db, 'select'>, orgId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    if (new Set(mediaIds).size !== mediaIds.length) throw validationError('mediaIds', 'duplicate media');
    const rows = await db
      .select({ id: mediaAssets.id, purpose: mediaAssets.purpose, status: mediaAssets.status, owner: mediaAssets.ownerUserId })
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, mediaIds));
    const owners = [...new Set(rows.map((r) => r.owner))];
    const members =
      owners.length === 0
        ? []
        : await db
            .select({ userId: orgMembers.userId })
            .from(orgMembers)
            .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.status, 'active'), inArray(orgMembers.userId, owners)));
    const memberIds = new Set(members.map((m) => m.userId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of mediaIds) {
      const m = byId.get(id);
      if (!m || m.purpose !== 'product' || m.status !== 'ready' || !memberIds.has(m.owner)) {
        throw validationError('mediaIds', 'must be ready "product" uploads of members of this organization');
      }
    }
  }

  /** Names the SKU of the request that collides with another variant of the org (best effort). */
  private async mapWriteError(err: unknown, orgId: string, variants: VariantInput[] | undefined): Promise<unknown> {
    const pg = pgErrorOf(err);
    if (pg.code !== '23505' || pg.constraint !== SKU_CONSTRAINT) return err;
    let sku: string | undefined;
    if (variants && variants.length > 0) {
      const rows = await this.db
        .select({ id: productVariants.id, sku: productVariants.sku })
        .from(productVariants)
        .where(and(eq(productVariants.orgId, orgId), inArray(productVariants.sku, variants.map((v) => v.sku))));
      sku = variants.find((v) => rows.some((r) => r.sku === v.sku && r.id !== v.id))?.sku;
    }
    return AppError.conflict('SKU already used in this organization', { reason: 'sku_taken', field: 'sku', ...(sku ? { sku } : {}) });
  }
}

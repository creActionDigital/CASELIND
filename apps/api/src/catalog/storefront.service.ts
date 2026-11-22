import { Inject, Injectable } from '@nestjs/common';
import {
  FLASH_MAX_HOURS,
  type OrgStorefrontQuery,
  type StorefrontProduct,
  type StorefrontProductDetail,
  type StorefrontProductList,
  type StorefrontQuery,
  type StorefrontVariant,
} from '@caselind/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { contentUrlOf } from '../media/media.service.js';
import { hasFlashSql, effectivePriceSql, PROMO_JOIN } from '../promotions/promotion-sql.js';
import { buyerVisibleSql, decodeCursor, encodeCursor, productNotFound, searchSql, UUID_RE } from './catalog.shared.js';

interface CardRow {
  id: string;
  title: string;
  category_id: string | null;
  created_at: string | Date;
  ts: string;
  min_price: string | number;
  base_price: string | number;
  promo_label: string | null;
  promo_kind: 'percent' | 'fixed_price' | null;
  promo_ends: string | Date | null;
  currency: string;
  in_stock: boolean;
  cover: string | null;
  colors: string[] | null;
  org_id: string;
  org_slug: string;
  org_name: string;
  org_logo_url: string | null;
}

const iso = (v: string | Date): string => new Date(v).toISOString();

interface VariantRowOut {
  id: string;
  options: Record<string, string>;
  price_minor: string | number;
  eff_price: string | number;
  promo_label: string | null;
  promo_kind: 'percent' | 'fixed_price' | null;
  promo_ends: string | Date | null;
  currency: string;
  in_stock: boolean;
}

/** Buyer side: published products of active, public organisations. Anything else is simply absent (404). */
@Injectable()
export class StorefrontService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Connected search over the whole marketplace. */
  search(viewerId: string, q: StorefrontQuery): Promise<StorefrontProductList> {
    return this.page(viewerId, q, q.orgId ? sql`AND p.org_id = ${q.orgId}::uuid` : sql``);
  }

  /** Public storefront of one organisation (no sign-in). Unknown, private or suspended org: 404. */
  async byOrgSlug(slug: string, q: OrgStorefrontQuery): Promise<StorefrontProductList> {
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/i.test(slug)) throw AppError.notFound('Organization not found');
    const res = await this.db.execute(
      sql`SELECT id FROM organizations WHERE slug = ${slug} AND status = 'active' AND visibility = 'public' LIMIT 1`,
    );
    const org = res.rows[0] as { id: string } | undefined;
    if (!org) throw AppError.notFound('Organization not found');
    const list = await this.page(null, q, sql`AND p.org_id = ${org.id}::uuid`);
    // Anonymous visitors cannot open /v1/media: their cover URLs point at the public image route.
    return { ...list, items: list.items.map((i) => ({ ...i, coverUrl: i.coverUrl?.replace('/v1/media/', '/v1/public/media/') ?? null })) };
  }

  /** Flash sales in progress (promotions of at most FLASH_MAX_HOURS), same buyer visibility as the search; newest products first. */
  flash(viewerId: string, q: { limit: number; cursor?: string }): Promise<StorefrontProductList> {
    return this.page(viewerId, { ...q, sort: 'recent' } as StorefrontQuery, sql`AND ${hasFlashSql(FLASH_MAX_HOURS)}`);
  }

  /** Cards of the given products that the viewer can see (the others are absent). */
  async byIds(viewerId: string, ids: string[]): Promise<StorefrontProduct[]> {
    if (ids.length === 0) return [];
    const rows = await this.cards(viewerId, sql`AND p.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`, sql``, sql``, sql``);
    return rows.map(toCard);
  }

  async detail(viewerId: string, productId: string): Promise<StorefrontProductDetail> {
    if (!UUID_RE.test(productId)) throw productNotFound();
    const card = await this.cards(viewerId, sql`AND p.id = ${productId}::uuid`, sql``, sql``, sql`LIMIT 1`);
    const row = card[0];
    if (!row) throw productNotFound();
    const [desc, media, variants, wished] = await Promise.all([
      this.db.execute(sql`SELECT description FROM products WHERE id = ${productId}::uuid`),
      this.db.execute(sql`
        SELECT m.id, m.mime FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
        WHERE pm.product_id = ${productId}::uuid ORDER BY pm.position`),
      this.db.execute(sql`
        SELECT v.id, v.options, v.price_minor, ${effectivePriceSql('promo')} AS eff_price, promo.label AS promo_label, promo.kind AS promo_kind,
               promo.ends_at AS promo_ends, v.currency, (NOT v.track_stock OR v.stock > 0) AS in_stock
        FROM product_variants v ${PROMO_JOIN}
        WHERE v.product_id = ${productId}::uuid AND v.active ORDER BY v.created_at, v.id`),
      this.db.execute(sql`SELECT 1 FROM wishlist_items WHERE user_id = ${viewerId}::uuid AND product_id = ${productId}::uuid`),
    ]);
    return {
      ...toCard(row),
      description: (desc.rows[0] as { description: string | null } | undefined)?.description ?? null,
      media: (media.rows as { id: string; mime: string | null }[]).map((m) => ({ id: m.id, mime: m.mime, contentUrl: contentUrlOf(m.id) })),
      wished: wished.rows.length > 0,
      variants: (variants.rows as unknown as VariantRowOut[]).map(
        (v): StorefrontVariant => ({
          id: v.id,
          options: v.options,
          priceMinor: Number(v.promo_label ? v.eff_price : v.price_minor),
          compareAtPriceMinor: v.promo_label ? Number(v.price_minor) : null,
          promotion: v.promo_label && v.promo_kind && v.promo_ends ? { label: v.promo_label, endsAt: iso(v.promo_ends), kind: v.promo_kind } : null,
          currency: v.currency,
          inStock: v.in_stock,
        }),
      ),
    };
  }

  // ---- internals ----------------------------------------------------------------------------

  private async page(viewerId: string | null, q: StorefrontQuery | OrgStorefrontQuery, scope: SQL): Promise<StorefrontProductList> {
    const variantFilter = sql`
      ${q.currency ? sql`AND x.currency = ${q.currency}` : sql``}
      ${q.minPrice !== undefined ? sql`AND x.eff >= ${q.minPrice}` : sql``}
      ${q.maxPrice !== undefined ? sql`AND x.eff <= ${q.maxPrice}` : sql``}`;
    const filters = sql`${scope} ${q.categoryId ? sql`AND p.category_id = ${q.categoryId}::uuid` : sql``} ${searchSql(q.q)}`;

    let cursorSql = sql``;
    let order: SQL;
    if (q.sort === 'recent') {
      order = sql`ORDER BY p.created_at DESC, p.id DESC`;
      if (q.cursor) {
        const c = decodeCursor(q.cursor, 'time');
        cursorSql = sql`AND (p.created_at, p.id) < (${c.key}::timestamptz, ${c.id}::uuid)`;
      }
    } else {
      const asc = q.sort === 'price_asc';
      order = asc ? sql`ORDER BY s.min_price ASC, p.id ASC` : sql`ORDER BY s.min_price DESC, p.id DESC`;
      if (q.cursor) {
        const c = decodeCursor(q.cursor, 'int');
        cursorSql = asc
          ? sql`AND (s.min_price, p.id) > (${c.key}::bigint, ${c.id}::uuid)`
          : sql`AND (s.min_price, p.id) < (${c.key}::bigint, ${c.id}::uuid)`;
      }
    }

    const rows = await this.cards(viewerId, filters, variantFilter, cursorSql, sql`${order} LIMIT ${q.limit + 1}`);
    const pageRows = rows.slice(0, q.limit);
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      rows.length > q.limit && last ? encodeCursor(q.sort === 'recent' ? last.ts : String(last.min_price), last.id) : null;
    return { items: pageRows.map(toCard), nextCursor };
  }

  private async cards(viewerId: string | null, filters: SQL, variantFilter: SQL, cursorSql: SQL, tail: SQL): Promise<CardRow[]> {
    const res = await this.db.execute(sql`
      SELECT p.id, p.title, p.category_id, p.created_at, p.created_at::text AS ts,
             s.min_price, s.base_price, s.promo_label, s.promo_kind, s.promo_ends, s.currency, s.in_stock,
             (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS cover,
             (SELECT array_agg(c.val) FROM (SELECT DISTINCT ON (lower(kv.value)) kv.value AS val FROM product_variants v2, jsonb_each_text(v2.options) kv WHERE v2.product_id = p.id AND v2.active AND kv.key ~* '^(couleur|colou?r|rangi)' ORDER BY lower(kv.value) LIMIT 4) c) AS colors,
             o.id AS org_id, o.slug AS org_slug, o.name AS org_name, o.logo_url AS org_logo_url
      FROM products p
      JOIN organizations o ON o.id = p.org_id
      JOIN LATERAL (
        SELECT (array_agg(x.eff ORDER BY x.eff, x.id))[1] AS min_price,
               (array_agg(x.price_minor ORDER BY x.eff, x.id))[1] AS base_price,
               (array_agg(x.promo_label ORDER BY x.eff, x.id))[1] AS promo_label,
               (array_agg(x.promo_kind ORDER BY x.eff, x.id))[1] AS promo_kind,
               (array_agg(x.promo_ends ORDER BY x.eff, x.id))[1] AS promo_ends,
               (array_agg(x.currency ORDER BY x.eff, x.id))[1] AS currency,
               bool_or(NOT x.track_stock OR x.stock > 0) AS in_stock
        FROM (
          SELECT v.id, v.price_minor, v.currency, v.track_stock, v.stock, promo.label AS promo_label, promo.kind AS promo_kind,
                 promo.ends_at AS promo_ends, ${effectivePriceSql('promo')} AS eff
          FROM product_variants v ${PROMO_JOIN}
          WHERE v.product_id = p.id AND v.active
        ) x
        WHERE true ${variantFilter}
      ) s ON s.min_price IS NOT NULL
      WHERE ${buyerVisibleSql(viewerId)} ${filters} ${cursorSql}
      ${tail}`);
    return res.rows as unknown as CardRow[];
  }
}

function toCard(r: CardRow): StorefrontProduct {
  return {
    id: r.id,
    title: r.title,
    categoryId: r.category_id,
    coverUrl: r.cover ? contentUrlOf(r.cover) : null,
    minPriceMinor: Number(r.min_price),
    compareAtPriceMinor: r.promo_label ? Number(r.base_price) : null,
    promotion: r.promo_label && r.promo_kind && r.promo_ends ? { label: r.promo_label, endsAt: iso(r.promo_ends), kind: r.promo_kind } : null,
    currency: r.currency,
    inStock: r.in_stock,
    colors: r.colors ?? [],
    org: { id: r.org_id, slug: r.org_slug, name: r.org_name, logoUrl: r.org_logo_url },
    createdAt: iso(r.created_at),
  };
}

import { z } from 'zod';
import { type Page, pageQuerySchema } from './pagination.js';

/**
 * Catalogue (lot 5A): categories, products with variants, stock and the buyer-facing storefront.
 * Mirrors migrations/0011_catalog.sql. Money is an integer in minor units (cents, centimes).
 */

export const productStatusSchema = z.enum(['draft', 'published', 'archived']);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code in upper case');
export const priceMinorSchema = z.number().int().min(1).max(1_000_000_000_000);

export const productCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
});
export type ProductCategory = z.infer<typeof productCategorySchema>;
export const productCategoryListSchema = z.object({ items: z.array(productCategorySchema) });
export type ProductCategoryList = z.infer<typeof productCategoryListSchema>;

/** Option label to value, e.g. `{ taille: 'M', couleur: 'rouge' }`. */
export const variantOptionsSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(80))
  .refine((o) => Object.keys(o).length <= 10, 'at most 10 options');

export const variantInputSchema = z.object({
  /** Present when editing an existing variant (update), absent when adding one. */
  id: z.string().uuid().optional(),
  sku: z.string().trim().min(1).max(64),
  options: variantOptionsSchema.default({}),
  priceMinor: priceMinorSchema,
  currency: currencySchema,
  /** Initial stock, applied on creation only; later changes go through the stock route. */
  stock: z.number().int().min(0).max(1_000_000_000).default(0),
  trackStock: z.boolean().default(true),
  /** false = withdrawn from sale (variants are never deleted: orders may reference them). */
  active: z.boolean().default(true),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

const titleSchema = z.string().trim().min(1).max(140);
const descriptionSchema = z.string().trim().max(5000);
const mediaIdsSchema = z.array(z.string().uuid()).max(10);

export const createProductRequestSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.nullish(),
  categoryId: z.string().uuid().nullish(),
  mediaIds: mediaIdsSchema.default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  variants: z.array(variantInputSchema).min(1).max(50),
});
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

/** Variants listed here are updated (with `id`) or added (without); the others are left untouched. */
export const updateProductRequestSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema.nullable(),
    categoryId: z.string().uuid().nullable(),
    mediaIds: mediaIdsSchema,
    status: productStatusSchema,
    variants: z.array(variantInputSchema).min(1).max(50),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const productMediaSchema = z.object({ id: z.string().uuid(), mime: z.string().nullable(), contentUrl: z.string() });
export type ProductMedia = z.infer<typeof productMediaSchema>;

/** Seller side: exact stock, SKU and moderation state. */
export const variantSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  options: z.record(z.string(), z.string()),
  priceMinor: z.number().int(),
  currency: z.string(),
  stock: z.number().int(),
  trackStock: z.boolean(),
  active: z.boolean(),
});
export type Variant = z.infer<typeof variantSchema>;

export const productSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  categoryId: z.string().uuid().nullable(),
  status: productStatusSchema,
  /** Hidden by moderation: invisible to buyers whatever the status. */
  hidden: z.boolean(),
  media: z.array(productMediaSchema),
  variants: z.array(variantSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;
export type ProductList = Page<Product>;
export const productListSchema = z.object({ items: z.array(productSchema), nextCursor: z.string().nullable() });

export const orgProductListQuerySchema = pageQuerySchema.extend({
  status: productStatusSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type OrgProductListQuery = z.infer<typeof orgProductListQuerySchema>;

export const stockReasonSchema = z.enum(['restock', 'adjustment', 'damage']);
export const stockMovementReasonSchema = z.enum(['initial', 'restock', 'adjustment', 'damage', 'order_reserved', 'order_released', 'pos_sale']);
export const adjustStockRequestSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((d) => d !== 0, 'delta must not be 0'),
  reason: stockReasonSchema,
});
export type AdjustStockRequest = z.infer<typeof adjustStockRequestSchema>;

// ---- buyer side ----
export const storefrontOrgSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
});
export type StorefrontOrg = z.infer<typeof storefrontOrgSchema>;

export const storefrontVariantSchema = z.object({
  id: z.string().uuid(),
  options: z.record(z.string(), z.string()),
  priceMinor: z.number().int(),
  currency: z.string(),
  inStock: z.boolean(),
});
export type StorefrontVariant = z.infer<typeof storefrontVariantSchema>;

/** Card in lists: price of the cheapest active variant. */
export const storefrontProductSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  categoryId: z.string().uuid().nullable(),
  coverUrl: z.string().nullable(),
  minPriceMinor: z.number().int(),
  currency: z.string(),
  inStock: z.boolean(),
  org: storefrontOrgSchema,
  createdAt: z.string(),
});
export type StorefrontProduct = z.infer<typeof storefrontProductSchema>;
export const storefrontProductListSchema = z.object({ items: z.array(storefrontProductSchema), nextCursor: z.string().nullable() });
export type StorefrontProductList = Page<StorefrontProduct>;

export const storefrontProductDetailSchema = storefrontProductSchema.extend({
  description: z.string().nullable(),
  media: z.array(productMediaSchema),
  variants: z.array(storefrontVariantSchema),
});
export type StorefrontProductDetail = z.infer<typeof storefrontProductDetailSchema>;

export const productSortSchema = z.enum(['recent', 'price_asc', 'price_desc']);
export const storefrontQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  categoryId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  minPrice: z.coerce.number().int().min(0).max(1_000_000_000_000).optional(),
  maxPrice: z.coerce.number().int().min(0).max(1_000_000_000_000).optional(),
  currency: currencySchema.optional(),
  sort: productSortSchema.default('recent'),
});
export type StorefrontQuery = z.infer<typeof storefrontQuerySchema>;

/** Public storefront of one organisation: same filters minus org. */
export const orgStorefrontQuerySchema = storefrontQuerySchema.omit({ orgId: true });
export type OrgStorefrontQuery = z.infer<typeof orgStorefrontQuerySchema>;

/**
 * Stable `details.reason` of the catalogue 409s (the message is for humans, never parse it):
 * - `sku_taken` (+ `field: 'sku'`, `sku` when known): SKU already used by another variant of the organisation;
 * - `duplicate_sku_in_request` (+ `field: 'sku'`, `sku`): the same SKU twice in one request;
 * - `publish_without_variant`: a published product needs at least one active variant;
 * - `stock_not_tracked`: stock adjustment on a variant with `trackStock = false`;
 * - `stock_negative`: the adjustment would take the stock below 0.
 */
export const catalogConflictReasonSchema = z.enum([
  'sku_taken',
  'duplicate_sku_in_request',
  'publish_without_variant',
  'stock_not_tracked',
  'stock_negative',
]);
export type CatalogConflictReason = z.infer<typeof catalogConflictReasonSchema>;

// Lot 5 catalogue tables (0011). Owned by the catalogue module.
import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const productCategories = pgTable('product_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  position: integer('position').notNull().default(0),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  createdBy: uuid('created_by'),
  categoryId: uuid('category_id'),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').$type<'draft' | 'published' | 'archived'>().notNull().default('draft'),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const productMedia = pgTable(
  'product_media',
  {
    productId: uuid('product_id').notNull(),
    mediaId: uuid('media_id').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.mediaId] })],
);

export const productVariants = pgTable('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull(),
  orgId: uuid('org_id').notNull(),
  sku: text('sku').notNull(),
  options: jsonb('options').$type<Record<string, string>>().notNull().default({}),
  priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  stock: integer('stock').notNull().default(0),
  trackStock: boolean('track_stock').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  variantId: uuid('variant_id').notNull(),
  orgId: uuid('org_id').notNull(),
  delta: integer('delta').notNull(),
  stockAfter: integer('stock_after').notNull(),
  reason: text('reason')
    .$type<'initial' | 'restock' | 'adjustment' | 'damage' | 'order_reserved' | 'order_released'>()
    .notNull(),
  actorUserId: uuid('actor_user_id'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export type ProductRow = typeof products.$inferSelect;
export type ProductVariantRow = typeof productVariants.$inferSelect;

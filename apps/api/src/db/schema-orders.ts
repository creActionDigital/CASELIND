// Lot 5B cart, orders, coupons and reviews tables (0012_orders.sql is the source of truth; keep this mirror in sync).
import { bigint, boolean, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const minor = (name: string) => bigint(name, { mode: 'number' });

export type OrderStatusValue = 'pending' | 'confirmed' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderAddressJson {
  name: string;
  phone: string;
  city: string;
  line1: string;
  line2?: string;
  notes?: string;
}

export const cartItems = pgTable(
  'cart_items',
  {
    userId: uuid('user_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.variantId] })],
);

export const coupons = pgTable('coupons', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  code: text('code').notNull(),
  kind: text('kind').$type<'percent' | 'fixed'>().notNull(),
  value: minor('value').notNull(),
  currency: text('currency'),
  minOrderMinor: minor('min_order_minor').notNull().default(0),
  startsAt: tstz('starts_at'),
  endsAt: tstz('ends_at'),
  maxUses: integer('max_uses'),
  maxUsesPerUser: integer('max_uses_per_user'),
  usesCount: integer('uses_count').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
export type CouponRow = typeof coupons.$inferSelect;

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: text('number').notNull(),
  buyerId: uuid('buyer_id').notNull(),
  orgId: uuid('org_id').notNull(),
  clientId: uuid('client_id').notNull(),
  currency: text('currency').notNull(),
  status: text('status').$type<OrderStatusValue>().notNull().default('pending'),
  subtotalMinor: minor('subtotal_minor').notNull(),
  discountMinor: minor('discount_minor').notNull().default(0),
  totalMinor: minor('total_minor').notNull(),
  couponId: uuid('coupon_id'),
  couponCode: text('coupon_code'),
  paymentMethod: text('payment_method').$type<'cash_on_delivery'>().notNull(),
  address: jsonb('address').$type<OrderAddressJson | null>(),
  fulfillment: text('fulfillment').$type<'delivery' | 'pickup'>().notNull().default('delivery'),
  deliveryFeeMinor: minor('delivery_fee_minor').notNull().default(0),
  deliveryZoneId: uuid('delivery_zone_id'),
  addressAnonymizedAt: tstz('address_anonymized_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
export type OrderRow = typeof orders.$inferSelect;

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull(),
  variantId: uuid('variant_id').notNull(),
  productId: uuid('product_id').notNull(),
  title: text('title').notNull(),
  variantLabel: text('variant_label'),
  sku: text('sku'),
  unitPriceMinor: minor('unit_price_minor').notNull(),
  quantity: integer('quantity').notNull(),
  lineTotalMinor: minor('line_total_minor').notNull(),
  imageAssetId: uuid('image_asset_id'),
});
export type OrderItemRow = typeof orderItems.$inferSelect;

export const orderEvents = pgTable('order_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull(),
  fromStatus: text('from_status').$type<OrderStatusValue>(),
  status: text('status').$type<OrderStatusValue>().notNull(),
  actorKind: text('actor_kind').$type<'buyer' | 'org' | 'system'>().notNull(),
  actorUserId: uuid('actor_user_id'),
  note: text('note'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
export type OrderEventRow = typeof orderEvents.$inferSelect;

export const couponRedemptions = pgTable('coupon_redemptions', {
  orderId: uuid('order_id').primaryKey(),
  couponId: uuid('coupon_id').notNull(),
  userId: uuid('user_id').notNull(),
  releasedAt: tstz('released_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  rating: smallint('rating').notNull(),
  body: text('body'),
  hidden: boolean('hidden').notNull().default(false),
  replyBody: text('reply_body'),
  replyBy: uuid('reply_by'),
  repliedAt: tstz('replied_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
export type ReviewRow = typeof reviews.$inferSelect;

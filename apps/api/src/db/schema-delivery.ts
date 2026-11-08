// Lot 8 delivery tables (0019_delivery.sql is the source of truth; keep this mirror in sync).
import { boolean, doublePrecision, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export type DeliveryStatusValue = 'pending' | 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'returned';

export const deliveryZones = pgTable('delivery_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  areas: text('areas').array().notNull(),
  fees: jsonb('fees').$type<Record<string, number>>().notNull(),
  etaMinutes: integer('eta_minutes').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
export type DeliveryZoneRow = typeof deliveryZones.$inferSelect;

export const deliveries = pgTable('deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull(),
  orgId: uuid('org_id').notNull(),
  buyerId: uuid('buyer_id').notNull(),
  courierId: uuid('courier_id'),
  status: text('status').$type<DeliveryStatusValue>().notNull().default('pending'),
  proofNonce: text('proof_nonce').notNull(),
  proofHash: text('proof_hash').notNull(),
  proofAttempts: integer('proof_attempts').notNull().default(0),
  proofLockedAt: tstz('proof_locked_at'),
  locationConsent: boolean('location_consent').notNull().default(false),
  lastLat: doublePrecision('last_lat'),
  lastLng: doublePrecision('last_lng'),
  lastLocationAt: tstz('last_location_at'),
  estimatedMinutes: integer('estimated_minutes'),
  failureReason: text('failure_reason'),
  rating: smallint('rating'),
  ratingComment: text('rating_comment'),
  ratedAt: tstz('rated_at'),
  assignedAt: tstz('assigned_at'),
  pickedUpAt: tstz('picked_up_at'),
  deliveredAt: tstz('delivered_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
export type DeliveryRow = typeof deliveries.$inferSelect;

export const deliveryEvents = pgTable('delivery_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  deliveryId: uuid('delivery_id').notNull(),
  kind: text('kind').$type<'status' | 'assignment' | 'incident' | 'proof'>().notNull(),
  fromStatus: text('from_status').$type<DeliveryStatusValue>(),
  status: text('status').$type<DeliveryStatusValue>().notNull(),
  actorKind: text('actor_kind').$type<'buyer' | 'org' | 'courier' | 'system'>().notNull(),
  actorUserId: uuid('actor_user_id'),
  note: text('note'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
export type DeliveryEventRow = typeof deliveryEvents.$inferSelect;

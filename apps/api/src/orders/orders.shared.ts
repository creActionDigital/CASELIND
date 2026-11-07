import { randomInt } from 'node:crypto';
import type { Order, OrderAddress, OrderDetail, OrderEvent, OrderItem, OrderStatus } from '@caselind/contracts';
import { asc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { organizations, orderEvents, orderItems, type OrderEventRow, type OrderItemRow, type OrderRow } from '../db/schema.js';

export { UUID_RE, decodeCursor, encodeCursor, validationError } from '../social/social.shared.js';

export const orderNotFound = () => AppError.notFound('Order not found');

/** Forward path of an order, for the seller. Cancelling is possible until it ships. */
export const SELLER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** The buyer may only cancel an order the seller has not accepted yet. */
export const BUYER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['cancelled'],
  confirmed: [],
  preparing: [],
  shipped: [],
  delivered: [],
  cancelled: [],
};

export function invalidTransition(from: OrderStatus, to: OrderStatus): AppError {
  return AppError.conflict(`An order ${from} cannot become ${to}`, { reason: 'invalid_transition', from, to });
}

/** `CL-` + 8 base32 characters without the ambiguous I, O, 0, 1. */
const NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newOrderNumber(): string {
  let s = 'CL-';
  for (let i = 0; i < 8; i += 1) s += NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)];
  return s;
}

function toItem(r: OrderItemRow): OrderItem {
  return {
    id: r.id,
    variantId: r.variantId,
    productId: r.productId,
    title: r.title,
    variantLabel: r.variantLabel,
    sku: r.sku,
    imageAssetId: r.imageAssetId,
    unitPriceMinor: r.unitPriceMinor,
    quantity: r.quantity,
    lineTotalMinor: r.lineTotalMinor,
  };
}

function toEvent(e: OrderEventRow): OrderEvent {
  return {
    id: e.id,
    fromStatus: e.fromStatus,
    status: e.status,
    actorKind: e.actorKind,
    actorUserId: e.actorUserId,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  };
}

/** Builds the API view of orders (items and org name loaded in two queries, whatever the page size). */
export async function hydrateOrders(db: DbExecutor, rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [itemRows, orgRows] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.title), asc(orderItems.id)),
    db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, [...new Set(rows.map((r) => r.orgId))])),
  ]);
  const orgNames = new Map(orgRows.map((o) => [o.id, o.name]));
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const it of itemRows) itemsByOrder.set(it.orderId, [...(itemsByOrder.get(it.orderId) ?? []), toItem(it)]);
  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    orgId: o.orgId,
    orgName: orgNames.get(o.orgId) ?? '',
    buyerId: o.buyerId,
    currency: o.currency.trim(),
    status: o.status,
    subtotalMinor: o.subtotalMinor,
    discountMinor: o.discountMinor,
    totalMinor: o.totalMinor,
    couponCode: o.couponCode,
    paymentMethod: o.paymentMethod,
    address: (o.address as OrderAddress | null) ?? null,
    items: itemsByOrder.get(o.id) ?? [],
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }));
}

export async function hydrateDetail(db: DbExecutor, row: OrderRow): Promise<OrderDetail> {
  const [order] = await hydrateOrders(db, [row]);
  const events = await db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, row.id))
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
  return { ...order!, events: events.map(toEvent) };
}

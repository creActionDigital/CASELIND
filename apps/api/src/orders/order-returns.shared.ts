import type { OrderReturn, ReturnEvent } from '@caselind/contracts';
import { asc, inArray } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { orderReturnEvents, orderReturns, orders, organizations, type OrderReturnRow } from '../db/schema.js';

export const returnNotFound = () => AppError.notFound('Return not found');

/**
 * Refund due for some lines of an order: the lines at their frozen price, minus their share of the order
 * discount (coupon). The delivery fee is never refunded. Integer arithmetic only (BigInt: no float drift).
 */
export function computeRefundMinor(lines: readonly { unitPriceMinor: number; quantity: number }[], order: { subtotalMinor: number; discountMinor: number }): number {
  const gross = lines.reduce((s, l) => s + BigInt(l.unitPriceMinor) * BigInt(l.quantity), 0n);
  if (order.subtotalMinor <= 0) return 0;
  return Number((gross * BigInt(order.subtotalMinor - order.discountMinor)) / BigInt(order.subtotalMinor));
}

/** API view of returns (order number, organisation name and history loaded in three queries). */
export async function hydrateReturns(db: DbExecutor, rows: OrderReturnRow[]): Promise<OrderReturn[]> {
  if (rows.length === 0) return [];
  const [orderRows, orgRows, eventRows] = await Promise.all([
    db.select({ id: orders.id, number: orders.number }).from(orders).where(inArray(orders.id, [...new Set(rows.map((r) => r.orderId))])),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, [...new Set(rows.map((r) => r.orgId))])),
    db.select().from(orderReturnEvents).where(inArray(orderReturnEvents.returnId, rows.map((r) => r.id))).orderBy(asc(orderReturnEvents.createdAt), asc(orderReturnEvents.id)),
  ]);
  const numbers = new Map(orderRows.map((o) => [o.id, o.number]));
  const names = new Map(orgRows.map((o) => [o.id, o.name]));
  return rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    orderNumber: numbers.get(r.orderId) ?? '',
    orgId: r.orgId,
    orgName: names.get(r.orgId) ?? '',
    requestedBy: r.requestedBy,
    reason: r.reason,
    details: r.details,
    status: r.status,
    items: r.items,
    refundMinor: r.refundMinor,
    refundedMinor: r.refundedMinor,
    currency: r.currency.trim(),
    sellerNote: r.sellerNote,
    resolution: r.resolution,
    disputeReason: r.disputeReason,
    adminNote: r.adminNote,
    restock: r.restock,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    events: eventRows
      .filter((e) => e.returnId === r.id)
      .map((e): ReturnEvent => ({ id: e.id, fromStatus: e.fromStatus, status: e.status, actorKind: e.actorKind, createdAt: e.createdAt.toISOString() })),
  }));
}

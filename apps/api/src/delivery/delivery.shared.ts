import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type CourierDelivery,
  type DeliveryEvent,
  type DeliveryStatus,
  type DeliveryView,
  ErrorCodes,
  type OrderAddress,
  PROOF_CODE_LENGTH,
} from '@caselind/contracts';
import { asc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { ENV, type Env } from '../config/env.js';
import {
  type DeliveryEventRow,
  deliveryEvents,
  type DeliveryRow,
  orderItems,
  orders,
  organizations,
  users,
} from '../db/schema.js';

export { UUID_RE, decodeCursor, encodeCursor, validationError } from '../social/social.shared.js';

export const deliveryNotFound = () => AppError.notFound('Delivery not found');

export function invalidDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): AppError {
  return AppError.conflict(`A delivery ${from} cannot become ${to}`, { reason: 'invalid_transition', from, to });
}

export const FINAL_STATUSES: readonly DeliveryStatus[] = ['delivered', 'failed', 'returned'];
export const ACTIVE_COURIER_STATUSES: readonly DeliveryStatus[] = ['assigned', 'picked_up', 'in_transit'];

/** What the courier can do. `delivered` additionally needs the proof code. */
export const COURIER_TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  pending: [],
  assigned: ['picked_up', 'failed'],
  picked_up: ['in_transit', 'failed'],
  in_transit: ['delivered', 'failed'],
  delivered: [],
  failed: ['returned'],
  returned: [],
};

/** What the seller can do besides assigning: give up before the delivery is over, or record the return. */
export const ORG_TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  pending: ['failed'],
  assigned: ['failed'],
  picked_up: ['failed'],
  in_transit: ['failed'],
  delivered: [],
  failed: ['returned'],
  returned: [],
};

/** Lower case, no accents, single spaces: how areas and address parts are compared. */
export function normalizeArea(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Proof codes. The 6-digit code is derived from (server key, delivery id, nonce): the buyer can read it back
 * from their order without the code ever being stored in clear. The database keeps the nonce and a keyed hash
 * of the code; neither is enough to guess it without the key. A reset changes the nonce.
 */
@Injectable()
export class DeliveryCodes {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = createHmac('sha256', env.JWT_ACCESS_SECRET).update('caselind:delivery-proof:v1').digest();
  }

  newNonce(): string {
    return randomBytes(16).toString('hex');
  }

  codeFor(deliveryId: string, nonce: string): string {
    const digest = createHmac('sha256', this.key).update(`code:${deliveryId}:${nonce}`).digest();
    const n = digest.readUInt32BE(0) % 10 ** PROOF_CODE_LENGTH;
    return String(n).padStart(PROOF_CODE_LENGTH, '0');
  }

  hash(deliveryId: string, code: string): string {
    return createHmac('sha256', this.key).update(`hash:${deliveryId}:${code}`).digest('hex');
  }

  /** Fresh nonce, the matching code is never returned: read it with codeFor. */
  issue(deliveryId: string): { nonce: string; hash: string } {
    const nonce = this.newNonce();
    return { nonce, hash: this.hash(deliveryId, this.codeFor(deliveryId, nonce)) };
  }

  matches(deliveryId: string, code: string, storedHash: string): boolean {
    const a = Buffer.from(this.hash(deliveryId, code), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export type DeliveryViewer = 'buyer' | 'org';

/** API views of deliveries (couriers and order numbers loaded in two queries, whatever the page size). */
export async function hydrateDeliveries(
  db: DbExecutor,
  codes: DeliveryCodes,
  rows: DeliveryRow[],
  viewer: DeliveryViewer,
): Promise<DeliveryView[]> {
  if (rows.length === 0) return [];
  const courierIds = [...new Set(rows.map((r) => r.courierId).filter((v): v is string => v !== null))];
  const [orderRows, courierRows] = await Promise.all([
    db.select({ id: orders.id, number: orders.number }).from(orders).where(inArray(orders.id, rows.map((r) => r.orderId))),
    courierIds.length > 0
      ? db.select({ id: users.id, handle: users.handle, displayName: users.displayName }).from(users).where(inArray(users.id, courierIds))
      : Promise.resolve([] as { id: string; handle: string; displayName: string }[]),
  ]);
  const numbers = new Map(orderRows.map((o) => [o.id, o.number]));
  const couriers = new Map(courierRows.map((c) => [c.id, c]));
  return rows.map((r) => {
    const courier = r.courierId ? couriers.get(r.courierId) : undefined;
    const active = r.status !== 'delivered' && r.status !== 'failed' && r.status !== 'returned';
    return {
      id: r.id,
      orderId: r.orderId,
      orderNumber: numbers.get(r.orderId) ?? '',
      orgId: r.orgId,
      status: r.status,
      courier: courier ? { userId: courier.id, handle: courier.handle, displayName: courier.displayName } : null,
      estimatedMinutes: r.estimatedMinutes,
      proofCode: viewer === 'buyer' && active ? codes.codeFor(r.id, r.proofNonce) : null,
      proofLocked: r.proofLockedAt !== null,
      location:
        viewer === 'buyer' && r.status === 'in_transit' && r.lastLat !== null && r.lastLng !== null && r.lastLocationAt
          ? { lat: r.lastLat, lng: r.lastLng, updatedAt: r.lastLocationAt.toISOString() }
          : null,
      locationSharing: r.locationConsent,
      failureReason: r.failureReason,
      rating: r.rating,
      assignedAt: r.assignedAt?.toISOString() ?? null,
      pickedUpAt: r.pickedUpAt?.toISOString() ?? null,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export async function hydrateCourierDeliveries(db: DbExecutor, rows: DeliveryRow[]): Promise<CourierDelivery[]> {
  if (rows.length === 0) return [];
  const [orderRows, orgRows, itemRows] = await Promise.all([
    db.select().from(orders).where(inArray(orders.id, rows.map((r) => r.orderId))),
    db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, [...new Set(rows.map((r) => r.orgId))])),
    db
      .select({ orderId: orderItems.orderId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(inArray(orderItems.orderId, rows.map((r) => r.orderId))),
  ]);
  const orderById = new Map(orderRows.map((o) => [o.id, o]));
  const orgNames = new Map(orgRows.map((o) => [o.id, o.name]));
  const counts = new Map<string, number>();
  for (const i of itemRows) counts.set(i.orderId, (counts.get(i.orderId) ?? 0) + i.quantity);
  return rows.map((r) => {
    const o = orderById.get(r.orderId);
    return {
      id: r.id,
      orderId: r.orderId,
      orderNumber: o?.number ?? '',
      orgId: r.orgId,
      orgName: orgNames.get(r.orgId) ?? '',
      status: r.status,
      address: (o?.address as OrderAddress | null | undefined) ?? null,
      currency: (o?.currency ?? 'XXX').trim(),
      totalMinor: o?.totalMinor ?? 0,
      itemCount: counts.get(r.orderId) ?? 0,
      estimatedMinutes: r.estimatedMinutes,
      proofLocked: r.proofLockedAt !== null,
      locationSharing: r.locationConsent,
      failureReason: r.failureReason,
      assignedAt: r.assignedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export function toDeliveryEvent(e: DeliveryEventRow): DeliveryEvent {
  return {
    id: e.id,
    kind: e.kind,
    fromStatus: e.fromStatus,
    status: e.status,
    actorKind: e.actorKind,
    actorUserId: e.actorUserId,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  };
}

export async function loadDeliveryEvents(db: DbExecutor, deliveryId: string): Promise<DeliveryEvent[]> {
  const rows = await db
    .select()
    .from(deliveryEvents)
    .where(eq(deliveryEvents.deliveryId, deliveryId))
    .orderBy(asc(deliveryEvents.createdAt), asc(deliveryEvents.id));
  return rows.map(toDeliveryEvent);
}

/** 403 for a wrong proof code (details.remainingAttempts), 429 once locked. */
export const wrongProofCode = (remainingAttempts: number) =>
  new AppError(403, ErrorCodes.forbidden, 'The delivery code is not valid', { reason: 'invalid_proof_code', remainingAttempts });
export const proofLocked = () =>
  new AppError(429, ErrorCodes.rateLimited, 'Too many wrong codes: the delivery code is locked until the seller resets it', {
    reason: 'proof_locked',
  });

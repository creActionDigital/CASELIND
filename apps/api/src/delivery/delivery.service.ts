import { Inject, Injectable } from '@nestjs/common';
import {
  type CourierDelivery,
  type CourierDeliveryStatusRequest,
  type DeliveryDetail,
  type DeliveryList,
  type DeliveryListQuery,
  type DeliveryStatus,
  type DeliveryView,
  DELIVERY_SCHEDULE_VISIBLE_MINUTES,
  ErrorCodes,
  type MyDeliveryList,
  type MyDeliveryListQuery,
  type OrgDeliveryStatusRequest,
  PROOF_MAX_ATTEMPTS,
  type RateDeliveryRequest,
} from '@caselind/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { type DeliveryRow, deliveries, deliveryEvents, orgMembers, orders } from '../db/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { ORG_ROLE_PERMISSIONS, roleHasPermission } from '../orgs/org-permissions.js';
import { type Tx } from '../orgs/orgs.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import {
  ACTIVE_COURIER_STATUSES,
  byUrgency,
  COURIER_TRANSITIONS,
  decodeCursor,
  DeliveryCodes,
  deliveryNotFound,
  encodeCursor,
  FINAL_STATUSES,
  hydrateCourierDeliveries,
  hydrateDeliveries,
  invalidDeliveryTransition,
  loadDeliveryEvents,
  ORG_TRANSITIONS,
  proofLocked,
  UUID_RE,
  wrongProofCode,
} from './delivery.shared.js';

const ROLES_MANAGING_ORDERS = (Object.keys(ORG_ROLE_PERMISSIONS) as (keyof typeof ORG_ROLE_PERMISSIONS)[]).filter((r) =>
  ORG_ROLE_PERMISSIONS[r].has('orders.manage'),
);

type Actor = { kind: 'org' | 'courier' | 'buyer'; userId: string };

/** Result of a status change computed inside the transaction; notifications and realtime follow the commit. */
interface Changed {
  row: DeliveryRow;
  from: DeliveryStatus;
  orderNumber: string;
}

@Injectable()
export class DeliveryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly orders: OrdersService,
    private readonly codes: DeliveryCodes,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /* ------------------------------------------------------------------ seller side */

  async listForOrg(orgId: string, q: DeliveryListQuery): Promise<DeliveryList> {
    const filters = [eq(deliveries.orgId, orgId)];
    if (q.status) filters.push(eq(deliveries.status, q.status));
    if (q.courierUserId) filters.push(eq(deliveries.courierId, q.courierUserId));
    const { rows, nextCursor } = await this.page(filters, q.limit, q.cursor);
    return { items: await hydrateDeliveries(this.db, this.codes, rows, 'org'), nextCursor };
  }

  async getForOrg(orgId: string, deliveryId: string): Promise<DeliveryDetail> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const [row] = await this.db.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.orgId, orgId))).limit(1);
    if (!row) throw deliveryNotFound();
    const [view] = await hydrateDeliveries(this.db, this.codes, [row], 'org');
    return { ...view!, events: await loadDeliveryEvents(this.db, row.id) };
  }

  /** Assigns (or reassigns, until the pick-up) the delivery to an active `delivery` member, or to the caller. */
  async assign(orgId: string, actorUserId: string, deliveryId: string, courierUserId: string, meta: RequestMeta): Promise<DeliveryDetail> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const result = await this.db.transaction(async (tx) => {
      const d = await this.lockInOrg(tx, orgId, deliveryId);
      if (d.status !== 'pending' && d.status !== 'assigned') throw invalidDeliveryTransition(d.status, 'assigned');
      const order = await this.orderOf(tx, d.orderId);
      if (order.status === 'cancelled') throw AppError.conflict('The order is cancelled', { reason: 'order_cancelled' });

      const [member] = await tx
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, courierUserId), eq(orgMembers.status, 'active')))
        .limit(1);
      const self = courierUserId === actorUserId;
      if (!member || (!self && member.role !== 'delivery')) {
        throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
          { path: 'courierUserId', message: 'must be an active member with the delivery role, or yourself', reason: 'courier_not_eligible' },
        ]);
      }
      if (d.status === 'assigned' && d.courierId === courierUserId) return { changed: false as const, row: d, orderNumber: order.number };

      const [row] = await tx
        .update(deliveries)
        .set({ courierId: courierUserId, status: 'assigned', assignedAt: new Date(), locationConsent: false })
        .where(eq(deliveries.id, d.id))
        .returning();
      await tx.insert(deliveryEvents).values({
        deliveryId: d.id,
        kind: 'assignment',
        fromStatus: d.status,
        status: 'assigned',
        actorKind: 'org',
        actorUserId,
      });
      await this.audit.record(
        {
          action: 'delivery.assigned',
          actorUserId,
          subjectUserId: d.buyerId,
          meta,
          metadata: { orgId, deliveryId: d.id, orderId: d.orderId, courierUserId, previousCourierUserId: d.courierId },
        },
        tx,
      );
      return { changed: true as const, row: row!, previous: d.courierId, orderNumber: order.number };
    });

    if (result.changed) {
      const data = { deliveryId: result.row.id, orderId: result.row.orderId, orderNumber: result.orderNumber };
      await this.notifications.notify({
        userId: courierUserId,
        category: 'delivery',
        title: `Livraison ${result.orderNumber}`,
        body: 'Une livraison vous a été assignée.',
        data,
      });
      if (result.previous && result.previous !== courierUserId) {
        await this.notifications.notify({
          userId: result.previous,
          category: 'delivery',
          title: `Livraison ${result.orderNumber}`,
          body: 'Cette livraison a été réaffectée à un autre livreur.',
          data,
        });
      }
      await this.notifications.notify({
        userId: result.row.buyerId,
        category: 'delivery',
        title: `Commande ${result.orderNumber}`,
        body: 'Un livreur est assigné à votre commande.',
        data,
      });
      this.emitStatus(result.row, [result.row.buyerId, courierUserId]);
    }
    return this.getForOrg(orgId, deliveryId);
  }

  /** Seller side: give up a delivery that is not over, or record that the goods came back. */
  async changeStatusAsOrg(orgId: string, actorUserId: string, deliveryId: string, body: OrgDeliveryStatusRequest, meta: RequestMeta): Promise<DeliveryDetail> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const changed = await this.db.transaction(async (tx) => {
      const d = await this.lockInOrg(tx, orgId, deliveryId);
      if (!ORG_TRANSITIONS[d.status].includes(body.status)) throw invalidDeliveryTransition(d.status, body.status);
      return this.applyStatus(tx, d, body.status, { kind: 'org', userId: actorUserId }, { reason: body.reason }, meta);
    });
    await this.afterStatus(changed, { kind: 'org', userId: actorUserId });
    return this.getForOrg(orgId, deliveryId);
  }

  /** Unlocks the proof after too many wrong codes: new code for the buyer, attempts back to zero. */
  async resetProof(orgId: string, actorUserId: string, deliveryId: string, meta: RequestMeta): Promise<DeliveryDetail> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const done = await this.db.transaction(async (tx) => {
      const d = await this.lockInOrg(tx, orgId, deliveryId);
      if (!ACTIVE_COURIER_STATUSES.includes(d.status) && d.status !== 'pending') throw invalidDeliveryTransition(d.status, d.status);
      const proof = this.codes.issue(d.id);
      const [row] = await tx
        .update(deliveries)
        .set({ proofNonce: proof.nonce, proofHash: proof.hash, proofAttempts: 0, proofLockedAt: null })
        .where(eq(deliveries.id, d.id))
        .returning();
      await tx.insert(deliveryEvents).values({
        deliveryId: d.id,
        kind: 'proof',
        fromStatus: d.status,
        status: d.status,
        actorKind: 'org',
        actorUserId,
        note: 'proof_reset',
      });
      await this.audit.record(
        { action: 'delivery.proof_reset', actorUserId, subjectUserId: d.buyerId, meta, metadata: { orgId, deliveryId: d.id, orderId: d.orderId } },
        tx,
      );
      return { row: row!, orderNumber: (await this.orderOf(tx, d.orderId)).number };
    });
    await this.notifications.notify({
      userId: done.row.buyerId,
      category: 'delivery',
      title: `Commande ${done.orderNumber}`,
      body: 'Un nouveau code de livraison est disponible dans votre commande.',
      data: { deliveryId: done.row.id, orderId: done.row.orderId, orderNumber: done.orderNumber },
    });
    return this.getForOrg(orgId, deliveryId);
  }

  /* ------------------------------------------------------------------ courier side */

  async listMine(courierId: string, q: MyDeliveryListQuery): Promise<MyDeliveryList> {
    const filters = [eq(deliveries.courierId, courierId)];
    if (q.scope === 'active') filters.push(inArray(deliveries.status, [...ACTIVE_COURIER_STATUSES]));
    if (q.scope === 'done') filters.push(inArray(deliveries.status, [...FINAL_STATUSES]));
    // A scheduled delivery only shows 60 minutes before its slot (once under way it always shows).
    if (q.scope !== 'done') {
      filters.push(
        sql`(${deliveries.scheduledFor} IS NULL OR ${deliveries.status} <> 'assigned' OR ${deliveries.scheduledFor} <= now() + make_interval(mins => ${DELIVERY_SCHEDULE_VISIBLE_MINUTES}))` as ReturnType<typeof eq>,
      );
    }
    const { rows, nextCursor } = await this.page(filters, q.limit, q.cursor);
    // shortcut: express first inside a page only (cursor order stays newest first), fine for a courier's short list.
    return { items: byUrgency(await hydrateCourierDeliveries(this.db, rows)), nextCursor };
  }

  async getMine(courierId: string, deliveryId: string): Promise<CourierDelivery> {
    const row = await this.findOfCourier(courierId, deliveryId);
    const [view] = await hydrateCourierDeliveries(this.db, [row]);
    return view!;
  }

  async changeStatusAsCourier(courierId: string, deliveryId: string, body: CourierDeliveryStatusRequest, meta: RequestMeta): Promise<CourierDelivery> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const outcome = await this.db.transaction(async (tx) => {
      const d = await this.lockOfCourier(tx, courierId, deliveryId);
      await this.assertStillCourier(tx, d, courierId);
      if (!COURIER_TRANSITIONS[d.status].includes(body.status)) throw invalidDeliveryTransition(d.status, body.status);

      if (body.status === 'delivered') {
        if (d.proofLockedAt) return { kind: 'locked' as const };
        if (!this.codes.matches(d.id, body.code ?? '', d.proofHash)) {
          const attempts = d.proofAttempts + 1;
          const locked = attempts >= PROOF_MAX_ATTEMPTS;
          await tx
            .update(deliveries)
            .set({ proofAttempts: attempts, proofLockedAt: locked ? new Date() : null })
            .where(eq(deliveries.id, d.id));
          await tx.insert(deliveryEvents).values({
            deliveryId: d.id,
            kind: 'proof',
            fromStatus: d.status,
            status: d.status,
            actorKind: 'courier',
            actorUserId: courierId,
            note: locked ? 'proof_locked' : 'wrong_code',
          });
          return {
            kind: 'bad_code' as const,
            remaining: Math.max(0, PROOF_MAX_ATTEMPTS - attempts),
            locked,
            orgId: d.orgId,
            buyerId: d.buyerId,
            deliveryId: d.id,
            orderId: d.orderId,
            orderNumber: (await this.orderOf(tx, d.orderId)).number,
          };
        }
      }
      return { kind: 'ok' as const, changed: await this.applyStatus(tx, d, body.status, { kind: 'courier', userId: courierId }, { reason: body.reason, note: body.note }, meta) };
    });

    if (outcome.kind === 'locked') throw proofLocked();
    if (outcome.kind === 'bad_code') {
      if (outcome.locked) {
        const data = { deliveryId: outcome.deliveryId, orderId: outcome.orderId, orderNumber: outcome.orderNumber };
        await this.notifyManagers(outcome.orgId, `Livraison ${outcome.orderNumber}`, 'Le code de livraison est verrouillé après plusieurs erreurs : réinitialisez-le.', data);
        await this.notifications.notify({
          userId: outcome.buyerId,
          category: 'delivery',
          title: `Commande ${outcome.orderNumber}`,
          body: 'Plusieurs codes erronés ont été saisis. Le vendeur va vous communiquer un nouveau code.',
          data,
        });
        throw proofLocked();
      }
      throw wrongProofCode(outcome.remaining);
    }
    await this.afterStatus(outcome.changed, { kind: 'courier', userId: courierId });
    return this.getMine(courierId, deliveryId);
  }

  /** The courier reports a problem without changing the status (customer unreachable, vehicle trouble...). */
  async reportIncident(courierId: string, deliveryId: string, reason: string): Promise<CourierDelivery> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const done = await this.db.transaction(async (tx) => {
      const d = await this.lockOfCourier(tx, courierId, deliveryId);
      await this.assertStillCourier(tx, d, courierId);
      if (!ACTIVE_COURIER_STATUSES.includes(d.status)) throw invalidDeliveryTransition(d.status, d.status);
      await tx.insert(deliveryEvents).values({
        deliveryId: d.id,
        kind: 'incident',
        fromStatus: d.status,
        status: d.status,
        actorKind: 'courier',
        actorUserId: courierId,
        note: reason,
      });
      return { d, orderNumber: (await this.orderOf(tx, d.orderId)).number };
    });
    await this.notifyManagers(done.d.orgId, `Livraison ${done.orderNumber}`, 'Le livreur signale un incident : consultez le détail de la livraison.', {
      deliveryId: done.d.id,
      orderId: done.d.orderId,
      orderNumber: done.orderNumber,
    });
    return this.getMine(courierId, deliveryId);
  }

  /** The courier agrees (or stops agreeing) to share their position with the buyer. Withdrawing erases the last point. */
  async setLocationConsent(courierId: string, deliveryId: string, granted: boolean): Promise<CourierDelivery> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    await this.db.transaction(async (tx) => {
      const d = await this.lockOfCourier(tx, courierId, deliveryId);
      if (!ACTIVE_COURIER_STATUSES.includes(d.status)) throw invalidDeliveryTransition(d.status, d.status);
      await tx
        .update(deliveries)
        .set(granted ? { locationConsent: true } : { locationConsent: false, lastLat: null, lastLng: null, lastLocationAt: null })
        .where(eq(deliveries.id, d.id));
    });
    return this.getMine(courierId, deliveryId);
  }

  /**
   * Last known position, in transit only, with consent. Overwrites the previous point (no history), and is
   * pushed to the room of the order that only the buyer joins.
   */
  async postLocation(courierId: string, deliveryId: string, lat: number, lng: number): Promise<void> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const now = new Date();
    const [row] = await this.db
      .update(deliveries)
      .set({ lastLat: lat, lastLng: lng, lastLocationAt: now })
      .where(
        and(
          eq(deliveries.id, deliveryId),
          eq(deliveries.courierId, courierId),
          eq(deliveries.status, 'in_transit'),
          eq(deliveries.locationConsent, true),
        ),
      )
      .returning();
    if (!row) {
      const d = await this.findOfCourier(courierId, deliveryId);
      if (d.status !== 'in_transit') throw AppError.conflict('The delivery is not in transit', { reason: 'not_in_transit' });
      throw new AppError(403, ErrorCodes.forbidden, 'Location sharing was not accepted by the courier', { reason: 'location_consent_required' });
    }
    this.realtime.addToOrder([row.buyerId], row.orderId);
    this.realtime.emitToOrder(row.orderId, 'delivery.location', {
      orderId: row.orderId,
      deliveryId: row.id,
      lat,
      lng,
      updatedAt: now.toISOString(),
    });
  }

  /* ------------------------------------------------------------------ buyer side */

  /** One rating (1-5) of the courier by the buyer, once the order is delivered. */
  async rate(buyerId: string, orderId: string, body: RateDeliveryRequest): Promise<DeliveryView> {
    if (!UUID_RE.test(orderId)) throw deliveryNotFound();
    const done = await this.db.transaction(async (tx) => {
      const [d] = await tx
        .select()
        .from(deliveries)
        .where(and(eq(deliveries.orderId, orderId), eq(deliveries.buyerId, buyerId)))
        .for('update')
        .limit(1);
      if (!d) throw deliveryNotFound();
      if (d.status !== 'delivered' || !d.courierId) throw AppError.conflict('Only a delivered delivery can be rated', { reason: 'not_delivered' });
      if (d.rating !== null) throw AppError.conflict('This delivery was already rated', { reason: 'already_rated' });
      const [row] = await tx
        .update(deliveries)
        .set({ rating: body.rating, ratingComment: body.comment ?? null, ratedAt: new Date() })
        .where(eq(deliveries.id, d.id))
        .returning();
      return { row: row!, orderNumber: (await this.orderOf(tx, d.orderId)).number };
    });
    if (done.row.courierId) {
      await this.notifications.notify({
        userId: done.row.courierId,
        category: 'delivery',
        title: `Livraison ${done.orderNumber}`,
        body: `Vous avez reçu une évaluation : ${body.rating}/5.`,
        data: { deliveryId: done.row.id, orderId: done.row.orderId, orderNumber: done.orderNumber },
      });
    }
    const [view] = await hydrateDeliveries(this.db, this.codes, [done.row], 'buyer');
    return view!;
  }

  /* ------------------------------------------------------------------ internals */

  /** Updates the row and appends the event inside the caller's transaction; a final status erases the position. */
  private async applyStatus(
    tx: Tx,
    d: DeliveryRow,
    to: DeliveryStatus,
    actor: Actor,
    extra: { reason?: string; note?: string },
    meta: RequestMeta,
  ): Promise<Changed> {
    const now = new Date();
    const set: Partial<typeof deliveries.$inferInsert> = { status: to };
    const final = FINAL_STATUSES.includes(to);
    if (final) Object.assign(set, { lastLat: null, lastLng: null, lastLocationAt: null });
    if (to === 'picked_up') set.pickedUpAt = now;
    if (to === 'delivered') set.deliveredAt = now;
    if (to === 'failed') set.failureReason = extra.reason ?? null;

    if (to === 'picked_up') {
      if (!(await this.orders.syncFromDelivery(tx, d.orderId, 'shipped', actor.userId))) {
        throw AppError.conflict('The order is not ready to be picked up', { reason: 'order_not_ready' });
      }
    }
    if (to === 'delivered') {
      if (!(await this.orders.syncFromDelivery(tx, d.orderId, 'delivered', actor.userId))) {
        throw AppError.conflict('The order cannot be delivered', { reason: 'order_not_ready' });
      }
    }
    const [row] = await tx.update(deliveries).set(set).where(eq(deliveries.id, d.id)).returning();
    await tx.insert(deliveryEvents).values({
      deliveryId: d.id,
      kind: 'status',
      fromStatus: d.status,
      status: to,
      actorKind: actor.kind,
      actorUserId: actor.userId,
      note: extra.reason ?? extra.note ?? null,
    });
    const order = await this.orderOf(tx, d.orderId);
    await this.audit.record(
      {
        action: 'delivery.status_changed',
        actorUserId: actor.userId,
        subjectUserId: d.buyerId,
        meta,
        metadata: { orgId: d.orgId, deliveryId: d.id, orderId: d.orderId, from: d.status, to },
      },
      tx,
    );
    return { row: row!, from: d.status, orderNumber: order.number };
  }

  /** After the commit: realtime, then notifications without address, phone nor free text. */
  private async afterStatus(c: Changed, actor: Actor): Promise<void> {
    const { row, orderNumber } = c;
    const data = { deliveryId: row.id, orderId: row.orderId, orderNumber };
    const targets = [row.buyerId, ...(row.courierId ? [row.courierId] : [])];
    this.emitStatus(row, targets);
    if (FINAL_STATUSES.includes(row.status)) this.realtime.removeFromOrder([row.buyerId], row.orderId);
    if (row.status === 'in_transit') this.realtime.addToOrder([row.buyerId], row.orderId);

    const buyer = (body: string) =>
      this.notifications.notify({ userId: row.buyerId, category: 'delivery', title: `Commande ${orderNumber}`, body, data });
    switch (row.status) {
      case 'picked_up':
        await buyer('Le livreur a récupéré votre commande.');
        break;
      case 'in_transit':
        await buyer('Votre commande est en route.');
        break;
      case 'delivered':
        await buyer('Votre commande est livrée. Vous pouvez évaluer le livreur.');
        await this.notifyManagers(row.orgId, `Livraison ${orderNumber}`, 'La commande a été livrée.', data);
        break;
      case 'failed':
        await buyer('La livraison de votre commande a échoué. Le vendeur vous contactera.');
        await this.notifyManagers(row.orgId, `Livraison ${orderNumber}`, 'Une livraison a échoué : consultez le motif dans le détail.', data);
        if (actor.kind === 'org' && row.courierId && row.courierId !== actor.userId) {
          await this.notifications.notify({
            userId: row.courierId,
            category: 'delivery',
            title: `Livraison ${orderNumber}`,
            body: 'Le vendeur a clôturé cette livraison.',
            data,
          });
        }
        break;
      case 'returned':
        await this.notifyManagers(row.orgId, `Livraison ${orderNumber}`, 'Le colis est revenu au vendeur.', data);
        break;
      default:
        break;
    }
  }

  private emitStatus(row: DeliveryRow, userIds: string[]): void {
    for (const id of new Set(userIds)) {
      this.realtime.emitToUser(id, 'delivery.updated', { orderId: row.orderId, deliveryId: row.id, status: row.status });
    }
  }

  private async notifyManagers(orgId: string, title: string, body: string, data: Record<string, string>): Promise<void> {
    const members = await this.db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.status, 'active'), inArray(orgMembers.role, ROLES_MANAGING_ORDERS)));
    await this.notifications.notifyMany(
      members.map((m) => ({ userId: m.userId, category: 'delivery' as const, title, body, data: { orgId, ...data } })),
    );
  }

  private async orderOf(tx: Pick<Db, 'select'>, orderId: string): Promise<{ number: string; status: string }> {
    const [o] = await tx.select({ number: orders.number, status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o) throw deliveryNotFound();
    return o;
  }

  private async lockInOrg(tx: Tx, orgId: string, deliveryId: string): Promise<DeliveryRow> {
    const [d] = await tx.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.orgId, orgId))).for('update').limit(1);
    if (!d) throw deliveryNotFound();
    return d;
  }

  private async lockOfCourier(tx: Tx, courierId: string, deliveryId: string): Promise<DeliveryRow> {
    const [d] = await tx.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.courierId, courierId))).for('update').limit(1);
    if (!d) throw deliveryNotFound();
    return d;
  }

  private async findOfCourier(courierId: string, deliveryId: string): Promise<DeliveryRow> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const [d] = await this.db.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.courierId, courierId))).limit(1);
    if (!d) throw deliveryNotFound();
    return d;
  }

  /** A courier removed from the organisation (or whose role no longer allows deliveries) can no longer act. */
  private async assertStillCourier(tx: Tx, d: DeliveryRow, courierId: string): Promise<void> {
    const [m] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, d.orgId), eq(orgMembers.userId, courierId), eq(orgMembers.status, 'active')))
      .limit(1);
    if (!m || !(roleHasPermission(m.role, 'delivery.tasks') || roleHasPermission(m.role, 'orders.manage'))) {
      throw AppError.forbidden('You can no longer carry deliveries for this organisation');
    }
  }

  private async page(
    filters: ReturnType<typeof eq>[],
    limit: number,
    cursor: string | undefined,
  ): Promise<{ rows: DeliveryRow[]; nextCursor: string | null }> {
    if (cursor) {
      const c = decodeCursor(cursor);
      filters.push(sql`(${deliveries.createdAt}, ${deliveries.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)` as ReturnType<typeof eq>);
    }
    const found = await this.db
      .select({ row: deliveries, exact: sql<string>`${deliveries.createdAt}::text` })
      .from(deliveries)
      .where(and(...filters))
      .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
      .limit(limit + 1);
    const page = found.slice(0, limit);
    const last = page.at(-1);
    return {
      rows: page.map((r) => r.row),
      nextCursor: found.length > limit && last ? encodeCursor(last.exact, last.row.id) : null,
    };
  }
}


import { Inject, Injectable } from '@nestjs/common';
import {
  type CustomerList,
  type SalesSummary,
  type CheckoutRequest,
  ErrorCodes,
  type Order,
  type OrderDetail,
  type OrderList,
  type OrderListQuery,
  type OrderStatus,
  type ReserveConflictDetails,
} from '@caselind/contracts';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { CatalogPort, type PricedLine } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { cartItems, deliveries, deliveryEvents, orderEvents, orderItems, orgMembers, orders, type OrderRow } from '../db/schema.js';
import { DeliveryZonesService } from '../delivery/delivery-zones.service.js';
import { DeliveryCodes, hydrateDeliveries } from '../delivery/delivery.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ORG_ROLE_PERMISSIONS } from '../orgs/org-permissions.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { resolveContactUserId } from '../orgs/org-contact.js';
import { pgErrorOf, type Tx } from '../orgs/orgs.service.js';
import { CouponsService } from './coupons.service.js';
import {
  BUYER_TRANSITIONS,
  decodeCursor,
  encodeCursor,
  hydrateDetail,
  hydrateOrders,
  invalidTransition,
  newOrderNumber,
  orderNotFound,
  SELLER_TRANSITIONS,
  UUID_RE,
  validationError,
} from './orders.shared.js';
import { PaymentMethods } from './payment-methods.js';

type Actor = { kind: 'buyer'; userId: string } | { kind: 'org'; userId: string; orgId: string; meta: RequestMeta };

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'en attente',
  confirmed: 'confirmée',
  preparing: 'en préparation',
  shipped: 'expédiée',
  delivered: 'livrée',
  cancelled: 'annulée',
};

const ROLES_MANAGING_ORDERS = (Object.keys(ORG_ROLE_PERMISSIONS) as (keyof typeof ORG_ROLE_PERMISSIONS)[]).filter((r) =>
  ORG_ROLE_PERMISSIONS[r].has('orders.manage'),
);

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogPort,
    private readonly coupons: CouponsService,
    private readonly payments: PaymentMethods,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly zones: DeliveryZonesService,
    private readonly codes: DeliveryCodes,
    private readonly loyalty: LoyaltyService,
  ) {}

  /* ------------------------------------------------------------------ checkout */

  /**
   * One order per (organisation, currency) of the cart, all created in one transaction together with the
   * stock reservation, the coupon uses and the emptying of the cart. Idempotent per `clientId`:
   * `created` is false when the orders already existed.
   */
  async checkout(buyerId: string, req: CheckoutRequest): Promise<{ orders: Order[]; created: boolean }> {
    if (!this.payments.isAvailable(req.paymentMethod)) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
        { path: 'paymentMethod', message: 'payment method not available' },
      ]);
    }
    const replay = await this.findByClientId(this.db, buyerId, req.clientId);
    if (replay.length > 0) return { orders: await hydrateOrders(this.db, replay), created: false };
    if (req.fulfillment === 'delivery' && !req.address) throw validationError('address', 'a delivery needs an address');

    let outcome: { rows: OrderRow[]; created: boolean };
    try {
      outcome = await this.db.transaction((tx) => this.checkoutTx(tx, buyerId, req));
    } catch (err) {
      // Lost a race against the same clientId (the cart lock normally serialises it): replay.
      if (pgErrorOf(err).constraint !== 'orders_checkout_unique') throw err;
      const rows = await this.findByClientId(this.db, buyerId, req.clientId);
      return { orders: await hydrateOrders(this.db, rows), created: false };
    }
    const hydrated = await hydrateOrders(this.db, outcome.rows);
    if (outcome.created) {
      for (const o of hydrated) {
        await this.notifyOrgManagers(o.orgId, 'Nouvelle commande', `Commande ${o.number} - total ${o.totalMinor} ${o.currency}`, o);
      }
    }
    return { orders: hydrated, created: outcome.created };
  }

  private findByClientId(db: Pick<Db, 'select'>, buyerId: string, clientId: string): Promise<OrderRow[]> {
    return db
      .select()
      .from(orders)
      .where(and(eq(orders.buyerId, buyerId), eq(orders.clientId, clientId)))
      .orderBy(orders.orgId, orders.currency);
  }

  private async checkoutTx(tx: Tx, buyerId: string, req: CheckoutRequest): Promise<{ rows: OrderRow[]; created: boolean }> {
    // The cart rows are the per-user lock: two concurrent checkouts of one user run one after the other.
    const cart = await tx
      .select({ variantId: cartItems.variantId, quantity: cartItems.quantity })
      .from(cartItems)
      .where(eq(cartItems.userId, buyerId))
      .orderBy(cartItems.variantId)
      .for('update');
    const again = await this.findByClientId(tx, buyerId, req.clientId);
    if (again.length > 0) return { rows: again, created: false };
    if (cart.length === 0) throw AppError.conflict('The cart is empty', { reason: 'empty_cart' });

    const reserved = await this.catalog.reserve(tx, cart, buyerId);
    if (!reserved.ok) {
      const details: ReserveConflictDetails = { reason: reserved.reason, variantIds: reserved.variantIds };
      throw AppError.conflict('Some items are no longer available', details);
    }

    const groups = new Map<string, { orgId: string; currency: string; lines: PricedLine[]; subtotalMinor: number }>();
    for (const line of reserved.lines) {
      const key = `${line.orgId}|${line.currency}`;
      const g = groups.get(key) ?? { orgId: line.orgId, currency: line.currency, lines: [], subtotalMinor: 0 };
      g.lines.push(line);
      g.subtotalMinor += line.unitPriceMinor * line.quantity;
      groups.set(key, g);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const applied = await this.coupons.resolve(
      tx,
      buyerId,
      req.couponCodes ?? [],
      ordered.map(([, g]) => ({ orgId: g.orgId, currency: g.currency, subtotalMinor: g.subtotalMinor })),
    );

    const rows: OrderRow[] = [];
    for (const [key, g] of ordered) {
      const coupon = applied.get(key);
      const discountMinor = coupon?.discountMinor ?? 0;
      // Lot 8: a delivery is priced by the seller's zone (free without zones); a pick-up is free.
      const zone =
        req.fulfillment === 'delivery' && req.address
          ? await this.zones.resolveForCheckout(tx, g.orgId, g.currency, req.zones?.find((z) => z.orgId === g.orgId)?.zoneId, req.address)
          : null;
      const deliveryFeeMinor = zone?.feeMinor ?? 0;
      const [order] = await tx
        .insert(orders)
        .values({
          number: await this.freeNumber(tx),
          buyerId,
          orgId: g.orgId,
          clientId: req.clientId,
          currency: g.currency,
          subtotalMinor: g.subtotalMinor,
          discountMinor,
          totalMinor: g.subtotalMinor - discountMinor + deliveryFeeMinor,
          fulfillment: req.fulfillment,
          deliveryFeeMinor,
          deliveryZoneId: zone?.zoneId ?? null,
          couponId: coupon?.coupon.id ?? null,
          couponCode: coupon?.coupon.code ?? null,
          paymentMethod: req.paymentMethod,
          address: req.address ?? null,
        })
        .returning();
      await tx.insert(orderItems).values(
        g.lines.map((l) => ({
          orderId: order!.id,
          variantId: l.variantId,
          productId: l.productId,
          title: l.title,
          variantLabel: l.variantLabel,
          sku: l.sku,
          unitPriceMinor: l.unitPriceMinor,
          quantity: l.quantity,
          lineTotalMinor: l.unitPriceMinor * l.quantity,
          imageAssetId: l.imageAssetId,
        })),
      );
      await tx.insert(orderEvents).values({ orderId: order!.id, fromStatus: null, status: 'pending', actorKind: 'buyer', actorUserId: buyerId });
      if (coupon) await this.coupons.redeem(tx, coupon.coupon.id, order!.id, buyerId);
      if (req.fulfillment === 'delivery') {
        // One delivery per order to deliver; the proof code is issued now (stored as a keyed hash).
        const deliveryId = randomUUID();
        const proof = this.codes.issue(deliveryId);
        await tx.insert(deliveries).values({
          id: deliveryId,
          orderId: order!.id,
          orgId: g.orgId,
          buyerId,
          proofNonce: proof.nonce,
          proofHash: proof.hash,
          estimatedMinutes: zone?.etaMinutes ?? null,
        });
        await tx.insert(deliveryEvents).values({ deliveryId, kind: 'status', fromStatus: null, status: 'pending', actorKind: 'buyer', actorUserId: buyerId });
      }
      rows.push(order!);
    }
    await tx.delete(cartItems).where(eq(cartItems.userId, buyerId));
    return { rows, created: true };
  }

  private async freeNumber(tx: Tx): Promise<string> {
    for (let i = 0; i < 8; i += 1) {
      const n = newOrderNumber();
      const [hit] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.number, n)).limit(1);
      if (!hit) return n;
    }
    throw new Error('could not allocate an order number');
  }

  /* ------------------------------------------------------------------ reads */

  listMine(buyerId: string, q: OrderListQuery): Promise<OrderList> {
    return this.page(q, eq(orders.buyerId, buyerId));
  }

  /** Orders, revenue (cancelled excluded), average basket and top 5 products per currency over the last `days` days. */
  async salesSummary(orgId: string, days: number): Promise<SalesSummary> {
    const totals = await this.db.execute<{ currency: string; n: number; cancelled: number; revenue: string }>(sql`
      SELECT currency::text AS currency, count(*) FILTER (WHERE status <> 'cancelled')::int AS n, count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
             COALESCE(sum(total_minor) FILTER (WHERE status <> 'cancelled'), 0)::text AS revenue
      FROM orders WHERE org_id = ${orgId}::uuid AND created_at >= now() - ${days}::int * interval '1 day' GROUP BY currency ORDER BY currency`);
    const tops = await this.db.execute<{ currency: string; product_id: string; title: string; qty: number; revenue: string; rk: number }>(sql`
      SELECT * FROM (
        SELECT o.currency::text AS currency, i.product_id, max(i.title) AS title, sum(i.quantity)::int AS qty, sum(i.line_total_minor)::text AS revenue,
               row_number() OVER (PARTITION BY o.currency ORDER BY sum(i.quantity) DESC, i.product_id) AS rk
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.org_id = ${orgId}::uuid AND o.status <> 'cancelled' AND o.created_at >= now() - ${days}::int * interval '1 day'
        GROUP BY o.currency, i.product_id) t WHERE rk <= 5 ORDER BY currency, rk`);
    return {
      days,
      currencies: totals.rows.map((t) => ({
        currency: t.currency,
        orders: t.n,
        cancelled: t.cancelled,
        revenueMinor: Number(t.revenue),
        averageBasketMinor: t.n === 0 ? 0 : Math.round(Number(t.revenue) / t.n),
        topProducts: tops.rows.filter((p) => p.currency === t.currency).map((p) => ({ productId: p.product_id, title: p.title, quantity: p.qty, revenueMinor: Number(p.revenue) })),
      })),
    };
  }

  /** Buyers of the organisation, best spenders first (one line per buyer and currency, top 100). */
  async customers(orgId: string): Promise<CustomerList> {
    const res = await this.db.execute<{ handle: string; display_name: string; currency: string; n: number; spent: string; last: Date }>(sql`
      SELECT u.handle::text AS handle, u.display_name, o.currency::text AS currency, count(*)::int AS n, sum(o.total_minor)::text AS spent, max(o.created_at) AS last
      FROM orders o JOIN users u ON u.id = o.buyer_id
      WHERE o.org_id = ${orgId}::uuid AND o.status <> 'cancelled'
      GROUP BY u.id, u.handle, u.display_name, o.currency ORDER BY sum(o.total_minor) DESC, max(o.created_at) DESC LIMIT 100`);
    return { items: res.rows.map((r) => ({ handle: r.handle, displayName: r.display_name, currency: r.currency, orders: r.n, spentMinor: Number(r.spent), lastOrderAt: new Date(r.last).toISOString() })) };
  }

  listForOrg(orgId: string, q: OrderListQuery): Promise<OrderList> {
    return this.page(q, eq(orders.orgId, orgId));
  }

  private async page(q: OrderListQuery, scope: ReturnType<typeof eq>): Promise<OrderList> {
    const filters = [scope];
    if (q.status) filters.push(eq(orders.status, q.status));
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${orders.createdAt}, ${orders.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({ row: orders, exact: sql<string>`${orders.createdAt}::text` })
      .from(orders)
      .where(and(...filters))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await hydrateOrders(this.db, page.map((r) => r.row)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.exact, last.row.id) : null,
    };
  }

  async getMine(buyerId: string, orderId: string): Promise<OrderDetail> {
    const row = await this.findOwned(orderId, eq(orders.buyerId, buyerId));
    return this.withContact(await this.withDelivery(await hydrateDetail(this.db, row), 'buyer'), buyerId);
  }

  /** Lot 8: the delivery of the order; the proof code is only filled for the buyer. */
  private async withDelivery(detail: OrderDetail, viewer: 'buyer' | 'org'): Promise<OrderDetail> {
    const [row] = await this.db.select().from(deliveries).where(eq(deliveries.orderId, detail.id)).limit(1);
    if (!row) return detail;
    const [view] = await hydrateDeliveries(this.db, this.codes, [row], viewer);
    return { ...detail, delivery: view ?? null };
  }

  /** Buyer view: who to talk to about the order (null when blocked with the buyer or nobody is available). */
  private async withContact(detail: OrderDetail, buyerId: string): Promise<OrderDetail> {
    return { ...detail, contactUserId: await resolveContactUserId(this.db, detail.orgId, buyerId) };
  }

  async getForOrg(orgId: string, orderId: string): Promise<OrderDetail> {
    const row = await this.findOwned(orderId, eq(orders.orgId, orgId));
    return this.withDelivery(await hydrateDetail(this.db, row), 'org');
  }

  private async findOwned(orderId: string, scope: ReturnType<typeof eq>): Promise<OrderRow> {
    if (!UUID_RE.test(orderId)) throw orderNotFound();
    const [row] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), scope)).limit(1);
    if (!row) throw orderNotFound();
    return row;
  }

  /* ------------------------------------------------------------------ lifecycle */

  async cancelAsBuyer(buyerId: string, orderId: string, note?: string): Promise<OrderDetail> {
    return this.withContact(await this.transition(orderId, { kind: 'buyer', userId: buyerId }, 'cancelled', note), buyerId);
  }

  changeStatusAsOrg(orgId: string, userId: string, orderId: string, to: OrderStatus, note: string | undefined, meta: RequestMeta): Promise<OrderDetail> {
    return this.transition(orderId, { kind: 'org', userId, orgId, meta }, to, note);
  }

  /**
   * The only place an order changes status. The order row is locked, the transition checked against its
   * current status, the event appended; a cancellation gives the stock and the coupon use back in the same
   * transaction. The notification follows the commit.
   */
  private async transition(orderId: string, actor: Actor, to: OrderStatus, note: string | undefined): Promise<OrderDetail> {
    if (!UUID_RE.test(orderId)) throw orderNotFound();
    const { row, from, orphanedCouriers } = await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update').limit(1);
      if (!locked || (actor.kind === 'buyer' ? locked.buyerId !== actor.userId : locked.orgId !== actor.orgId)) {
        throw orderNotFound();
      }
      const allowed = (actor.kind === 'buyer' ? BUYER_TRANSITIONS : SELLER_TRANSITIONS)[locked.status];
      if (!allowed.includes(to)) throw invalidTransition(locked.status, to);

      const [updated] = await tx.update(orders).set({ status: to }).where(eq(orders.id, orderId)).returning();
      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: locked.status,
        status: to,
        actorKind: actor.kind,
        actorUserId: actor.userId,
        note: note ?? null,
      });
      if (to === 'cancelled') {
        const lines = await tx
          .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId));
        await this.catalog.release(tx, lines);
        await this.coupons.release(tx, orderId);
      }
      let orphaned: string[] = [];
      if (to === 'cancelled') {
        // Lot 8: a delivery not picked up yet ends with the order.
        const open = await tx
          .select()
          .from(deliveries)
          .where(and(eq(deliveries.orderId, orderId), inArray(deliveries.status, ['pending', 'assigned'])))
          .for('update');
        for (const d of open) {
          await tx.update(deliveries).set({ status: 'failed', failureReason: 'order_cancelled' }).where(eq(deliveries.id, d.id));
          await tx.insert(deliveryEvents).values({
            deliveryId: d.id,
            kind: 'status',
            fromStatus: d.status,
            status: 'failed',
            actorKind: actor.kind === 'org' ? 'org' : 'buyer',
            actorUserId: actor.userId,
            note: 'order_cancelled',
          });
        }
        orphaned = open.map((d) => d.courierId).filter((v): v is string => v !== null);
      }
      if (actor.kind === 'org') {
        await this.audit.record(
          {
            action: 'commerce.order_status_changed',
            actorUserId: actor.userId,
            subjectUserId: locked.buyerId,
            meta: actor.meta,
            metadata: { orgId: actor.orgId, orderId, number: locked.number, from: locked.status, to },
          },
          tx,
        );
      }
      return { row: updated!, from: locked.status, orphanedCouriers: orphaned };
    });

    // Lot 16h: loyalty points are best effort, an error here must never break the status change.
    if (to === 'delivered') await this.loyalty.awardForOrder(orderId).catch(() => undefined);
    const detail = await this.withDelivery(await hydrateDetail(this.db, row), actor.kind === 'org' ? 'org' : 'buyer');
    await this.notifications.notifyMany(
      orphanedCouriers.map((userId) => ({
        userId,
        category: 'delivery' as const,
        title: `Livraison ${row.number}`,
        body: 'La commande a été annulée : la livraison est retirée de vos tâches.',
        data: { orderId: row.id, orderNumber: row.number },
      })),
    );
    if (actor.kind === 'org') {
      await this.notifications.notify({
        userId: row.buyerId,
        category: 'commerce',
        title: `Commande ${row.number}`,
        body: `Votre commande est ${STATUS_LABEL[to]}.`,
        data: { orderId: row.id, orderNumber: row.number, status: to },
      });
    } else {
      await this.notifyOrgManagers(row.orgId, `Commande ${row.number}`, `Annulée par l'acheteur (était ${STATUS_LABEL[from]}).`, detail);
    }
    return detail;
  }

  /**
   * Lot 8: the delivery moves the order along (`shipped` at pick-up, `delivered` at hand-over), inside the
   * delivery transaction. Never goes backwards and is a no-op when the seller already did it by hand.
   * Returns false when the order is not in a state that allows the move (cancelled, not prepared yet).
   */
  async syncFromDelivery(tx: Tx, orderId: string, to: 'shipped' | 'delivered', actorUserId: string): Promise<boolean> {
    const [locked] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update').limit(1);
    if (!locked) return false;
    if (locked.status === to || locked.status === 'delivered') return true;
    const ok = to === 'shipped' ? locked.status === 'preparing' : locked.status === 'shipped' || locked.status === 'preparing';
    if (!ok) return false;
    await tx.update(orders).set({ status: to }).where(eq(orders.id, orderId));
    await tx.insert(orderEvents).values({
      orderId,
      fromStatus: locked.status,
      status: to,
      actorKind: 'system',
      actorUserId,
      note: 'delivery',
    });
    // Lot 16h: best effort in a savepoint (a failure must not abort the delivery transaction).
    if (to === 'delivered') await tx.transaction((t) => this.loyalty.awardForOrder(orderId, t)).catch(() => undefined);
    return true;
  }

  /** Members holding `orders.manage`, notified with the order number and total only. */
  private async notifyOrgManagers(orgId: string, title: string, body: string, order: Pick<Order, 'id' | 'number'>): Promise<void> {
    const members = await this.db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.status, 'active'), inArray(orgMembers.role, ROLES_MANAGING_ORDERS)));
    await this.notifications.notifyMany(
      members.map((m) => ({
        userId: m.userId,
        category: 'commerce' as const,
        title,
        body,
        data: { orgId, orderId: order.id, orderNumber: order.number },
      })),
    );
  }
}

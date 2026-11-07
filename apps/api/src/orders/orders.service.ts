import { Inject, Injectable } from '@nestjs/common';
import {
  type CheckoutRequest,
  ErrorCodes,
  type Order,
  type OrderDetail,
  type OrderList,
  type OrderListQuery,
  type OrderStatus,
  type ReserveConflictDetails,
} from '@caselind/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { CatalogPort, type PricedLine } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { cartItems, orderEvents, orderItems, orgMembers, orders, type OrderRow } from '../db/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ORG_ROLE_PERMISSIONS } from '../orgs/org-permissions.js';
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
          totalMinor: g.subtotalMinor - discountMinor,
          couponId: coupon?.coupon.id ?? null,
          couponCode: coupon?.coupon.code ?? null,
          paymentMethod: req.paymentMethod,
          address: req.address,
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
    return this.withContact(await hydrateDetail(this.db, row), buyerId);
  }

  /** Buyer view: who to talk to about the order (null when blocked with the buyer or nobody is available). */
  private async withContact(detail: OrderDetail, buyerId: string): Promise<OrderDetail> {
    return { ...detail, contactUserId: await resolveContactUserId(this.db, detail.orgId, buyerId) };
  }

  async getForOrg(orgId: string, orderId: string): Promise<OrderDetail> {
    const row = await this.findOwned(orderId, eq(orders.orgId, orgId));
    return hydrateDetail(this.db, row);
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
    const { row, from } = await this.db.transaction(async (tx) => {
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
      return { row: updated!, from: locked.status };
    });

    const detail = await hydrateDetail(this.db, row);
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

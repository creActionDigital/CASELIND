import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateReturnRequest,
  type DisputeListQuery,
  type OrderReturn,
  type OrderReturns,
  RETURN_TRANSITIONS,
  RETURN_WINDOW_DAYS,
  type ResolveReturnDisputeRequest,
  type ReturnActorKind,
  type ReturnList,
  type ReturnListQuery,
  type ReturnStatus,
} from '@caselind/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { CatalogPort } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { orderItems, orderReturnEvents, orderReturns, orgMembers, orders, type OrderReturnRow, type ReturnItemJson } from '../db/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ORG_ROLE_PERMISSIONS } from '../orgs/org-permissions.js';
import { pgErrorOf, type Tx } from '../orgs/orgs.service.js';
import { WebhookService } from '../webhooks/webhooks.service.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { computeRefundMinor, hydrateReturns, returnNotFound } from './order-returns.shared.js';
import { decodeCursor, encodeCursor, orderNotFound, UUID_RE, validationError } from './orders.shared.js';

type Actor =
  | { kind: 'buyer'; userId: string }
  | { kind: 'org'; userId: string; orgId: string; meta?: RequestMeta }
  | { kind: 'admin'; userId: string; meta?: RequestMeta };

/** What a transition changes beyond the status (computed against the locked row). */
type Patch = Partial<Pick<OrderReturnRow, 'sellerNote' | 'resolution' | 'disputeReason' | 'adminNote' | 'resolvedBy' | 'restock' | 'refundMinor' | 'refundedMinor'>>;

const ROLES_MANAGING_ORDERS = (Object.keys(ORG_ROLE_PERMISSIONS) as (keyof typeof ORG_ROLE_PERMISSIONS)[]).filter((r) =>
  ORG_ROLE_PERMISSIONS[r].has('orders.manage'),
);
const DAY_MS = 86_400_000;

/**
 * Returns, refunds and disputes of an order. No money moves here: the only payment method is cash on
 * delivery, so a refund is a status and an amount recorded ("settled outside the platform"). A future
 * online payment would plug in at the `refunded` transition.
 */
@Injectable()
export class OrderReturnsService {
  private readonly logger = new Logger(OrderReturnsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogPort,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhookService,
  ) {}

  /* ------------------------------------------------------------------ buyer */

  async request(buyerId: string, orderId: string, req: CreateReturnRequest, meta: RequestMeta): Promise<OrderReturn> {
    if (!UUID_RE.test(orderId)) throw orderNotFound();
    let row: OrderReturnRow;
    let number = '';
    try {
      ({ row, number } = await this.db.transaction(async (tx) => {
        const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId))).for('update').limit(1);
        if (!order) throw orderNotFound();
        if (order.status !== 'delivered') throw AppError.conflict('Only a delivered order can be returned', { reason: 'not_delivered' });
        const deliveredAt = await this.deliveredAt(tx, orderId);
        if (!deliveredAt || Date.now() > deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY_MS) {
          throw AppError.conflict(`The return window of ${RETURN_WINDOW_DAYS} days is over`, { reason: 'window_closed' });
        }
        const [live] = await tx.select({ id: orderReturns.id }).from(orderReturns).where(and(eq(orderReturns.orderId, orderId), sql`${orderReturns.status} <> 'cancelled'`)).limit(1);
        if (live) throw AppError.conflict('This order already has a return', { reason: 'return_exists' });

        const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        const byId = new Map(lines.map((l) => [l.id, l]));
        const items: ReturnItemJson[] = req.items.map((i, n) => {
          const line = byId.get(i.orderItemId);
          if (!line) throw validationError(`items.${n}.orderItemId`, 'not a line of this order');
          if (i.quantity > line.quantity) throw validationError(`items.${n}.quantity`, 'more than ordered');
          return { orderItemId: line.id, variantId: line.variantId, title: line.title, unitPriceMinor: line.unitPriceMinor, quantity: i.quantity };
        });
        const [created] = await tx
          .insert(orderReturns)
          .values({
            orderId,
            orgId: order.orgId,
            requestedBy: buyerId,
            reason: req.reason,
            details: req.details ?? null,
            items,
            refundMinor: computeRefundMinor(items, order),
            currency: order.currency,
          })
          .returning();
        await tx.insert(orderReturnEvents).values({ returnId: created!.id, fromStatus: null, status: 'requested', actorKind: 'buyer', actorUserId: buyerId });
        await this.audit.record(
          { action: 'commerce.return_requested', actorUserId: buyerId, meta, metadata: { orderId, returnId: created!.id, orgId: order.orgId, refundMinor: created!.refundMinor, currency: order.currency.trim() } },
          tx,
        );
        return { row: created!, number: order.number };
      }));
    } catch (err) {
      if (pgErrorOf(err).constraint === 'order_returns_one_live_idx') throw AppError.conflict('This order already has a return', { reason: 'return_exists' });
      throw err;
    }
    // Webhook: ids, status and amount only (no buyer, no text).
    this.webhooks.emit(row.orgId, 'order.return_requested', { orderId, returnId: row.id, number, status: row.status, refundMinor: row.refundMinor, currency: row.currency.trim() });
    await bestEffort(this.logger, 'return notification', () => this.notifyOrg(row, number, buyerId));
    return (await hydrateReturns(this.db, [row]))[0]!;
  }

  async listForOrder(buyerId: string, orderId: string): Promise<OrderReturns> {
    if (!UUID_RE.test(orderId)) throw orderNotFound();
    const [order] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId))).limit(1);
    if (!order) throw orderNotFound();
    const rows = await this.db.select().from(orderReturns).where(eq(orderReturns.orderId, orderId)).orderBy(desc(orderReturns.createdAt), desc(orderReturns.id));
    const deliveredAt = order.status === 'delivered' ? await this.deliveredAt(this.db, orderId) : null;
    const windowEnd = deliveredAt ? new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY_MS) : null;
    return {
      items: await hydrateReturns(this.db, rows),
      canRequest: windowEnd !== null && Date.now() <= windowEnd.getTime() && rows.every((r) => r.status === 'cancelled'),
      windowEndsAt: windowEnd?.toISOString() ?? null,
    };
  }

  cancel(buyerId: string, id: string): Promise<OrderReturn> {
    return this.move(id, { kind: 'buyer', userId: buyerId }, 'cancelled', () => ({}));
  }

  dispute(buyerId: string, id: string, reason: string): Promise<OrderReturn> {
    return this.move(id, { kind: 'buyer', userId: buyerId }, 'disputed', () => ({ disputeReason: reason }));
  }

  /* ------------------------------------------------------------------ seller */

  listForOrg(orgId: string, q: ReturnListQuery): Promise<ReturnList> {
    return this.page(q, eq(orderReturns.orgId, orgId));
  }

  approve(orgId: string, userId: string, id: string, note: string | undefined, meta: RequestMeta): Promise<OrderReturn> {
    return this.move(id, { kind: 'org', userId, orgId, meta }, 'approved', () => ({ sellerNote: note ?? null, resolution: 'refund_buyer' }));
  }

  reject(orgId: string, userId: string, id: string, note: string | undefined, meta: RequestMeta): Promise<OrderReturn> {
    return this.move(id, { kind: 'org', userId, orgId, meta }, 'rejected', () => ({ sellerNote: note ?? null, resolution: 'reject' }));
  }

  /** The goods are back; `restock` puts them on the shelf again (stock movement `return_restocked`). */
  received(orgId: string, userId: string, id: string, restock: boolean, note: string | undefined, meta: RequestMeta): Promise<OrderReturn> {
    return this.move(id, { kind: 'org', userId, orgId, meta }, 'received', async (locked, tx) => {
      if (restock) {
        const items = await tx.select({ id: orderItems.id, promotionId: orderItems.promotionId, promoUnits: orderItems.promoUnits }).from(orderItems).where(eq(orderItems.orderId, locked.orderId));
        const promoOf = new Map(items.map((i) => [i.id, i]));
        const promos = locked.items.flatMap((i) => {
          const p = promoOf.get(i.orderItemId);
          return p?.promotionId ? [{ promotionId: p.promotionId, units: Math.min(p.promoUnits, i.quantity) }] : [];
        });
        await this.catalog.release(tx, locked.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })), { reason: 'return_restocked', promos });
      }
      return { restock, ...(note !== undefined ? { sellerNote: note } : {}) };
    });
  }

  /** The seller settled the refund outside the platform (cash). Defaults to the amount due. */
  refunded(orgId: string, userId: string, id: string, amountMinor: number | undefined, note: string | undefined, meta: RequestMeta): Promise<OrderReturn> {
    return this.move(id, { kind: 'org', userId, orgId, meta }, 'refunded', (locked) => {
      if (locked.status === 'resolved' && locked.resolution === 'reject') throw AppError.conflict('A return rejected by the platform cannot be refunded', { reason: 'invalid_transition', from: locked.status, to: 'refunded' });
      if (amountMinor !== undefined && amountMinor > locked.refundMinor) throw validationError('amountMinor', 'more than the amount due');
      return { refundedMinor: amountMinor ?? locked.refundMinor, ...(note !== undefined ? { sellerNote: note } : {}) };
    });
  }

  /* ------------------------------------------------------------------ admin */

  listDisputes(q: DisputeListQuery): Promise<ReturnList> {
    // A resolved dispute is one that went through the platform (admin note or resolver set).
    return this.page(q, q.status === 'disputed' ? eq(orderReturns.status, 'disputed') : and(eq(orderReturns.status, 'resolved'), sql`${orderReturns.resolvedBy} IS NOT NULL`)!);
  }

  resolve(adminId: string, id: string, req: ResolveReturnDisputeRequest, meta: RequestMeta): Promise<OrderReturn> {
    return this.move(id, { kind: 'admin', userId: adminId, meta }, 'resolved', (locked) => {
      if (req.resolution === 'refund_partial' && req.refundMinor! > locked.refundMinor) throw validationError('refundMinor', 'more than the amount due');
      return {
        resolution: req.resolution,
        adminNote: req.note ?? null,
        resolvedBy: adminId,
        ...(req.resolution === 'refund_partial' ? { refundMinor: req.refundMinor! } : {}),
      };
    });
  }

  /* ------------------------------------------------------------------ internals */

  private async page(q: { status?: ReturnStatus; limit: number; cursor?: string }, scope: ReturnType<typeof eq>): Promise<ReturnList> {
    const filters = [scope];
    if (q.status) filters.push(eq(orderReturns.status, q.status));
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${orderReturns.createdAt}, ${orderReturns.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({ row: orderReturns, exact: sql<string>`${orderReturns.createdAt}::text` })
      .from(orderReturns)
      .where(and(...filters))
      .orderBy(desc(orderReturns.createdAt), desc(orderReturns.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await hydrateReturns(this.db, page.map((r) => r.row)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.exact, last.row.id) : null,
    };
  }

  private async deliveredAt(db: Pick<Db, 'execute'>, orderId: string): Promise<Date | null> {
    const res = await db.execute<{ at: Date | null }>(sql`SELECT max(created_at) AS at FROM order_events WHERE order_id = ${orderId}::uuid AND status = 'delivered'`);
    const at = res.rows[0]?.at;
    return at ? new Date(at) : null;
  }

  /**
   * The only place a return changes status: row locked, actor scope and transition checked against the
   * current status, event and audit written in the same transaction; notifications follow the commit.
   */
  private async move(id: string, actor: Actor, to: ReturnStatus, patch: (locked: OrderReturnRow, tx: Tx) => Patch | Promise<Patch>): Promise<OrderReturn> {
    if (!UUID_RE.test(id)) throw returnNotFound();
    const { row, number } = await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(orderReturns).where(eq(orderReturns.id, id)).for('update').limit(1);
      const inScope = locked && (actor.kind === 'buyer' ? locked.requestedBy === actor.userId : actor.kind === 'org' ? locked.orgId === actor.orgId : true);
      if (!locked || !inScope) throw returnNotFound();
      const allowed: readonly ReturnStatus[] = RETURN_TRANSITIONS[actor.kind as ReturnActorKind][locked.status] ?? [];
      if (!allowed.includes(to)) throw AppError.conflict(`A return ${locked.status} cannot become ${to}`, { reason: 'invalid_transition', from: locked.status, to });
      const changes = await patch(locked, tx);
      const [updated] = await tx.update(orderReturns).set({ ...changes, status: to }).where(eq(orderReturns.id, id)).returning();
      await tx.insert(orderReturnEvents).values({ returnId: id, fromStatus: locked.status, status: to, actorKind: actor.kind, actorUserId: actor.userId });
      await this.audit.record(
        {
          action: 'commerce.return_status_changed',
          actorUserId: actor.userId,
          subjectUserId: locked.requestedBy,
          meta: 'meta' in actor ? actor.meta : undefined,
          metadata: {
            orderId: locked.orderId,
            returnId: id,
            orgId: locked.orgId,
            from: locked.status,
            to,
            ...(to === 'refunded' || to === 'resolved' ? { refundMinor: updated!.refundMinor, refundedMinor: updated!.refundedMinor, resolution: updated!.resolution } : {}),
          },
        },
        tx,
      );
      const [order] = await tx.select({ number: orders.number }).from(orders).where(eq(orders.id, locked.orderId)).limit(1);
      return { row: updated!, number: order?.number ?? '' };
    });
    // After the commit: a notification failure never turns a recorded transition into a 500.
    await bestEffort(this.logger, 'return notification', async () => {
      if (actor.kind === 'buyer') await this.notifyOrg(row, number, actor.userId);
      else {
        await this.notifyBuyer(row, number, actor.userId);
        // A platform decision also tells the seller; a seller's own step needs no echo to the seller.
        if (actor.kind === 'admin') await this.notifyOrg(row, number, null);
      }
    });
    return (await hydrateReturns(this.db, [row]))[0]!;
  }

  /** Generic text only (never the reason, the details nor a note). Members blocked with the buyer are skipped. */
  private async notifyOrg(row: OrderReturnRow, number: string, buyerId: string | null): Promise<void> {
    const members = await this.db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, row.orgId), eq(orgMembers.status, 'active'), inArray(orgMembers.role, ROLES_MANAGING_ORDERS)));
    const ids = buyerId ? await this.notBlockedWith(buyerId, members.map((m) => m.userId)) : members.map((m) => m.userId);
    await this.notifications.notifyMany(
      ids.map((userId) => ({
        userId,
        category: 'commerce' as const,
        title: `Retour ${number}`,
        body: 'Un retour de commande demande votre attention.',
        data: { orgId: row.orgId, orderId: row.orderId, orderNumber: number, returnId: row.id, status: row.status },
      })),
    );
  }

  private async notifyBuyer(row: OrderReturnRow, number: string, actorId: string): Promise<void> {
    const [ok] = await this.notBlockedWith(actorId, [row.requestedBy]);
    if (!ok) return;
    await this.notifications.notify({
      userId: row.requestedBy,
      category: 'commerce',
      title: `Retour ${number}`,
      body: 'Votre retour de commande a évolué.',
      data: { orderId: row.orderId, orderNumber: number, returnId: row.id, status: row.status },
    });
  }

  /** `candidates` minus the users blocked with `userId` in either direction. */
  private async notBlockedWith(userId: string, candidates: string[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const list = sql`ARRAY[${sql.join(candidates.map((c) => sql`${c}`), sql`, `)}]::uuid[]`;
    const res = await this.db.execute<{ other: string }>(sql`
      SELECT (CASE WHEN blocker_id = ${userId}::uuid THEN blocked_id ELSE blocker_id END)::text AS other FROM user_blocks
      WHERE (blocker_id = ${userId}::uuid AND blocked_id = ANY(${list})) OR (blocked_id = ${userId}::uuid AND blocker_id = ANY(${list}))`);
    const blocked = new Set(res.rows.map((r) => r.other));
    return candidates.filter((c) => !blocked.has(c));
  }
}

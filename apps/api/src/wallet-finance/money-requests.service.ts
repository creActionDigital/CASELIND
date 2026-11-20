import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateMoneyRequest,
  ErrorCodes,
  MONEY_REQUESTS_PENDING_MAX,
  MONEY_REQUEST_TTL_DAYS,
  type MoneyRequest,
  type MoneyRequestList,
  type MoneyRequestListQuery,
  type PayMoneyRequest,
  type PayMoneyRequestResponse,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { WalletService } from '../ledger/wallet.service.js';
import { ContactsService } from '../messaging/contacts.service.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import { decodeCursor, encodeCursor, findReachableUser, formatAmount, iso, UUID_RE, validation } from './wallet-finance.shared.js';

type RequestRow = {
  id: string;
  requester_id: string;
  payer_id: string;
  amount_minor: string;
  currency: string;
  note: string | null;
  status: MoneyRequest['status'];
  expires_at: Date;
  created_at: Date;
  created_text: string;
  resolved_at: Date | null;
  paid_transfer_id: string | null;
  bill_id: string | null;
  bill_title: string | null;
  cp_id: string;
  cp_name: string;
  cp_handle: string;
};

const SELECT = (me: string) => sql`
  SELECT r.id, r.requester_id, r.payer_id, r.amount_minor::text, r.currency::text AS currency, r.note,
    CASE WHEN r.status = 'pending' AND r.expires_at <= now() THEN 'expired' ELSE r.status END AS status,
    r.expires_at, r.created_at, r.created_at::text AS created_text, r.resolved_at, r.paid_transfer_id, r.bill_id, b.title AS bill_title,
    u.id AS cp_id, u.display_name AS cp_name, u.handle::text AS cp_handle
  FROM money_requests r
  JOIN users u ON u.id = CASE WHEN r.requester_id = ${me}::uuid THEN r.payer_id ELSE r.requester_id END
  LEFT JOIN split_bills b ON b.id = r.bill_id`;

export function toRequest(me: string, r: RequestRow): MoneyRequest {
  return {
    mode: 'sandbox',
    id: r.id,
    direction: r.requester_id === me ? 'sent' : 'received',
    counterparty: { userId: r.cp_id, displayName: r.cp_name, handle: r.cp_handle },
    amountMinor: Number(r.amount_minor),
    currency: r.currency.trim(),
    note: r.note,
    status: r.status,
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at),
    resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
    paidTransferId: r.paid_transfer_id,
    billId: r.bill_id,
    billTitle: r.bill_title,
  };
}

/**
 * Money requests (test funds). Paying one runs the existing P2P transfer (PIN, KYC limits, freeze, idempotency, audit) from the
 * payer to the requester through WalletService.payInternal, with the request status flipped in the SAME transaction; the
 * idempotency key is derived from the request id, so a request can only ever be paid once.
 */
@Injectable()
export class MoneyRequestsService {
  private readonly logger = new Logger(MoneyRequestsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly wallet: WalletService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  assertCurrency(currency: string): void {
    if (!this.env.COMMERCE_CURRENCIES.includes(currency)) throw validation('currency', `supported currencies: ${this.env.COMMERCE_CURRENCIES.join(', ')}`);
  }

  async view(me: string, id: string, ex: DbExecutor = this.db): Promise<MoneyRequest> {
    const res = await ex.execute<RequestRow>(sql`${SELECT(me)} WHERE r.id = ${id}::uuid AND (r.requester_id = ${me}::uuid OR r.payer_id = ${me}::uuid)`);
    const row = res.rows[0];
    if (!row) throw AppError.notFound('Request not found');
    return toRequest(me, row);
  }

  async create(auth: AuthUser, body: CreateMoneyRequest, meta: RequestMeta, billId: string | null = null): Promise<{ request: MoneyRequest; created: boolean }> {
    this.assertCurrency(body.currency);
    const target = await findReachableUser(this.db, auth.userId, { handle: body.payerHandle, id: body.payerId });
    if (!target) throw AppError.notFound('User not found');
    if (target.id === auth.userId) throw new AppError(400, ErrorCodes.validationFailed, 'You cannot request money from yourself');
    await this.contacts.assertAllowed(auth.userId, target);
    const prior = await this.db.execute<{ id: string }>(sql`SELECT id FROM money_requests WHERE requester_id = ${auth.userId}::uuid AND client_id = ${body.clientId}::uuid`);
    if (prior.rows[0]) return { request: await this.view(auth.userId, prior.rows[0].id), created: false };
    const id = await this.db.transaction(async (tx) => {
      const newId = await this.insert(tx, auth.userId, target.id, body, billId);
      await this.audit.record(
        { action: 'wallet.request_created', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { requestId: newId, amountMinor: body.amountMinor, currency: body.currency, payerId: target.id } },
        tx,
      );
      return newId;
    });
    await bestEffort(this.logger, 'request notification', () => this.notifyRequested(id, auth.userId, target.id, body.amountMinor, body.currency));
    return { request: await this.view(auth.userId, id), created: true };
  }

  /** Inserts a pending request (cap of pending requests per requester enforced here). `tx` makes it part of a bigger operation. */
  async insert(
    tx: DbExecutor,
    requesterId: string,
    payerId: string,
    p: { clientId: string; amountMinor: number; currency: string; note?: string },
    billId: string | null,
    reserve = 1,
  ): Promise<string> {
    // Serialise the cap check per requester.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mreq:${requesterId}`}, 0))`);
    const pending = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM money_requests WHERE requester_id = ${requesterId}::uuid AND status = 'pending' AND expires_at > now()`);
    if (Number(pending.rows[0]?.n ?? 0) + reserve > MONEY_REQUESTS_PENDING_MAX) {
      throw AppError.conflict('Too many pending requests', { reason: 'pending_limit', max: MONEY_REQUESTS_PENDING_MAX });
    }
    const ins = await tx.execute<{ id: string }>(sql`
      INSERT INTO money_requests (requester_id, payer_id, client_id, amount_minor, currency, note, expires_at, bill_id)
      VALUES (${requesterId}::uuid, ${payerId}::uuid, ${p.clientId}::uuid, ${p.amountMinor}, ${p.currency}, ${p.note ?? null},
              now() + make_interval(days => ${MONEY_REQUEST_TTL_DAYS}), ${billId}::uuid)
      RETURNING id`);
    return ins.rows[0]!.id;
  }

  async list(me: string, q: MoneyRequestListQuery): Promise<MoneyRequestList> {
    const filters = [sql`(r.requester_id = ${me}::uuid OR r.payer_id = ${me}::uuid)`];
    if (q.direction === 'sent') filters.push(sql`r.requester_id = ${me}::uuid`);
    if (q.direction === 'received') filters.push(sql`r.payer_id = ${me}::uuid`);
    if (q.status === 'expired') filters.push(sql`(r.status = 'expired' OR (r.status = 'pending' AND r.expires_at <= now()))`);
    else if (q.status === 'pending') filters.push(sql`r.status = 'pending' AND r.expires_at > now()`);
    else if (q.status) filters.push(sql`r.status = ${q.status}`);
    if (q.cursor) {
      const [at, id] = decodeCursor(q.cursor);
      filters.push(sql`(r.created_at, r.id) < (${at}::timestamptz, ${id}::uuid)`);
    }
    const res = await this.db.execute<RequestRow>(sql`${SELECT(me)} WHERE ${sql.join(filters, sql` AND `)} ORDER BY r.created_at DESC, r.id DESC LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    return {
      mode: 'sandbox',
      items: page.map((r) => toRequest(me, r)),
      nextCursor: res.rows.length > q.limit ? encodeCursor(page.at(-1)!.created_text, page.at(-1)!.id) : null,
    };
  }

  async pay(auth: AuthUser, id: string, body: PayMoneyRequest, meta: RequestMeta): Promise<PayMoneyRequestResponse> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Request not found');
    const res = await this.db.execute<{ requester_id: string; payer_id: string; amount_minor: string; currency: string; note: string | null; status: string; live: boolean }>(sql`
      SELECT requester_id, payer_id, amount_minor::text, currency::text AS currency, note, status, expires_at > now() AS live
      FROM money_requests WHERE id = ${id}::uuid`);
    const r = res.rows[0];
    // Only the payer may see and pay it: anyone else gets the same 404.
    if (!r || r.payer_id !== auth.userId) throw AppError.notFound('Request not found');
    if (r.status === 'paid') return { mode: 'sandbox', replayed: true, request: await this.view(auth.userId, id) };
    if (r.status !== 'pending') throw AppError.conflict('This request is closed', { reason: 'request_closed', status: r.status });
    if (!r.live) throw AppError.conflict('This request has expired', { reason: 'request_expired' });

    const amountMinor = Number(r.amount_minor);
    const currency = r.currency.trim();
    const paid = await this.wallet.payInternal(
      auth,
      {
        to: { kind: 'user', userId: r.requester_id },
        amountMinor,
        currency,
        clientId: `mreq:${id}`,
        pin: body.pin,
        metadata: { ref: 'money_request', requestId: id, note: r.note ?? "Demande d'argent" },
      },
      meta,
      async (tx, transferId) => {
        const u = await tx.execute<{ bill_id: string | null }>(sql`
          UPDATE money_requests SET status = 'paid', paid_transfer_id = ${transferId}::uuid, resolved_at = now()
          WHERE id = ${id}::uuid AND status = 'pending' AND expires_at > now() RETURNING bill_id`);
        if (u.rows.length === 0) throw AppError.conflict('This request is no longer payable', { reason: 'request_closed' });
        const billId = u.rows[0]!.bill_id;
        if (billId) {
          await tx.execute(sql`UPDATE split_bill_shares SET status = 'paid', transfer_id = ${transferId}::uuid WHERE bill_id = ${billId}::uuid AND user_id = ${auth.userId}::uuid`);
          await tx.execute(sql`
            UPDATE split_bills SET status = 'settled'
            WHERE id = ${billId}::uuid AND status = 'open'
              AND NOT EXISTS (SELECT 1 FROM split_bill_shares WHERE bill_id = ${billId}::uuid AND status <> 'paid')`);
        }
      },
    );
    if (!paid.replayed) {
      await bestEffort(this.logger, 'request paid notification', () =>
        this.notifications.notify({
          userId: r.requester_id,
          category: 'payment',
          title: "Demande d'argent payée (mode test)",
          body: `Votre demande de ${formatAmount(amountMinor, currency)} a été payée`,
          data: { kind: 'money_request', requestId: id },
        }),
      );
    }
    return { mode: 'sandbox', replayed: paid.replayed, request: await this.view(auth.userId, id) };
  }

  decline(auth: AuthUser, id: string, meta: RequestMeta): Promise<MoneyRequest> {
    return this.close(auth, id, 'payer_id', 'declined', 'wallet.request_declined', meta);
  }

  cancel(auth: AuthUser, id: string, meta: RequestMeta): Promise<MoneyRequest> {
    return this.close(auth, id, 'requester_id', 'cancelled', 'wallet.request_cancelled', meta);
  }

  private async close(
    auth: AuthUser,
    id: string,
    column: 'payer_id' | 'requester_id',
    status: 'declined' | 'cancelled',
    action: 'wallet.request_declined' | 'wallet.request_cancelled',
    meta: RequestMeta,
  ): Promise<MoneyRequest> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Request not found');
    await this.db.transaction(async (tx) => {
      const col = sql.identifier(column);
      const u = await tx.execute<{ bill_id: string | null }>(sql`
        UPDATE money_requests SET status = ${status}, resolved_at = now()
        WHERE id = ${id}::uuid AND ${col} = ${auth.userId}::uuid AND status = 'pending' AND expires_at > now() RETURNING bill_id`);
      if (u.rows.length === 0) {
        const exists = await tx.execute<{ status: string }>(sql`SELECT status FROM money_requests WHERE id = ${id}::uuid AND ${col} = ${auth.userId}::uuid`);
        if (!exists.rows[0]) throw AppError.notFound('Request not found');
        throw AppError.conflict('This request is closed', { reason: 'request_closed', status: exists.rows[0].status });
      }
      const billId = u.rows[0]!.bill_id;
      if (billId && status === 'declined') {
        await tx.execute(sql`UPDATE split_bill_shares SET status = 'declined' WHERE bill_id = ${billId}::uuid AND user_id = ${auth.userId}::uuid`);
      }
      await this.audit.record({ action, actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { requestId: id } }, tx);
    });
    return this.view(auth.userId, id);
  }

  /** Maintenance: pending requests past their deadline become expired (they already read as expired before this runs). */
  async expireDue(): Promise<number> {
    const res = await this.db.execute(sql`UPDATE money_requests SET status = 'expired', resolved_at = now() WHERE status = 'pending' AND expires_at <= now()`);
    return res.rowCount ?? 0;
  }

  private async notifyRequested(requestId: string, requesterId: string, payerId: string, amountMinor: number, currency: string): Promise<void> {
    const s = await this.db.execute<{ display_name: string }>(sql`SELECT display_name FROM users WHERE id = ${requesterId}::uuid`);
    await this.notifications.notify({
      userId: payerId,
      category: 'payment',
      title: "Demande d'argent (mode test)",
      body: `${s.rows[0]?.display_name ?? 'Un utilisateur'} vous demande ${formatAmount(amountMinor, currency)}`,
      data: { kind: 'money_request', requestId },
    });
  }
}

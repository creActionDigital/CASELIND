import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type CreateSplitBill, ErrorCodes, type MoneyRequestListQuery, splitEqual, type SplitBill, type SplitBillList } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { ContactsService } from '../messaging/contacts.service.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import { MoneyRequestsService } from './money-requests.service.js';
import { decodeCursor, encodeCursor, findReachableUser, formatAmount, iso, UUID_RE, validation } from './wallet-finance.shared.js';

type BillRow = {
  id: string;
  title: string;
  total_minor: string;
  self_minor: string;
  currency: string;
  status: SplitBill['status'];
  created_at: Date;
  created_text: string;
};
type ShareRow = {
  bill_id: string;
  user_id: string;
  display_name: string;
  handle: string;
  amount_minor: string;
  status: 'pending' | 'paid' | 'declined';
  transfer_id: string | null;
  request_id: string | null;
};

/**
 * Split bills: the creator proposes shares; each participant gets a linked money request (money_requests.bill_id) that is
 * paid through the normal request flow. The bill is settled when every share is paid. Test funds only.
 */
@Injectable()
export class SplitBillsService {
  private readonly logger = new Logger(SplitBillsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly requests: MoneyRequestsService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(auth: AuthUser, body: CreateSplitBill, meta: RequestMeta): Promise<{ bill: SplitBill; created: boolean }> {
    this.requests.assertCurrency(body.currency);
    const prior = await this.db.execute<{ id: string }>(sql`SELECT id FROM split_bills WHERE creator_id = ${auth.userId}::uuid AND client_id = ${body.clientId}::uuid`);
    if (prior.rows[0]) return { bill: await this.view(auth.userId, prior.rows[0].id), created: false };

    const ids: string[] = [];
    for (const p of body.participants) {
      const u = await findReachableUser(this.db, auth.userId, { handle: p.handle, id: p.userId });
      if (!u) throw AppError.notFound('User not found');
      if (u.id === auth.userId) throw new AppError(400, ErrorCodes.validationFailed, 'You cannot add yourself as a participant');
      if (ids.includes(u.id)) throw validation('participants', 'duplicate participant');
      await this.contacts.assertAllowed(auth.userId, u);
      ids.push(u.id);
    }
    let amounts: number[];
    let selfMinor: number;
    if (body.split === 'equal') {
      const parts = splitEqual(body.totalMinor, ids.length + 1);
      if (parts.some((a) => a < 1)) throw validation('totalMinor', 'total too small for this number of participants');
      amounts = parts.slice(0, ids.length);
      selfMinor = parts[ids.length]!;
    } else {
      amounts = body.participants.map((p) => p.amountMinor!);
      const sum = amounts.reduce((a, b) => a + b, 0);
      if (sum > body.totalMinor) throw validation('participants', 'the shares exceed the total');
      selfMinor = body.totalMinor - sum;
    }

    const billId = await this.db.transaction(async (tx) => {
      const bill = await tx.execute<{ id: string }>(sql`
        INSERT INTO split_bills (creator_id, client_id, title, total_minor, self_minor, currency)
        VALUES (${auth.userId}::uuid, ${body.clientId}::uuid, ${body.title}, ${body.totalMinor}, ${selfMinor}, ${body.currency}) RETURNING id`);
      const id = bill.rows[0]!.id;
      for (let i = 0; i < ids.length; i++) {
        await tx.execute(sql`INSERT INTO split_bill_shares (bill_id, user_id, amount_minor) VALUES (${id}::uuid, ${ids[i]!}::uuid, ${amounts[i]!})`);
        await this.requests.insert(tx, auth.userId, ids[i]!, { clientId: randomUUID(), amountMinor: amounts[i]!, currency: body.currency, note: body.title.slice(0, 140) }, id);
      }
      await this.audit.record(
        { action: 'wallet.split_created', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { billId: id, totalMinor: body.totalMinor, currency: body.currency, participants: ids.length } },
        tx,
      );
      return id;
    });
    await bestEffort(this.logger, 'split notifications', async () => {
      const s = await this.db.execute<{ display_name: string }>(sql`SELECT display_name FROM users WHERE id = ${auth.userId}::uuid`);
      await this.notifications.notifyMany(
        ids.map((userId, i) => ({
          userId,
          category: 'payment' as const,
          title: 'Paiement partagé (mode test)',
          body: `${s.rows[0]?.display_name ?? 'Un utilisateur'} vous demande ${formatAmount(amounts[i]!, body.currency)} pour un paiement partagé`,
          data: { kind: 'split_bill', billId },
        })),
      );
    });
    return { bill: await this.view(auth.userId, billId), created: true };
  }

  async view(me: string, id: string): Promise<SplitBill> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Split bill not found');
    const res = await this.db.execute<BillRow>(sql`
      SELECT id, title, total_minor::text, self_minor::text, currency::text AS currency, status, created_at, created_at::text AS created_text
      FROM split_bills WHERE id = ${id}::uuid AND creator_id = ${me}::uuid`);
    if (!res.rows[0]) throw AppError.notFound('Split bill not found');
    return (await this.hydrate(res.rows))[0]!;
  }

  async list(me: string, q: Pick<MoneyRequestListQuery, 'limit' | 'cursor'>): Promise<SplitBillList> {
    const cur = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<BillRow>(sql`
      SELECT id, title, total_minor::text, self_minor::text, currency::text AS currency, status, created_at, created_at::text AS created_text
      FROM split_bills WHERE creator_id = ${me}::uuid ${cur ? sql`AND (created_at, id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : sql``}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    return {
      mode: 'sandbox',
      items: await this.hydrate(page),
      nextCursor: res.rows.length > q.limit ? encodeCursor(page.at(-1)!.created_text, page.at(-1)!.id) : null,
    };
  }

  /** Cancels the bill and every request still pending; shares already paid stay paid. */
  async cancel(auth: AuthUser, id: string, meta: RequestMeta): Promise<SplitBill> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Split bill not found');
    await this.db.transaction(async (tx) => {
      const b = await tx.execute<{ status: string }>(sql`SELECT status FROM split_bills WHERE id = ${id}::uuid AND creator_id = ${auth.userId}::uuid FOR UPDATE`);
      if (!b.rows[0]) throw AppError.notFound('Split bill not found');
      if (b.rows[0].status !== 'open') throw AppError.conflict('This split bill is closed', { reason: 'bill_closed', status: b.rows[0].status });
      await tx.execute(sql`UPDATE money_requests SET status = 'cancelled', resolved_at = now() WHERE bill_id = ${id}::uuid AND status = 'pending'`);
      await tx.execute(sql`UPDATE split_bills SET status = 'cancelled' WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'wallet.split_cancelled', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { billId: id } }, tx);
    });
    return this.view(auth.userId, id);
  }

  private async hydrate(bills: BillRow[]): Promise<SplitBill[]> {
    if (bills.length === 0) return [];
    const ids = sql.join(bills.map((b) => sql`${b.id}::uuid`), sql`, `);
    const shares = await this.db.execute<ShareRow>(sql`
      SELECT s.bill_id, s.user_id, u.display_name, u.handle::text AS handle, s.amount_minor::text, s.status, s.transfer_id,
        (SELECT r.id FROM money_requests r WHERE r.bill_id = s.bill_id AND r.payer_id = s.user_id LIMIT 1) AS request_id
      FROM split_bill_shares s JOIN users u ON u.id = s.user_id
      WHERE s.bill_id IN (${ids}) ORDER BY u.display_name, s.user_id`);
    return bills.map((b) => {
      const mine = shares.rows.filter((s) => s.bill_id === b.id);
      return {
        mode: 'sandbox' as const,
        id: b.id,
        title: b.title,
        totalMinor: Number(b.total_minor),
        selfMinor: Number(b.self_minor),
        currency: b.currency.trim(),
        status: b.status,
        createdAt: iso(b.created_at),
        paidMinor: mine.filter((s) => s.status === 'paid').reduce((a, s) => a + Number(s.amount_minor), 0),
        shares: mine.map((s) => ({
          user: { userId: s.user_id, displayName: s.display_name, handle: s.handle },
          amountMinor: Number(s.amount_minor),
          status: s.status,
          transferId: s.transfer_id,
          requestId: s.request_id,
        })),
      };
    });
  }
}

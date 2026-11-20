import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateScheduledPayment,
  ErrorCodes,
  type FinanceParty,
  type NextRuns,
  type NextRunsQuery,
  type PageQuery,
  SCHEDULED_ACTIVE_MAX,
  SCHEDULED_FAILURES_MAX,
  scheduledRunAt,
  type ScheduledPayment,
  type ScheduledPaymentDetail,
  type ScheduledPaymentList,
  upcomingRuns,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import { blockedBetween } from '../mobility-extra/extra.shared.js';
import { KycPort } from '../wallet/kyc.port.js';
import type { TransferInput } from '../wallet/ledger.port.js';
import { PinVerifier, pinRefusal } from '../wallet/pin.port.js';
import { AnomalyService } from './anomaly.service.js';
import { decodeCursor, encodeCursor, findReachableUser, formatAmount, iso, UUID_RE, validation } from './wallet-finance.shared.js';

const DAY_MS = 86_400_000;
/** A failed run is retried this long after (same run number), up to SCHEDULED_FAILURES_MAX consecutive failures. */
export const SCHEDULED_RETRY_MS = 6 * 3_600_000;
/** Payments handled per maintenance pass; the rest waits for the next pass. */
const RUN_BATCH = 200;

type PaymentRow = {
  id: string;
  owner_id: string;
  recipient_id: string;
  amount_minor: string;
  currency: string;
  note: string | null;
  frequency: 'once' | 'weekly' | 'monthly';
  first_run_at: Date;
  next_run_at: Date;
  ends_on: string | null;
  max_runs: number | null;
  runs_done: number;
  consecutive_failures: number;
  status: ScheduledPayment['status'];
  last_error: string | null;
  created_at: Date;
  created_text: string;
  rp_name: string;
  rp_handle: string;
};

const SELECT = sql`
  SELECT p.id, p.owner_id, p.recipient_id, p.amount_minor::text, p.currency::text AS currency, p.note, p.frequency, p.first_run_at, p.next_run_at,
    p.ends_on::text AS ends_on, p.max_runs, p.runs_done, p.consecutive_failures, p.status, p.last_error, p.created_at, p.created_at::text AS created_text,
    u.display_name AS rp_name, u.handle::text AS rp_handle
  FROM scheduled_payments p JOIN users u ON u.id = p.recipient_id`;

/**
 * Index of the first occurrence after `now`, from `fromIdx`: past occurrences (pause, outage) are skipped, never replayed in a burst.
 * shortcut: a one-off payment is never skipped, and the search stops after 5000 steps.
 */
export function nextFutureIndex(first: Date, frequency: 'once' | 'weekly' | 'monthly', fromIdx: number, now: Date): number {
  if (frequency === 'once') return fromIdx;
  let i = fromIdx;
  while (i < fromIdx + 5000 && scheduledRunAt(first, frequency, i).getTime() <= now.getTime()) i++;
  return i;
}

const toPayment = (r: PaymentRow): ScheduledPayment => ({
  mode: 'sandbox',
  id: r.id,
  recipient: { userId: r.recipient_id, displayName: r.rp_name, handle: r.rp_handle } satisfies FinanceParty,
  amountMinor: Number(r.amount_minor),
  currency: r.currency.trim(),
  note: r.note,
  frequency: r.frequency,
  nextRunAt: r.status === 'active' || r.status === 'paused' ? iso(r.next_run_at) : null,
  endsOn: r.ends_on,
  maxRuns: r.max_runs,
  runsDone: r.runs_done,
  status: r.status,
  lastError: r.last_error,
  createdAt: iso(r.created_at),
});

/**
 * Scheduled and recurring payments (test funds). The owner authorises them once with the PIN; the hourly maintenance then runs
 * the due ones through the ledger (KYC limits, freeze and balance still apply). A run is idempotent: the ledger key is
 * `sched:<payment>:<run number>`, the row is locked FOR UPDATE SKIP LOCKED and a successful run is unique per (payment, number),
 * so a double pass or two instances never pay twice. A failed run is retried after 6 hours; 3 consecutive failures stop the payment.
 */
@Injectable()
export class ScheduledPaymentsService {
  private readonly logger = new Logger(ScheduledPaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly ledger: LedgerService,
    private readonly kyc: KycPort,
    private readonly pins: PinVerifier,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly anomaly: AnomalyService,
  ) {}

  async create(auth: AuthUser, body: CreateScheduledPayment, meta: RequestMeta): Promise<{ payment: ScheduledPayment; created: boolean }> {
    if (!this.env.COMMERCE_CURRENCIES.includes(body.currency)) throw validation('currency', `supported currencies: ${this.env.COMMERCE_CURRENCIES.join(', ')}`);
    const prior = await this.db.execute<{ id: string }>(sql`SELECT id FROM scheduled_payments WHERE owner_id = ${auth.userId}::uuid AND client_id = ${body.clientId}::uuid`);
    if (prior.rows[0]) return { payment: await this.view(auth.userId, prior.rows[0].id), created: false };

    const recipient = await findReachableUser(this.db, auth.userId, { handle: body.recipientHandle, id: body.recipientId });
    if (!recipient) throw AppError.notFound('Recipient not found');
    if (recipient.id === auth.userId) throw new AppError(400, ErrorCodes.validationFailed, 'You cannot send money to yourself');
    const first = new Date(body.firstRunAt);
    const now = Date.now();
    if (first.getTime() < now - 60_000 || first.getTime() > now + 366 * DAY_MS) throw validation('firstRunAt', 'must be within the next year');
    if (body.endsOn && first.toISOString().slice(0, 10) > body.endsOn) throw validation('endsOn', 'must not be before the first run');
    const limits = await this.kyc.limitsFor(auth.userId, body.currency);
    if (body.amountMinor > limits.maxSingleTransferMinor) throw validation('amountMinor', `at most ${limits.maxSingleTransferMinor} per run (your transfer limit)`);

    const pin = await this.pins.verify(auth.userId, body.pin);
    const refusal = pinRefusal(pin);
    if (refusal) throw refusal;

    const id = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sched:${auth.userId}`}, 0))`);
      const n = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM scheduled_payments WHERE owner_id = ${auth.userId}::uuid AND status IN ('active', 'paused')`);
      if (Number(n.rows[0]?.n ?? 0) >= SCHEDULED_ACTIVE_MAX) throw AppError.conflict('Too many scheduled payments', { reason: 'scheduled_limit', max: SCHEDULED_ACTIVE_MAX });
      const ins = await tx.execute<{ id: string }>(sql`
        INSERT INTO scheduled_payments (owner_id, recipient_id, client_id, amount_minor, currency, note, frequency, first_run_at, next_run_at, ends_on, max_runs)
        VALUES (${auth.userId}::uuid, ${recipient.id}::uuid, ${body.clientId}::uuid, ${body.amountMinor}, ${body.currency}, ${body.note ?? null}, ${body.frequency},
                ${first.toISOString()}::timestamptz, ${first.toISOString()}::timestamptz, ${body.endsOn ?? null}::date, ${body.frequency === 'once' ? 1 : (body.maxRuns ?? null)})
        RETURNING id`);
      const newId = ins.rows[0]!.id;
      await this.audit.record(
        { action: 'wallet.scheduled_created', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { paymentId: newId, amountMinor: body.amountMinor, currency: body.currency, frequency: body.frequency, recipientId: recipient.id } },
        tx,
      );
      return newId;
    });
    return { payment: await this.view(auth.userId, id), created: true };
  }

  async view(me: string, id: string): Promise<ScheduledPayment> {
    return toPayment(await this.row(me, id));
  }

  async detail(me: string, id: string): Promise<ScheduledPaymentDetail> {
    const p = toPayment(await this.row(me, id));
    const runs = await this.db.execute<{ run_number: number; status: 'ok' | 'failed'; error_code: string | null; transfer_id: string | null; ran_at: Date }>(sql`
      SELECT run_number, status, error_code, transfer_id, ran_at FROM scheduled_payment_runs WHERE payment_id = ${id}::uuid ORDER BY ran_at DESC, id DESC LIMIT 50`);
    return {
      ...p,
      runs: runs.rows.map((r) => ({ runNumber: r.run_number, status: r.status, errorCode: r.error_code, transferId: r.transfer_id, ranAt: iso(r.ran_at) })),
    };
  }

  async list(me: string, q: PageQuery): Promise<ScheduledPaymentList> {
    const cur = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<PaymentRow>(sql`
      ${SELECT} WHERE p.owner_id = ${me}::uuid ${cur ? sql`AND (p.created_at, p.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : sql``}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    return {
      mode: 'sandbox',
      items: page.map(toPayment),
      nextCursor: res.rows.length > q.limit ? encodeCursor(page.at(-1)!.created_text, page.at(-1)!.id) : null,
    };
  }

  async nextRuns(me: string, id: string, q: NextRunsQuery): Promise<NextRuns> {
    const r = await this.row(me, id);
    if (r.status !== 'active' && r.status !== 'paused') return { mode: 'sandbox', items: [] };
    const items = upcomingRuns({ first: new Date(r.first_run_at), frequency: r.frequency, runsDone: r.runs_done, maxRuns: r.max_runs, endsOn: r.ends_on }, q.count);
    return { mode: 'sandbox', items: items.map((d) => d.toISOString()) };
  }

  pause(auth: AuthUser, id: string, meta: RequestMeta): Promise<ScheduledPayment> {
    return this.setStatus(auth, id, 'paused', ['active'], 'wallet.scheduled_paused', meta);
  }

  resume(auth: AuthUser, id: string, meta: RequestMeta): Promise<ScheduledPayment> {
    return this.setStatus(auth, id, 'active', ['paused'], 'wallet.scheduled_resumed', meta);
  }

  cancel(auth: AuthUser, id: string, meta: RequestMeta): Promise<ScheduledPayment> {
    return this.setStatus(auth, id, 'cancelled', ['active', 'paused'], 'wallet.scheduled_cancelled', meta);
  }

  private async setStatus(
    auth: AuthUser,
    id: string,
    status: 'active' | 'paused' | 'cancelled',
    from: string[],
    action: 'wallet.scheduled_paused' | 'wallet.scheduled_resumed' | 'wallet.scheduled_cancelled',
    meta: RequestMeta,
  ): Promise<ScheduledPayment> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Scheduled payment not found');
    await this.db.transaction(async (tx) => {
      const cur = await tx.execute<{ status: string; frequency: 'once' | 'weekly' | 'monthly'; first_run_at: Date; next_run_at: Date; runs_done: number; max_runs: number | null; ends_on: string | null }>(sql`
        SELECT status, frequency, first_run_at, next_run_at, runs_done, max_runs, ends_on::text AS ends_on FROM scheduled_payments
        WHERE id = ${id}::uuid AND owner_id = ${auth.userId}::uuid FOR UPDATE`);
      const c = cur.rows[0];
      if (!c) throw AppError.notFound('Scheduled payment not found');
      if (!from.includes(c.status)) throw AppError.conflict('This scheduled payment cannot be changed that way', { reason: 'scheduled_state', status: c.status });
      let final: string = status;
      let nextAt = new Date(c.next_run_at);
      let done = c.runs_done;
      // Resuming skips the occurrences missed while paused: never a burst of back payments.
      if (status === 'active' && c.frequency !== 'once' && nextAt.getTime() <= Date.now()) {
        done = nextFutureIndex(new Date(c.first_run_at), c.frequency, c.runs_done, new Date());
        nextAt = scheduledRunAt(new Date(c.first_run_at), c.frequency, done);
        if ((c.max_runs !== null && done >= c.max_runs) || (c.ends_on !== null && nextAt.toISOString().slice(0, 10) > c.ends_on)) final = 'completed';
      }
      await tx.execute(sql`UPDATE scheduled_payments SET status = ${final}, consecutive_failures = 0, runs_done = ${done}, next_run_at = ${nextAt.toISOString()}::timestamptz WHERE id = ${id}::uuid`);
      await this.audit.record({ action, actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { paymentId: id } }, tx);
    });
    return this.view(auth.userId, id);
  }

  private async row(me: string, id: string): Promise<PaymentRow> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Scheduled payment not found');
    const res = await this.db.execute<PaymentRow>(sql`${SELECT} WHERE p.id = ${id}::uuid AND p.owner_id = ${me}::uuid`);
    if (!res.rows[0]) throw AppError.notFound('Scheduled payment not found');
    return res.rows[0];
  }

  /** Maintenance entry point: runs what is due. Resilient (one failing payment never stops the others) and never throws. */
  async runDue(now: Date = new Date()): Promise<{ ok: number; failed: number }> {
    const tally = { ok: 0, failed: 0 };
    try {
      const due = await this.db.execute<{ id: string }>(sql`
        SELECT id FROM scheduled_payments WHERE status = 'active' AND next_run_at <= ${now.toISOString()}::timestamptz ORDER BY next_run_at, id LIMIT ${RUN_BATCH}`);
      for (const { id } of due.rows) {
        try {
          const r = await this.runOne(id, now);
          if (r) tally[r]++;
        } catch (err) {
          // shortcut: a payment that keeps throwing is retried every pass and only logged; upgrade to a failure counter if it ever happens.
          this.logger.error(`scheduled payment run failed: ${(err as Error).name}`);
        }
      }
    } catch (err) {
      this.logger.error(`scheduled payments pass failed: ${(err as Error).name}`);
    }
    return tally;
  }

  private async runOne(id: string, now: Date): Promise<'ok' | 'failed' | null> {
    const peek = await this.db.execute<{ owner_id: string; recipient_id: string; amount_minor: string; currency: string; note: string | null; runs_done: number }>(sql`
      SELECT owner_id, recipient_id, amount_minor::text, currency::text AS currency, note, runs_done FROM scheduled_payments
      WHERE id = ${id}::uuid AND status = 'active' AND next_run_at <= ${now.toISOString()}::timestamptz`);
    const p = peek.rows[0];
    if (!p) return null;
    const runNumber = p.runs_done + 1;
    const currency = p.currency.trim();
    const input: TransferInput = {
      from: { kind: 'user', userId: p.owner_id },
      to: { kind: 'user', userId: p.recipient_id },
      amountMinor: Number(p.amount_minor),
      currency,
      kind: 'p2p',
      idempotencyKey: `sched:${id}:${runNumber}`,
      initiatedBy: p.owner_id,
      metadata: { ref: 'scheduled', paymentId: id, note: p.note ?? 'Paiement programmé' },
    };
    // Limits are read before the transaction opens (see LedgerService.prefetchLimits).
    const limits = await this.ledger.prefetchLimits(input);
    const outcome = await this.db.transaction(async (tx) => {
      const l = await tx.execute<{ frequency: 'once' | 'weekly' | 'monthly'; first_run_at: Date; ends_on: string | null; max_runs: number | null; runs_done: number; consecutive_failures: number }>(sql`
        SELECT frequency, first_run_at, ends_on::text AS ends_on, max_runs, runs_done, consecutive_failures FROM scheduled_payments
        WHERE id = ${id}::uuid AND status = 'active' AND next_run_at <= ${now.toISOString()}::timestamptz FOR UPDATE SKIP LOCKED`);
      const row = l.rows[0];
      if (!row || row.runs_done + 1 !== runNumber) return null;
      // The block may have appeared since the payment was authorised: a failed run, no debit.
      const r = (await blockedBetween(tx, p.owner_id, p.recipient_id)) ? ({ ok: false, reason: 'invalid_counterparty' } as const) : await this.ledger.transferWith(input, limits, tx);
      if (r.ok) {
        await tx.execute(sql`
          INSERT INTO scheduled_payment_runs (payment_id, run_number, status, transfer_id) VALUES (${id}::uuid, ${runNumber}, 'ok', ${r.transferId}::uuid)
          ON CONFLICT (payment_id, run_number) WHERE status = 'ok' DO NOTHING`);
        // Missed occurrences are skipped (at most one debit per pass, never a catch-up burst).
        const idx = nextFutureIndex(new Date(row.first_run_at), row.frequency, runNumber, now);
        const nextAt = scheduledRunAt(new Date(row.first_run_at), row.frequency, idx);
        const done =
          row.frequency === 'once' || (row.max_runs !== null && idx >= row.max_runs) || (row.ends_on !== null && nextAt.toISOString().slice(0, 10) > row.ends_on);
        await tx.execute(sql`
          UPDATE scheduled_payments SET runs_done = ${idx}, consecutive_failures = 0, last_error = NULL,
            status = ${done ? 'completed' : 'active'}, next_run_at = ${(done ? new Date(row.first_run_at) : nextAt).toISOString()}::timestamptz
          WHERE id = ${id}::uuid`);
        await this.audit.record(
          {
            action: 'wallet.scheduled_run',
            actorUserId: p.owner_id,
            metadata: { paymentId: id, runNumber, transferId: r.transferId, amountMinor: input.amountMinor, currency, counterpartyId: p.recipient_id },
          },
          tx,
        );
        return { ok: true as const, replayed: r.replayed, transferId: r.transferId };
      }
      const failures = row.consecutive_failures + 1;
      const stop = failures >= SCHEDULED_FAILURES_MAX;
      await tx.execute(sql`INSERT INTO scheduled_payment_runs (payment_id, run_number, status, error_code) VALUES (${id}::uuid, ${runNumber}, 'failed', ${r.reason})`);
      await tx.execute(sql`
        UPDATE scheduled_payments SET consecutive_failures = ${failures}, last_error = ${r.reason}, status = ${stop ? 'failed' : 'active'},
          next_run_at = ${new Date(now.getTime() + SCHEDULED_RETRY_MS).toISOString()}::timestamptz
        WHERE id = ${id}::uuid`);
      return { ok: false as const, stop };
    });
    if (!outcome) return null;
    if (outcome.ok) {
      if (!outcome.replayed) {
        await bestEffort(this.logger, 'scheduled received notification', () =>
          this.notifications.notify({
            userId: p.recipient_id,
            category: 'payment',
            title: 'Paiement programmé reçu (mode test)',
            body: `Vous avez reçu ${formatAmount(input.amountMinor, currency)} (paiement programmé)`,
            data: { kind: 'scheduled_payment', transferId: outcome.transferId },
          }),
        );
        await this.anomaly.afterTransfer(p.owner_id, outcome.transferId, currency);
      }
      return 'ok';
    }
    await bestEffort(this.logger, 'scheduled failure notification', () =>
      this.notifications.notify({
        userId: p.owner_id,
        category: 'payment',
        title: outcome.stop ? 'Paiement programmé arrêté (mode test)' : 'Paiement programmé en échec (mode test)',
        body: outcome.stop
          ? 'Un de vos paiements programmés a été arrêté après plusieurs échecs. Vérifiez votre solde.'
          : 'Un de vos paiements programmés n’a pas pu être exécuté. Une nouvelle tentative aura lieu plus tard.',
        data: { kind: 'scheduled_payment', paymentId: id },
      }),
    );
    return 'failed';
  }
}

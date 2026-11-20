import { Inject, Injectable, Logger } from '@nestjs/common';
import { type CreateSavingsGoal, type SavingsGoal, type SavingsGoalList, type SavingsMove, type SavingsMoveResponse } from '@caselind/contracts';
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
import type { LedgerOwner, TransferInput } from '../wallet/ledger.port.js';
import { PinVerifier, pinRefusal } from '../wallet/pin.port.js';
import { iso, transferRefusal, UUID_RE, validation } from './wallet-finance.shared.js';

export const SAVINGS_GOALS_MAX = 20;
const REMIND_DAYS = 14;

type GoalRow = {
  id: string;
  user_id: string;
  title: string;
  target_minor: string;
  currency: string;
  deadline: string | null;
  archived: boolean;
  created_at: Date;
  saved: string;
};

const SELECT = sql`
  SELECT g.id, g.user_id, g.title, g.target_minor::text, g.currency::text AS currency, g.deadline::text AS deadline, g.archived, g.created_at,
    COALESCE((SELECT SUM(CASE m.kind WHEN 'deposit' THEN m.amount_minor ELSE -m.amount_minor END) FROM savings_movements m WHERE m.goal_id = g.id), 0)::text AS saved
  FROM savings_goals g`;

const toGoal = (r: GoalRow): SavingsGoal => {
  const saved = Number(r.saved);
  const target = Number(r.target_minor);
  return {
    mode: 'sandbox',
    id: r.id,
    title: r.title,
    targetMinor: target,
    currency: r.currency.trim(),
    savedMinor: saved,
    progressPercent: Math.max(0, Math.min(100, Math.floor((saved * 100) / target))),
    deadline: r.deadline,
    archived: r.archived,
    createdAt: iso(r.created_at),
  };
};

/** The user's savings pool in a currency: a system ledger account `savings:<userId>` (one per user and currency). */
const poolOf = (userId: string): LedgerOwner => ({ kind: 'system', code: `savings:${userId}` });

/**
 * Savings goals (tirelires), test funds. Deposits and withdrawals are INTERNAL ledger entries (kind 'adjustment',
 * metadata.ref = 'savings') between the user's current account and a dedicated savings account; they are not spending
 * (the personal-finance summary ignores 'adjustment'). The goal balance is computed from savings_movements.
 */
@Injectable()
export class SavingsService {
  private readonly logger = new Logger(SavingsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly ledger: LedgerService,
    private readonly pins: PinVerifier,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(auth: AuthUser, body: CreateSavingsGoal, meta: RequestMeta): Promise<SavingsGoal> {
    if (!this.env.COMMERCE_CURRENCIES.includes(body.currency)) throw validation('currency', `supported currencies: ${this.env.COMMERCE_CURRENCIES.join(', ')}`);
    if (body.deadline && body.deadline < new Date().toISOString().slice(0, 10)) throw validation('deadline', 'must not be in the past');
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sav:${auth.userId}`}, 0))`);
      const n = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM savings_goals WHERE user_id = ${auth.userId}::uuid AND NOT archived`);
      if (Number(n.rows[0]?.n ?? 0) >= SAVINGS_GOALS_MAX) throw AppError.conflict('Too many savings goals', { reason: 'savings_limit', max: SAVINGS_GOALS_MAX });
      const ins = await tx.execute<{ id: string }>(sql`
        INSERT INTO savings_goals (user_id, title, target_minor, currency, deadline)
        VALUES (${auth.userId}::uuid, ${body.title}, ${body.targetMinor}, ${body.currency}, ${body.deadline ?? null}::date) RETURNING id`);
      await this.audit.record(
        { action: 'wallet.savings_created', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { goalId: ins.rows[0]!.id, targetMinor: body.targetMinor, currency: body.currency } },
        tx,
      );
      return ins.rows[0]!.id;
    });
    return this.view(auth.userId, id);
  }

  async view(me: string, id: string): Promise<SavingsGoal> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Savings goal not found');
    const res = await this.db.execute<GoalRow>(sql`${SELECT} WHERE g.id = ${id}::uuid AND g.user_id = ${me}::uuid`);
    if (!res.rows[0]) throw AppError.notFound('Savings goal not found');
    return toGoal(res.rows[0]);
  }

  async list(me: string): Promise<SavingsGoalList> {
    const res = await this.db.execute<GoalRow>(sql`${SELECT} WHERE g.user_id = ${me}::uuid ORDER BY g.archived, g.created_at DESC, g.id DESC LIMIT 100`);
    return { mode: 'sandbox', items: res.rows.map(toGoal) };
  }

  deposit(auth: AuthUser, id: string, body: SavingsMove, meta: RequestMeta): Promise<{ response: SavingsMoveResponse; created: boolean }> {
    return this.move(auth, id, body, 'deposit', meta);
  }

  withdraw(auth: AuthUser, id: string, body: SavingsMove, meta: RequestMeta): Promise<{ response: SavingsMoveResponse; created: boolean }> {
    return this.move(auth, id, body, 'withdraw', meta);
  }

  private async move(auth: AuthUser, id: string, body: SavingsMove, kind: 'deposit' | 'withdraw', meta: RequestMeta): Promise<{ response: SavingsMoveResponse; created: boolean }> {
    const goal = await this.view(auth.userId, id);
    if (goal.archived) throw AppError.conflict('This savings goal is archived', { reason: 'goal_archived' });
    const pin = await this.pins.verify(auth.userId, body.pin);
    const refusal = pinRefusal(pin);
    if (refusal) throw refusal;

    const user: LedgerOwner = { kind: 'user', userId: auth.userId };
    const input: TransferInput = {
      from: kind === 'deposit' ? user : poolOf(auth.userId),
      to: kind === 'deposit' ? poolOf(auth.userId) : user,
      amountMinor: body.amountMinor,
      currency: goal.currency,
      kind: 'adjustment',
      idempotencyKey: `sav:${body.clientId}`,
      initiatedBy: auth.userId,
      metadata: { ref: 'savings', note: `Tirelire : ${goal.title}` },
    };
    // Moving one's own money between one's own accounts: no sender limit; a withdrawal still respects the balance cap of the current account.
    const limits = kind === 'deposit' ? { sender: null, recipient: null } : await this.ledger.prefetchLimits(input);
    const replayed = await this.db.transaction(async (tx) => {
      const g = await tx.execute(sql`SELECT 1 FROM savings_goals WHERE id = ${id}::uuid AND user_id = ${auth.userId}::uuid AND NOT archived FOR UPDATE`);
      if (g.rows.length === 0) throw AppError.conflict('This savings goal is archived', { reason: 'goal_archived' });
      if (kind === 'withdraw') {
        const s = await tx.execute<{ saved: string }>(sql`
          SELECT COALESCE(SUM(CASE kind WHEN 'deposit' THEN amount_minor ELSE -amount_minor END), 0)::text AS saved FROM savings_movements WHERE goal_id = ${id}::uuid`);
        if (Number(s.rows[0]?.saved ?? 0) < body.amountMinor) {
          // A replay of an already processed withdrawal must still answer with the first result.
          const prior = await tx.execute(sql`SELECT 1 FROM journal_entries WHERE initiated_by = ${auth.userId}::uuid AND idempotency_key = ${input.idempotencyKey}`);
          if (prior.rows.length === 0) throw AppError.conflict('Not enough saved in this goal', { reason: 'goal_insufficient' });
        }
      }
      const r = await this.ledger.transferWith(input, limits, tx);
      if (!r.ok) throw transferRefusal(r);
      if (!r.replayed) {
        await tx.execute(sql`INSERT INTO savings_movements (goal_id, kind, amount_minor, transfer_id) VALUES (${id}::uuid, ${kind}, ${body.amountMinor}, ${r.transferId}::uuid)`);
        await this.audit.record(
          {
            action: kind === 'deposit' ? 'wallet.savings_deposit' : 'wallet.savings_withdraw',
            actorUserId: auth.userId,
            sessionId: auth.sessionId,
            meta,
            metadata: { goalId: id, transferId: r.transferId, amountMinor: body.amountMinor, currency: goal.currency },
          },
          tx,
        );
      }
      return r.replayed;
    });
    return {
      created: !replayed,
      response: { mode: 'sandbox', replayed, goal: await this.view(auth.userId, id), balanceMinor: await this.ledger.balance(user, goal.currency) },
    };
  }

  /** Archiving hides the goal; it needs an empty goal so no fund is left in a hidden place. */
  async archive(auth: AuthUser, id: string, meta: RequestMeta): Promise<SavingsGoal> {
    const goal = await this.view(auth.userId, id);
    if (goal.savedMinor > 0) throw AppError.conflict('Withdraw the savings first', { reason: 'withdraw_first' });
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE savings_goals SET archived = true WHERE id = ${id}::uuid AND user_id = ${auth.userId}::uuid`);
      await this.audit.record({ action: 'wallet.savings_archived', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { goalId: id } }, tx);
    });
    return this.view(auth.userId, id);
  }

  /** Maintenance: at most one generic reminder per goal per week while the deadline is within 14 days and the target is not reached. */
  async remindDeadlines(): Promise<number> {
    const res = await this.db.execute<{ user_id: string }>(sql`
      UPDATE savings_goals g SET last_reminded_at = now()
      WHERE NOT g.archived AND g.deadline BETWEEN current_date AND current_date + ${REMIND_DAYS}::int
        AND (g.last_reminded_at IS NULL OR g.last_reminded_at < now() - interval '7 days')
        AND g.target_minor > COALESCE((SELECT SUM(CASE m.kind WHEN 'deposit' THEN m.amount_minor ELSE -m.amount_minor END) FROM savings_movements m WHERE m.goal_id = g.id), 0)
      RETURNING g.user_id`);
    await bestEffort(this.logger, 'savings reminders', () =>
      this.notifications.notifyMany(
        res.rows.map((r) => ({
          userId: r.user_id,
          category: 'reminder' as const,
          title: 'Tirelire : date limite proche (mode test)',
          body: "L'une de vos tirelires approche de sa date limite sans avoir atteint son objectif.",
          data: { kind: 'savings_reminder' },
        })),
      ),
    );
    return res.rows.length;
  }
}

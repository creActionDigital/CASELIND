import { Inject, Injectable } from '@nestjs/common';
import { ErrorCodes, type Budget, type FinanceCurrencySummary, type FinanceSummary, type SetBudgetRequest } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';

type SpendingKind = FinanceCurrencySummary['byKind'][number]['kind'];

/** Personal finance on the sandbox wallet: a monthly budget per currency and the month's spending read from the ledger. */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  async setBudget(userId: string, body: SetBudgetRequest, meta: RequestMeta): Promise<Budget> {
    this.assertCurrency(body.currency);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO budgets (user_id, currency, limit_minor) VALUES (${userId}::uuid, ${body.currency}, ${body.limitMinor})
        ON CONFLICT (user_id, currency) DO UPDATE SET limit_minor = EXCLUDED.limit_minor, updated_at = now()`);
      await this.audit.record({ action: 'finance.budget_set', actorUserId: userId, meta, metadata: { currency: body.currency, limitMinor: body.limitMinor } }, tx);
    });
    return { mode: 'sandbox', currency: body.currency, limitMinor: body.limitMinor };
  }

  async removeBudget(userId: string, currency: string, meta: RequestMeta): Promise<void> {
    this.assertCurrency(currency);
    await this.db.transaction(async (tx) => {
      const del = await tx.execute(sql`DELETE FROM budgets WHERE user_id = ${userId}::uuid AND currency = ${currency}`);
      if ((del.rowCount ?? 0) > 0) await this.audit.record({ action: 'finance.budget_removed', actorUserId: userId, meta, metadata: { currency } }, tx);
    });
  }

  /** Money out and in for one UTC month, per currency the user budgets or moved. Top-ups and adjustments are not spending. */
  async summary(userId: string, month: string | undefined): Promise<FinanceSummary> {
    const m = month ?? new Date().toISOString().slice(0, 7);
    const start = `${m}-01T00:00:00Z`;
    const rows = await this.db.execute<{ currency: string; kind: string; spent: string; received: string }>(sql`
      SELECT p.currency, e.kind,
        COALESCE(-SUM(p.amount_minor) FILTER (WHERE p.amount_minor < 0), 0) AS spent,
        COALESCE(SUM(p.amount_minor) FILTER (WHERE p.amount_minor > 0), 0) AS received
      FROM postings p
      JOIN ledger_accounts a ON a.id = p.account_id AND a.owner_kind = 'user' AND a.user_id = ${userId}::uuid
      JOIN journal_entries e ON e.id = p.entry_id
      WHERE e.kind IN ('p2p', 'merchant_payment', 'refund')
        AND p.created_at >= ${start}::timestamptz AND p.created_at < (${start}::timestamptz + interval '1 month')
      GROUP BY p.currency, e.kind`);
    const budgets = await this.db.execute<{ currency: string; limit_minor: string }>(sql`
      SELECT currency, limit_minor FROM budgets WHERE user_id = ${userId}::uuid`);
    const limits = new Map(budgets.rows.map((b) => [b.currency, Number(b.limit_minor)]));
    const byCurrency = new Map<string, FinanceCurrencySummary>();
    const get = (currency: string): FinanceCurrencySummary => {
      let s = byCurrency.get(currency);
      if (!s) {
        s = { currency, spentMinor: 0, receivedMinor: 0, byKind: [], budgetMinor: limits.get(currency) ?? null, remainingMinor: null, usedPercent: null };
        byCurrency.set(currency, s);
      }
      return s;
    };
    for (const c of limits.keys()) get(c);
    for (const r of rows.rows) {
      const s = get(r.currency);
      const spent = Number(r.spent);
      const received = Number(r.received);
      if (r.kind === 'refund') {
        s.spentMinor -= received; // money given back lowers net spending; it is not income
      } else {
        s.receivedMinor += received;
        s.spentMinor += spent;
        if (spent > 0) s.byKind.push({ kind: r.kind as SpendingKind, spentMinor: spent });
      }
    }
    for (const s of byCurrency.values()) {
      s.spentMinor = Math.max(0, s.spentMinor);
      if (s.budgetMinor !== null) {
        s.remainingMinor = s.budgetMinor - s.spentMinor;
        s.usedPercent = Math.round((s.spentMinor * 100) / s.budgetMinor);
      }
      s.byKind.sort((a, b) => b.spentMinor - a.spentMinor);
    }
    return { mode: 'sandbox', month: m, items: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)) };
  }

  private assertCurrency(currency: string): void {
    if (!this.env.COMMERCE_CURRENCIES.includes(currency)) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
        { path: 'currency', message: `supported currencies: ${this.env.COMMERCE_CURRENCIES.join(', ')}` },
      ]);
    }
  }
}

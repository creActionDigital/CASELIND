import { ErrorCodes, type LedgerReconciliation, type WalletBalance, type WalletCounterparty, type WalletTransaction } from '@caselind/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { Db } from '../db/db.module.js';
import type { DbExecutor } from '../commerce/catalog.port.js';

export type WalletScope = { userId: string } | { orgId: string };

const scopeSql = (s: WalletScope): SQL => ('userId' in s ? sql`a.user_id = ${s.userId}::uuid` : sql`a.org_id = ${s.orgId}::uuid`);

/** Balances of the owner for each supported currency (0 when the account does not exist yet). */
export async function balancesOf(ex: DbExecutor, scope: WalletScope, currencies: string[]): Promise<WalletBalance[]> {
  const res = await ex.execute<{ currency: string; balance_minor: string; status: 'active' | 'frozen' }>(sql`
    SELECT a.currency::text AS currency, a.balance_minor::text, a.status FROM ledger_accounts a WHERE ${scopeSql(scope)}`);
  const byCurrency = new Map(res.rows.map((r) => [r.currency.trim(), r]));
  const wanted = [...new Set([...currencies, ...byCurrency.keys()])];
  return wanted.map((currency) => {
    const r = byCurrency.get(currency);
    return { currency, balanceMinor: Number(r?.balance_minor ?? 0), status: r?.status ?? 'active' };
  });
}

function encodeCursor(id: number): string {
  return Buffer.from(String(id), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): number {
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'cursor', message: 'invalid cursor' }]);
  }
  return n;
}

type TxRow = {
  id: number;
  entry_id: string;
  kind: WalletTransaction['kind'];
  metadata: Record<string, string>;
  created_at: Date;
  amount_minor: string;
  currency: string;
  cp_user_id: string | null;
  cp_display_name: string | null;
  cp_handle: string | null;
  cp_org_id: string | null;
  cp_org_name: string | null;
  cp_org_slug: string | null;
  cp_system_code: string | null;
}

function counterpartyOf(r: TxRow): WalletCounterparty | null {
  if (r.cp_user_id) return { kind: 'user', userId: r.cp_user_id, displayName: r.cp_display_name ?? '', handle: r.cp_handle ?? '' };
  if (r.cp_org_id) return { kind: 'org', orgId: r.cp_org_id, name: r.cp_org_name ?? '', slug: r.cp_org_slug ?? '' };
  if (r.cp_system_code) return { kind: 'system', label: 'CASELIND Sandbox' };
  return null;
}

/**
 * History of an owner's accounts, newest first. The counterparty exposes only a display name and @handle (or an
 * organisation name): nothing else about the other user ever leaves this query.
 */
export async function transactionsOf(
  ex: DbExecutor,
  scope: WalletScope,
  q: { currency?: string; cursor?: string; limit: number },
): Promise<{ items: WalletTransaction[]; nextCursor: string | null }> {
  const filters: SQL[] = [scopeSql(scope)];
  if (q.currency) filters.push(sql`p.currency = ${q.currency}`);
  if (q.cursor) filters.push(sql`p.id < ${decodeCursor(q.cursor)}`);
  const res = await ex.execute<TxRow>(sql`
    SELECT p.id, e.id AS entry_id, e.kind, e.metadata, e.created_at, p.amount_minor::text, p.currency::text AS currency,
           u.id AS cp_user_id, u.display_name AS cp_display_name, u.handle::text AS cp_handle,
           o.id AS cp_org_id, o.name AS cp_org_name, o.slug::text AS cp_org_slug, ca.system_code AS cp_system_code
    FROM postings p
    JOIN ledger_accounts a ON a.id = p.account_id
    JOIN journal_entries e ON e.id = p.entry_id
    LEFT JOIN LATERAL (
      SELECT cp.account_id FROM postings cp WHERE cp.entry_id = e.id AND cp.account_id <> p.account_id ORDER BY cp.id LIMIT 1
    ) cpp ON true
    LEFT JOIN ledger_accounts ca ON ca.id = cpp.account_id
    LEFT JOIN users u ON u.id = ca.user_id
    LEFT JOIN organizations o ON o.id = ca.org_id
    WHERE ${sql.join(filters, sql` AND `)}
    ORDER BY p.id DESC
    LIMIT ${q.limit + 1}`);
  const page = res.rows.slice(0, q.limit);
  const items = page.map((r): WalletTransaction => {
    const amount = Number(r.amount_minor);
    const note = r.metadata?.note;
    return {
      id: r.entry_id,
      kind: r.kind,
      direction: amount > 0 ? 'in' : 'out',
      amountMinor: Math.abs(amount),
      currency: r.currency.trim(),
      counterparty: counterpartyOf(r),
      note: typeof note === 'string' ? note : null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
  return { items, nextCursor: res.rows.length > q.limit ? encodeCursor(page.at(-1)!.id) : null };
}

/**
 * Compares every cached balance with the sum of its postings, and the sum of all postings per currency (must be
 * 0). One repeatable-read snapshot, so concurrent transfers cannot produce a false alarm.
 */
export async function reconcile(db: Db): Promise<LedgerReconciliation> {
  return db.transaction(
    async (tx) => {
      const count = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM ledger_accounts`);
      const div = await tx.execute<{ id: string; currency: string; cached: string; ledger: string }>(sql`
        SELECT a.id, a.currency::text AS currency, a.balance_minor::text AS cached, COALESCE(s.total, 0)::text AS ledger
        FROM ledger_accounts a
        LEFT JOIN (SELECT account_id, SUM(amount_minor) AS total FROM postings GROUP BY account_id) s ON s.account_id = a.id
        WHERE a.balance_minor <> COALESCE(s.total, 0)
        ORDER BY a.id`);
      const totals = await tx.execute<{ currency: string; total: string }>(sql`
        SELECT currency::text AS currency, SUM(amount_minor)::text AS total FROM postings GROUP BY currency ORDER BY currency`);
      const divergences = div.rows.map((r) => ({
        accountId: r.id,
        currency: r.currency.trim(),
        cachedMinor: Number(r.cached),
        ledgerMinor: Number(r.ledger),
      }));
      const currencyTotals = totals.rows.map((r) => ({ currency: r.currency.trim(), totalMinor: Number(r.total) }));
      return {
        mode: 'sandbox' as const,
        checkedAt: new Date().toISOString(),
        accountsChecked: Number(count.rows[0]?.n ?? 0),
        divergences,
        currencyTotals,
        ok: divergences.length === 0 && currencyTotals.every((t) => t.totalMinor === 0),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

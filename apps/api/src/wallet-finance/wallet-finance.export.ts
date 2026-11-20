import type { ExportedWalletFinance } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';

const iso = (d: Date | string): string => new Date(d).toISOString();

/** Right of access: the user's own money requests, split bills, scheduled payments, savings goals and anomaly alerts (test funds; no notes, no counterparty identity). */
export async function exportWalletFinance(db: Pick<Db, 'execute'>, userId: string): Promise<ExportedWalletFinance> {
  const [requests, bills, scheduled, goals, alerts] = await Promise.all([
    db.execute<{ id: string; sent: boolean; amount_minor: string; currency: string; status: string; created_at: Date }>(sql`
      SELECT id, (requester_id = ${userId}::uuid) AS sent, amount_minor::text, currency::text AS currency,
        CASE WHEN status = 'pending' AND expires_at <= now() THEN 'expired' ELSE status END AS status, created_at
      FROM money_requests WHERE requester_id = ${userId}::uuid OR payer_id = ${userId}::uuid ORDER BY created_at, id LIMIT 5000`),
    db.execute<{ id: string; title: string; total_minor: string; currency: string; status: string; participants: string; created_at: Date }>(sql`
      SELECT b.id, b.title, b.total_minor::text, b.currency::text AS currency, b.status, b.created_at,
        (SELECT count(*)::text FROM split_bill_shares s WHERE s.bill_id = b.id) AS participants
      FROM split_bills b WHERE b.creator_id = ${userId}::uuid ORDER BY b.created_at, b.id LIMIT 5000`),
    db.execute<{ id: string; amount_minor: string; currency: string; frequency: string; status: string; runs_done: number; created_at: Date }>(sql`
      SELECT id, amount_minor::text, currency::text AS currency, frequency, status, runs_done, created_at
      FROM scheduled_payments WHERE owner_id = ${userId}::uuid ORDER BY created_at, id LIMIT 5000`),
    db.execute<{ id: string; title: string; target_minor: string; saved: string; currency: string; deadline: string | null; archived: boolean; created_at: Date }>(sql`
      SELECT g.id, g.title, g.target_minor::text, g.currency::text AS currency, g.deadline::text AS deadline, g.archived, g.created_at,
        COALESCE((SELECT SUM(CASE m.kind WHEN 'deposit' THEN m.amount_minor ELSE -m.amount_minor END) FROM savings_movements m WHERE m.goal_id = g.id), 0)::text AS saved
      FROM savings_goals g WHERE g.user_id = ${userId}::uuid ORDER BY g.created_at, g.id LIMIT 5000`),
    db.execute<{ id: string; rule: string; severity: string; status: string; reported_at: Date | null; created_at: Date }>(sql`
      SELECT id, rule, severity, status, reported_at, created_at FROM wallet_alerts WHERE user_id = ${userId}::uuid ORDER BY created_at, id LIMIT 5000`),
  ]);
  return {
    mode: 'sandbox',
    moneyRequests: requests.rows.map((r) => ({
      id: r.id,
      direction: r.sent ? ('sent' as const) : ('received' as const),
      amountMinor: Number(r.amount_minor),
      currency: r.currency.trim(),
      status: r.status as ExportedWalletFinance['moneyRequests'][number]['status'],
      createdAt: iso(r.created_at),
    })),
    splitBills: bills.rows.map((b) => ({
      id: b.id,
      title: b.title,
      totalMinor: Number(b.total_minor),
      currency: b.currency.trim(),
      status: b.status as ExportedWalletFinance['splitBills'][number]['status'],
      participants: Number(b.participants),
      createdAt: iso(b.created_at),
    })),
    scheduledPayments: scheduled.rows.map((p) => ({
      id: p.id,
      amountMinor: Number(p.amount_minor),
      currency: p.currency.trim(),
      frequency: p.frequency as ExportedWalletFinance['scheduledPayments'][number]['frequency'],
      status: p.status as ExportedWalletFinance['scheduledPayments'][number]['status'],
      runsDone: p.runs_done,
      createdAt: iso(p.created_at),
    })),
    savingsGoals: goals.rows.map((g) => ({
      id: g.id,
      title: g.title,
      targetMinor: Number(g.target_minor),
      savedMinor: Number(g.saved),
      currency: g.currency.trim(),
      deadline: g.deadline,
      archived: g.archived,
      createdAt: iso(g.created_at),
    })),
    alerts: alerts.rows.map((a) => ({
      id: a.id,
      rule: a.rule as ExportedWalletFinance['alerts'][number]['rule'],
      severity: a.severity as ExportedWalletFinance['alerts'][number]['severity'],
      status: a.status as ExportedWalletFinance['alerts'][number]['status'],
      reported: a.reported_at !== null,
      createdAt: iso(a.created_at),
    })),
  };
}

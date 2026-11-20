import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WalletService } from '../src/ledger/wallet.service.js';
import { SavingsService } from '../src/wallet-finance/savings.service.js';
import { createTestContext, type TestContext } from './helpers.js';
import { financeKit, type FU } from './wallet-finance-helpers.js';

/** Savings goals (test funds): internal ledger entries between the current account and the user's savings account. */
let ctx: TestContext;
let k: ReturnType<typeof financeKit>;

beforeAll(async () => {
  ctx = await createTestContext();
  k = financeKit(ctx);
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const goal = (u: FU, over: Record<string, unknown> = {}) =>
  k.post(u, '/v1/wallet/savings', { title: 'Vacances', targetMinor: 10_000, currency: 'USD', ...over });
const move = (u: FU, id: string, kind: 'deposit' | 'withdraw', amountMinor: number, clientId = randomUUID()) =>
  k.post(u, `/v1/wallet/savings/${id}/${kind}`, { clientId, amountMinor, pin: '1234' });
const pool = async (u: FU): Promise<number> => {
  const r = await ctx.sql.query(`SELECT balance_minor::int AS b FROM ledger_accounts WHERE system_code = $1`, [`savings:${u.id}`]);
  return r.rows[0]?.b ?? 0;
};

describe('savings goals', () => {
  it('deposits and withdraws exact amounts, idempotently, and the ledger stays reconciled', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    await k.topup(a, 5000);
    const created = await goal(a, { deadline: '2099-01-01' }).expect(201);
    expect(created.body).toMatchObject({ mode: 'sandbox', title: 'Vacances', savedMinor: 0, progressPercent: 0, archived: false, deadline: '2099-01-01' });
    const id = created.body.id;

    const clientId = randomUUID();
    const dep = await move(a, id, 'deposit', 2000, clientId).expect(201);
    expect(dep.body).toMatchObject({ replayed: false, balanceMinor: 3000 });
    expect(dep.body.goal).toMatchObject({ savedMinor: 2000, progressPercent: 20 });
    const replay = await move(a, id, 'deposit', 2000, clientId).expect(200);
    expect(replay.body).toMatchObject({ replayed: true, balanceMinor: 3000 });
    expect(replay.body.goal.savedMinor).toBe(2000);

    expect(await k.balance(a)).toBe(3000);
    expect(await pool(a)).toBe(2000);
    expect((await move(a, id, 'withdraw', 500).expect(201)).body).toMatchObject({ balanceMinor: 3500 });
    expect(await pool(a)).toBe(1500);
    const listed = await k.get(a, '/v1/wallet/savings').expect(200);
    expect(listed.body.items[0]).toMatchObject({ id, savedMinor: 1500, progressPercent: 15 });

    expect(await ctx.app.get(WalletService).reconcile()).toMatchObject({ ok: true });
    // not a transfer: the history shows them as adjustments with a note, the savings account never counts as a wallet balance
    const wallet = await k.get(a, '/v1/wallet').expect(200);
    expect(wallet.body.balances.find((b: { currency: string }) => b.currency === 'USD').balanceMinor).toBe(3500);
    const tx = await k.get(a, '/v1/wallet/transactions').expect(200);
    expect(tx.body.items.some((t: { kind: string; note: string }) => t.kind === 'adjustment' && t.note?.startsWith('Tirelire'))).toBe(true);
  });

  it('refuses: too much, wrong PIN, frozen account, other users, archived goals', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 1000);
    const id = (await goal(a).expect(201)).body.id;

    const poor = await move(a, id, 'deposit', 1500).expect(409);
    expect(JSON.stringify(poor.body)).toContain('insufficient_funds');
    await move(a, id, 'deposit', 400).expect(201);
    const over = await move(a, id, 'withdraw', 401).expect(409);
    expect(JSON.stringify(over.body)).toContain('goal_insufficient');

    await k.get(b, '/v1/wallet/savings').expect(200);
    await move(b, id, 'deposit', 100).expect(404);
    await k.post(b, `/v1/wallet/savings/${id}/archive`).expect(404);

    k.pinWrong();
    await move(a, id, 'deposit', 100).expect(403);
    k.pinOk();
    await ctx.sql.query(`UPDATE ledger_accounts SET status = 'frozen' WHERE user_id = $1`, [a.id]);
    await move(a, id, 'deposit', 100).expect(403);
    await move(a, id, 'withdraw', 100).expect(403);
    await ctx.sql.query(`UPDATE ledger_accounts SET status = 'active' WHERE user_id = $1`, [a.id]);
    expect(await k.balance(a)).toBe(600);

    const archiveFull = await k.post(a, `/v1/wallet/savings/${id}/archive`).expect(409);
    expect(JSON.stringify(archiveFull.body)).toContain('withdraw_first');
    await move(a, id, 'withdraw', 400).expect(201);
    expect((await k.post(a, `/v1/wallet/savings/${id}/archive`).expect(200)).body.archived).toBe(true);
    await move(a, id, 'deposit', 100).expect(409);
    expect(await ctx.app.get(WalletService).reconcile()).toMatchObject({ ok: true });
  });

  it('validates the goal and caps open goals at 20', async () => {
    const a = await k.user();
    await goal(a, { currency: 'EUR' }).expect(400);
    await goal(a, { title: '' }).expect(400);
    await goal(a, { targetMinor: 0 }).expect(400);
    await goal(a, { deadline: '2001-01-01' }).expect(400);
    for (let i = 0; i < 20; i++) await goal(a, { title: `G${i}` }).expect(201);
    const over = await goal(a).expect(409);
    expect(JSON.stringify(over.body)).toContain('savings_limit');
  });

  it('reminds once a week, generically, while the deadline is near and the target not reached', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    await k.topup(a, 2000);
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const near = (await goal(a, { title: 'Secret goal', deadline: soon, targetMinor: 1000 }).expect(201)).body.id;
    const reached = (await goal(a, { title: 'Done', deadline: soon, targetMinor: 500 }).expect(201)).body.id;
    await goal(a, { title: 'Far', deadline: '2099-01-01' }).expect(201);
    await move(a, reached, 'deposit', 500).expect(201);

    const svc = ctx.app.get(SavingsService);
    expect(await svc.remindDeadlines()).toBe(1);
    expect(await svc.remindDeadlines()).toBe(0); // once a week
    const notes = await ctx.sql.query(`SELECT title, body FROM notifications WHERE user_id = $1`, [a.id]);
    expect(notes.rows).toHaveLength(1);
    expect(JSON.stringify(notes.rows)).not.toContain('Secret goal');
    await ctx.sql.query(`UPDATE savings_goals SET last_reminded_at = now() - interval '8 days' WHERE id = $1`, [near]);
    expect(await svc.remindDeadlines()).toBe(1);
  });
});

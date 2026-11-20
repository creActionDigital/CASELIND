import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { MoneyRequestsService } from '../src/wallet-finance/money-requests.service.js';
import { bearer, createTestContext, type TestContext } from './helpers.js';
import { financeKit } from './wallet-finance-helpers.js';

/** Money requests (test funds): create, pay exactly once, decline, cancel, expire, rights and blocks. */
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

describe('money requests', () => {
  it('creates idempotently, lists on both sides and refuses self, unknown and blocked payers', async () => {
    const a = await k.user();
    const b = await k.user();
    const clientId = randomUUID();
    const body = { clientId, payerHandle: `@${b.handle}`, amountMinor: 1200, currency: 'USD', note: 'Pizza' };
    const first = await k.post(a, '/v1/wallet/requests', body).expect(201);
    expect(first.body).toMatchObject({ mode: 'sandbox', direction: 'sent', amountMinor: 1200, status: 'pending', note: 'Pizza', billId: null });
    expect(first.body.counterparty.handle).toBe(b.handle);
    const again = await k.post(a, '/v1/wallet/requests', body).expect(200);
    expect(again.body.id).toBe(first.body.id);

    const received = await k.get(b, '/v1/wallet/requests?direction=received').expect(200);
    expect(received.body.items).toHaveLength(1);
    expect(received.body.items[0]).toMatchObject({ id: first.body.id, direction: 'received', status: 'pending' });
    expect((await k.get(a, '/v1/wallet/requests?direction=received').expect(200)).body.items).toHaveLength(0);

    await k.post(a, '/v1/wallet/requests', { clientId: randomUUID(), payerHandle: a.handle, amountMinor: 100, currency: 'USD' }).expect(400);
    await k.post(a, '/v1/wallet/requests', { clientId: randomUUID(), payerHandle: 'nobody_here_x', amountMinor: 100, currency: 'USD' }).expect(404);
    await k.post(a, '/v1/wallet/requests', { clientId: randomUUID(), payerHandle: b.handle, amountMinor: 100, currency: 'EUR' }).expect(400);

    await ctx.http.put(`/v1/blocks/${a.id}`).set(bearer(b.token)).expect(204);
    await k.request(a, b, 100).expect(404);
  });

  it("respects the payer's contact setting and caps pending requests at 20", async () => {
    const a = await k.user();
    const closed = await k.user();
    await ctx.sql.query(`UPDATE users SET contact_requests_from = 'nobody' WHERE id = $1`, [closed.id]);
    const r = await k.request(a, closed, 100).expect(403);
    expect(r.body.details?.reason ?? r.body.error?.details?.reason).toBe('contact_requests_restricted');

    const b = await k.user();
    for (let i = 0; i < 20; i++) await k.request(a, b, 100 + i).expect(201);
    const over = await k.request(a, b, 999).expect(409);
    expect(JSON.stringify(over.body)).toContain('pending_limit');
  });

  it('pays exactly once: exact balances, replay, wrong PIN, rights, audit without the note', async () => {
    k.limits();
    const a = await k.user();
    const b = await k.user();
    await k.topup(b, 5000);
    const made = await k.request(a, b, 1250, { note: 'Secret note' }).expect(201);
    const id = made.body.id;

    // wrong PIN: nothing moves, the request stays pending
    k.pinWrong();
    await k.post(b, `/v1/wallet/requests/${id}/pay`, { pin: '0000' }).expect(403);
    expect(await k.balance(b)).toBe(5000);
    vi.restoreAllMocks();

    k.limits();
    k.pinOk();
    // the requester cannot pay his own request (404, same as unknown)
    await k.post(a, `/v1/wallet/requests/${id}/pay`, { pin: '1234' }).expect(404);
    const paid = await k.post(b, `/v1/wallet/requests/${id}/pay`, { pin: '1234' }).expect(200);
    expect(paid.body).toMatchObject({ mode: 'sandbox', replayed: false });
    expect(paid.body.request).toMatchObject({ status: 'paid', direction: 'received' });
    expect(await k.balance(b)).toBe(3750);
    expect(await k.balance(a)).toBe(1250);

    const again = await k.post(b, `/v1/wallet/requests/${id}/pay`, { pin: '1234' }).expect(200);
    expect(again.body.replayed).toBe(true);
    expect(await k.balance(b)).toBe(3750);
    expect(await k.balance(a)).toBe(1250);
    const entries = await ctx.sql.query(`SELECT count(*)::int AS n FROM journal_entries WHERE idempotency_key = $1`, [`mreq:${id}`]);
    expect(entries.rows[0].n).toBe(1);

    // closed requests cannot be declined or cancelled
    await k.post(b, `/v1/wallet/requests/${id}/decline`).expect(409);
    await k.post(a, `/v1/wallet/requests/${id}/cancel`).expect(409);

    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action IN ('wallet.request_created', 'wallet.transfer') AND subject_user_id = ANY($1)`, [[a.id, b.id]]);
    expect(JSON.stringify(audit.rows)).not.toContain('Secret note');
  });

  it('two simultaneous payments move the money once', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(b, 5000);
    const id = (await k.request(a, b, 700).expect(201)).body.id;
    const results = await Promise.all([k.post(b, `/v1/wallet/requests/${id}/pay`, { pin: '1234' }), k.post(b, `/v1/wallet/requests/${id}/pay`, { pin: '1234' })]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await k.balance(b)).toBe(4300);
    expect(await k.balance(a)).toBe(700);
  });

  it('refuses with the ledger reasons: funds, limit and frozen account; the request stays pending', async () => {
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    const poor = (await k.request(a, b, 800).expect(201)).body.id;
    k.limits();
    const r1 = await k.post(b, `/v1/wallet/requests/${poor}/pay`, { pin: '1234' }).expect(409);
    expect(JSON.stringify(r1.body)).toContain('insufficient_funds');

    await k.topup(b, 5000);
    vi.restoreAllMocks();
    k.pinOk();
    k.limits({ maxSingleTransferMinor: 500 });
    const r2 = await k.post(b, `/v1/wallet/requests/${poor}/pay`, { pin: '1234' }).expect(409);
    expect(JSON.stringify(r2.body)).toContain('limit_exceeded');

    vi.restoreAllMocks();
    k.pinOk();
    k.limits();
    await ctx.sql.query(`UPDATE ledger_accounts SET status = 'frozen' WHERE user_id = $1`, [b.id]);
    await k.post(b, `/v1/wallet/requests/${poor}/pay`, { pin: '1234' }).expect(403);
    await ctx.sql.query(`UPDATE ledger_accounts SET status = 'active' WHERE user_id = $1`, [b.id]);
    const st = await ctx.sql.query(`SELECT status FROM money_requests WHERE id = $1`, [poor]);
    expect(st.rows[0].status).toBe('pending');
    await k.post(b, `/v1/wallet/requests/${poor}/pay`, { pin: '1234' }).expect(200);
  });

  it('decline, cancel and rights', async () => {
    const a = await k.user();
    const b = await k.user();
    const c = await k.user();
    const r1 = (await k.request(a, b, 100).expect(201)).body.id;
    await k.post(a, `/v1/wallet/requests/${r1}/decline`).expect(404); // only the payer declines
    await k.post(c, `/v1/wallet/requests/${r1}/cancel`).expect(404);
    await k.post(b, `/v1/wallet/requests/${r1}/cancel`).expect(404); // only the requester cancels
    expect((await k.post(b, `/v1/wallet/requests/${r1}/decline`).expect(200)).body.status).toBe('declined');
    const r2 = (await k.request(a, b, 100).expect(201)).body.id;
    expect((await k.post(a, `/v1/wallet/requests/${r2}/cancel`).expect(200)).body.status).toBe('cancelled');
    await k.post(b, `/v1/wallet/requests/${r2}/pay`, { pin: '1234' }).expect(409);
    await k.get(c, '/v1/wallet/requests').expect(200);
    expect((await k.get(c, '/v1/wallet/requests')).body.items).toHaveLength(0);
  });

  it('expires after 14 days: refused at once, then marked by maintenance', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(b, 1000);
    const id = (await k.request(a, b, 300).expect(201)).body.id;
    const ttl = await ctx.sql.query(`SELECT expires_at - created_at AS d FROM money_requests WHERE id = $1`, [id]);
    expect(ttl.rows[0].d.days).toBe(14);
    await ctx.sql.query(`UPDATE money_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    const listed = await k.get(b, '/v1/wallet/requests?status=expired').expect(200);
    expect(listed.body.items.map((r: { id: string }) => r.id)).toContain(id);
    const refused = await k.post(b, `/v1/wallet/requests/${id}/pay`, { pin: '1234' }).expect(409);
    expect(JSON.stringify(refused.body)).toContain('request_expired');
    expect(await k.balance(b)).toBe(1000);
    expect(await ctx.app.get(MoneyRequestsService).expireDue()).toBeGreaterThanOrEqual(1);
    const st = await ctx.sql.query(`SELECT status FROM money_requests WHERE id = $1`, [id]);
    expect(st.rows[0].status).toBe('expired');
  });

  it('paginates with a cursor', async () => {
    const a = await k.user();
    const b = await k.user();
    for (let i = 0; i < 3; i++) await k.request(a, b, 100 + i).expect(201);
    const p1 = await k.get(a, '/v1/wallet/requests?limit=2').expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await k.get(a, `/v1/wallet/requests?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`).expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
  });
});

describe('account export and purge of wallet finance data', () => {
  it('exports the user data (no notes) and erases it with the account', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 3000);
    await k.request(a, b, 500, { note: 'Private words' }).expect(201);
    await k.post(a, '/v1/wallet/split-bills', { clientId: randomUUID(), title: 'Dinner', currency: 'USD', totalMinor: 900, split: 'equal', participants: [{ handle: b.handle }] }).expect(201);
    await k
      .post(a, '/v1/wallet/scheduled-payments', {
        clientId: randomUUID(),
        recipientHandle: b.handle,
        amountMinor: 100,
        currency: 'USD',
        frequency: 'monthly',
        firstRunAt: new Date(Date.now() + 86_400_000).toISOString(),
        pin: '1234',
      })
      .expect(201);
    const g = await k.post(a, '/v1/wallet/savings', { title: 'Trip', targetMinor: 5000, currency: 'USD' }).expect(201);
    await k.post(a, '/v1/wallet/savings/' + g.body.id + '/deposit', { clientId: randomUUID(), amountMinor: 700, pin: '1234' }).expect(201);

    const exp = await k.get(a, '/v1/me/export').expect(200);
    const wf = exp.body.walletFinance;
    expect(wf.mode).toBe('sandbox');
    expect(wf.moneyRequests).toHaveLength(2);
    expect(wf.splitBills).toHaveLength(1);
    expect(wf.scheduledPayments).toHaveLength(1);
    expect(wf.savingsGoals[0]).toMatchObject({ title: 'Trip', savedMinor: 700 });
    expect(JSON.stringify(wf)).not.toContain('Private words');

    await ctx.sql.query("UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1", [a.id]);
    expect((await ctx.app.get(MaintenanceService).runOnce()).deletedAccounts).toBeGreaterThanOrEqual(1);
    for (const [table, col] of [
      ['money_requests', 'requester_id'],
      ['money_requests', 'payer_id'],
      ['split_bills', 'creator_id'],
      ['scheduled_payments', 'owner_id'],
      ['savings_goals', 'user_id'],
      ['wallet_alerts', 'user_id'],
    ]) {
      const r = await ctx.sql.query('SELECT count(*)::int AS n FROM ' + table + ' WHERE ' + col + ' = $1', [a.id]);
      expect(r.rows[0].n, table + '.' + col).toBe(0);
    }
    const frozen = await ctx.sql.query('SELECT status FROM ledger_accounts WHERE system_code = $1', ['savings:' + a.id]);
    expect(frozen.rows[0].status).toBe('frozen');
  });
});


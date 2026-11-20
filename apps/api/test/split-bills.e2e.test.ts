import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';
import { financeKit, type FU } from './wallet-finance-helpers.js';

/** Split bills (test funds): shares that sum exactly, linked requests, settlement and cancellation. */
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

const bill = (creator: FU, over: Record<string, unknown>) =>
  k.post(creator, '/v1/wallet/split-bills', { clientId: randomUUID(), title: 'Restaurant', currency: 'USD', ...over });

const requestOf = async (u: FU, billId: string): Promise<string> => {
  const list = await k.get(u, '/v1/wallet/requests?direction=received').expect(200);
  return list.body.items.find((r: { billId: string }) => r.billId === billId).id;
};

describe('split bills', () => {
  it('splits equally with an exact sum, then settles when every share is paid', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    const c = await k.user();
    await k.topup(b, 2000);
    await k.topup(c, 2000);
    const created = await bill(a, { totalMinor: 1000, split: 'equal', participants: [{ handle: b.handle }, { handle: `@${c.handle}` }] }).expect(201);
    expect(created.body).toMatchObject({ mode: 'sandbox', status: 'open', totalMinor: 1000, selfMinor: 333, paidMinor: 0 });
    const amounts = created.body.shares.map((s: { amountMinor: number }) => s.amountMinor).sort();
    expect(amounts).toEqual([333, 334]);
    expect(amounts.reduce((x: number, y: number) => x + y, 0) + created.body.selfMinor).toBe(1000);

    const billId = created.body.id;
    const rb = await requestOf(b, billId);
    const rc = await requestOf(c, billId);
    const received = await k.get(b, '/v1/wallet/requests').expect(200);
    expect(received.body.items[0].billTitle).toBe('Restaurant');

    await k.post(b, `/v1/wallet/requests/${rb}/pay`, { pin: '1234' }).expect(200);
    expect((await k.get(a, `/v1/wallet/split-bills/${billId}`).expect(200)).body.status).toBe('open');
    await k.post(c, `/v1/wallet/requests/${rc}/pay`, { pin: '1234' }).expect(200);
    const done = await k.get(a, `/v1/wallet/split-bills/${billId}`).expect(200);
    expect(done.body).toMatchObject({ status: 'settled', paidMinor: 667 });
    expect(done.body.shares.every((s: { status: string; transferId: string }) => s.status === 'paid' && s.transferId)).toBe(true);
    expect(await k.balance(a)).toBe(667);
    expect((await k.get(a, '/v1/wallet/split-bills').expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(billId);

    // a settled bill cannot be cancelled
    await k.post(a, `/v1/wallet/split-bills/${billId}/cancel`).expect(409);
  });

  it('custom shares: the creator keeps the rest; shares above the total are refused', async () => {
    const a = await k.user();
    const b = await k.user();
    const c = await k.user();
    const ok = await bill(a, { totalMinor: 1000, split: 'custom', participants: [{ handle: b.handle, amountMinor: 400 }, { handle: c.handle, amountMinor: 300 }] }).expect(201);
    expect(ok.body.selfMinor).toBe(300);
    await bill(a, { totalMinor: 1000, split: 'custom', participants: [{ handle: b.handle, amountMinor: 700 }, { handle: c.handle, amountMinor: 400 }] }).expect(400);
    await bill(a, { totalMinor: 1000, split: 'custom', participants: [{ handle: b.handle }] }).expect(400);
  });

  it('refuses bad participants: none, self, duplicates, unknown, too small a total', async () => {
    const a = await k.user();
    const b = await k.user();
    await bill(a, { totalMinor: 1000, split: 'equal', participants: [] }).expect(400);
    await bill(a, { totalMinor: 1000, split: 'equal', participants: [{ handle: a.handle }] }).expect(400);
    await bill(a, { totalMinor: 1000, split: 'equal', participants: [{ handle: b.handle }, { userId: b.id }] }).expect(400);
    await bill(a, { totalMinor: 1000, split: 'equal', participants: [{ handle: 'unknown_zzz_user' }] }).expect(404);
    await bill(a, { totalMinor: 2, split: 'equal', participants: [{ handle: b.handle }, { handle: b.handle.toUpperCase() }] }).expect(400);
    const many = Array.from({ length: 20 }, () => ({ handle: b.handle }));
    await bill(a, { totalMinor: 100000, split: 'equal', participants: many }).expect(400);
  });

  it('is idempotent per clientId and private to its creator', async () => {
    const a = await k.user();
    const b = await k.user();
    const clientId = randomUUID();
    const body = { clientId, title: 'Taxi', currency: 'USD', totalMinor: 900, split: 'equal', participants: [{ handle: b.handle }] };
    const first = await k.post(a, '/v1/wallet/split-bills', body).expect(201);
    const again = await k.post(a, '/v1/wallet/split-bills', body).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM money_requests WHERE bill_id = $1`, [first.body.id])).rows[0].n).toBe(1);
    await k.get(b, `/v1/wallet/split-bills/${first.body.id}`).expect(404);
    await k.post(b, `/v1/wallet/split-bills/${first.body.id}/cancel`).expect(404);
  });

  it('a declined share leaves the bill open; cancelling cancels the pending requests but keeps paid shares', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    const c = await k.user();
    await k.topup(b, 1000);
    const created = await bill(a, { totalMinor: 900, split: 'custom', participants: [{ handle: b.handle, amountMinor: 300 }, { handle: c.handle, amountMinor: 300 }] }).expect(201);
    const billId = created.body.id;
    const rb = await requestOf(b, billId);
    const rc = await requestOf(c, billId);
    await k.post(c, `/v1/wallet/requests/${rc}/decline`).expect(200);
    await k.post(b, `/v1/wallet/requests/${rb}/pay`, { pin: '1234' }).expect(200);
    const mid = await k.get(a, `/v1/wallet/split-bills/${billId}`).expect(200);
    expect(mid.body.status).toBe('open');
    expect(mid.body.shares.map((s: { status: string }) => s.status).sort()).toEqual(['declined', 'paid']);

    const d = await k.user();
    const second = await bill(a, { totalMinor: 600, split: 'custom', participants: [{ handle: d.handle, amountMinor: 300 }] }).expect(201);
    const rd = await requestOf(d, second.body.id);
    const cancelled = await k.post(a, `/v1/wallet/split-bills/${second.body.id}/cancel`).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    await k.post(d, `/v1/wallet/requests/${rd}/pay`, { pin: '1234' }).expect(409);
    expect((await k.get(d, '/v1/wallet/requests').expect(200)).body.items[0].status).toBe('cancelled');
    await k.post(a, `/v1/wallet/split-bills/${second.body.id}/cancel`).expect(409);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PinVerifier } from '../src/wallet/pin.port.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
  vi.spyOn(ctx.app.get(PinVerifier), 'verify').mockResolvedValue({ status: 'ok' });
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  handle: string;
  id: string;
}
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, handle: me.body.handle, id: me.body.id };
}
const topup = (u: TU, amountMinor: number) =>
  ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(u.token)).send({ clientId: randomUUID(), amountMinor, currency: 'USD' }).expect(201);
const send = (u: TU, to: string, amountMinor: number) =>
  ctx.http.post('/v1/wallet/transfers').set(bearer(u.token)).send({ clientId: randomUUID(), toHandle: to, amountMinor, currency: 'USD', pin: '1234' }).expect(201);
const summary = (u: TU, qs = '') => ctx.http.get(`/v1/finance/summary${qs}`).set(bearer(u.token));
const setBudget = (u: TU, body: Record<string, unknown>) => ctx.http.put('/v1/finance/budget').set(bearer(u.token)).send(body);

describe('personal finance (lot 13, sandbox)', () => {
  it('needs a session and validates the budget', async () => {
    await ctx.http.get('/v1/finance/summary').expect(401);
    const a = await user();
    await setBudget(a, { currency: 'USD', limitMinor: 0 }).expect(400);
    await setBudget(a, { currency: 'USD', limitMinor: 1.5 }).expect(400);
    await setBudget(a, { currency: 'ZZZ', limitMinor: 100 }).expect(400);
    await summary(a, '?month=2026-13').expect(400);
  });

  it('counts transfers as spending (top-ups are not), tracks the budget, and is private', async () => {
    const [a, b] = [await user(), await user()];
    await topup(a, 10_000);
    const empty = await summary(a).expect(200);
    expect(empty.body).toMatchObject({ mode: 'sandbox', items: [] });

    await setBudget(a, { currency: 'USD', limitMinor: 4_000 }).expect(200);
    await send(a, b.handle, 1_000);
    await send(a, b.handle, 1_500);

    const s = (await summary(a).expect(200)).body.items[0];
    expect(s).toMatchObject({ currency: 'USD', spentMinor: 2_500, receivedMinor: 0, budgetMinor: 4_000, remainingMinor: 1_500, usedPercent: 63 });
    expect(s.byKind).toEqual([{ kind: 'p2p', spentMinor: 2_500 }]);

    const r = (await summary(b).expect(200)).body.items[0];
    expect(r).toMatchObject({ spentMinor: 0, receivedMinor: 2_500, budgetMinor: null, remainingMinor: null, usedPercent: null });

    await send(a, b.handle, 3_000); // over budget: the figures say so, nothing is blocked
    const over = (await summary(a).expect(200)).body.items[0];
    expect(over).toMatchObject({ spentMinor: 5_500, remainingMinor: -1_500, usedPercent: 138 });
  });

  it('filters by month, replaces and removes a budget (idempotent)', async () => {
    const a = await user();
    await setBudget(a, { currency: 'USD', limitMinor: 500 }).expect(200);
    await setBudget(a, { currency: 'USD', limitMinor: 900 }).expect(200);
    const now = new Date().toISOString().slice(0, 7);
    expect((await summary(a, `?month=${now}`)).body.items[0]).toMatchObject({ budgetMinor: 900, spentMinor: 0, usedPercent: 0 });
    expect((await summary(a, '?month=2020-01')).body).toMatchObject({ month: '2020-01', items: [{ currency: 'USD', spentMinor: 0, budgetMinor: 900 }] });
    await ctx.http.delete('/v1/finance/budget?currency=USD').set(bearer(a.token)).expect(204);
    await ctx.http.delete('/v1/finance/budget?currency=USD').set(bearer(a.token)).expect(204);
    expect((await summary(a)).body.items).toEqual([]);
    const n = async (action: string) =>
      Number((await ctx.sql.query('SELECT count(*) AS n FROM audit_events WHERE action = $1 AND subject_user_id = $2', [action, a.id])).rows[0].n);
    expect(await n('finance.budget_set')).toBe(2);
    expect(await n('finance.budget_removed')).toBe(1);
  });
});

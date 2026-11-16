import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PinVerifier } from '../src/wallet/pin.port.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Input validation, authentication and role guards for the cart and the sandbox wallet (lots 5 and 6). */
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.sql.query(
    `INSERT INTO feature_flags (key, description, enabled) VALUES ('commerce', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`,
  );
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => vi.restoreAllMocks());

async function user() {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id as string, handle: me.body.handle as string };
}
const topup = (token: string, body: Record<string, unknown>) =>
  ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(token)).send(body);
const transfer = (token: string, body: Record<string, unknown>) =>
  ctx.http.post('/v1/wallet/transfers').set(bearer(token)).send(body);
async function usd(token: string): Promise<number> {
  const res = await ctx.http.get('/v1/wallet').set(bearer(token)).expect(200);
  return res.body.balances.find((b: { currency: string }) => b.currency === 'USD')?.balanceMinor ?? 0;
}

describe('wallet input validation and authentication', () => {
  it('refuses malformed transfers with 400 and anonymous ones with 401, moving nothing', async () => {
    vi.spyOn(ctx.app.get(PinVerifier), 'verify').mockResolvedValue({ status: 'ok' });
    const a = await user();
    const b = await user();
    await topup(a.token, { clientId: randomUUID(), amountMinor: 1_000, currency: 'USD' }).expect(201);
    const ok = { clientId: randomUUID(), toHandle: b.handle, amountMinor: 100, currency: 'USD', pin: '1234' };
    for (const bad of [
      { amountMinor: 0 },
      { amountMinor: -5 },
      { amountMinor: 1.5 },
      { currency: 'usd' },
      { currency: 'DOLLAR' },
      { clientId: 'not-a-uuid' },
      { pin: '' },
      { toHandle: '   ' },
    ]) {
      const res = await transfer(a.token, { ...ok, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    await ctx.http.post('/v1/wallet/transfers').send(ok).expect(401);
    expect(await usd(a.token)).toBe(1_000);
    expect(await usd(b.token)).toBe(0);
  });

  it('refuses malformed top-ups with 400 and anonymous ones with 401', async () => {
    const a = await user();
    for (const bad of [{ amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 2.5 }, { currency: 'xx' }, { clientId: 'nope' }]) {
      const res = await topup(a.token, { clientId: randomUUID(), amountMinor: 100, currency: 'USD', ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    await ctx.http.post('/v1/wallet/sandbox/topup').send({ clientId: randomUUID(), amountMinor: 100, currency: 'USD' }).expect(401);
    expect(await usd(a.token)).toBe(0);
  });

  it('keeps the ledger back-office for admins: 401 anonymous, 403 for a plain user, even with a valid id', async () => {
    const u = await user();
    const id = randomUUID();
    await ctx.http.get('/v1/admin/ledger/reconcile').expect(401);
    await ctx.http.get('/v1/admin/ledger/reconcile').set(bearer(u.token)).expect(403);
    await ctx.http.get(`/v1/admin/ledger/accounts/${id}`).set(bearer(u.token)).expect(403);
    await ctx.http.post(`/v1/admin/ledger/accounts/${id}/freeze`).set(bearer(u.token)).expect(403);
    await ctx.http.post(`/v1/admin/ledger/accounts/${id}/unfreeze`).set(bearer(u.token)).expect(403);
  });
});

describe('cart input validation', () => {
  it('rejects bad quantities (400), unknown or malformed variants (404) and anonymous calls (401)', async () => {
    const u = await user();
    const variant = randomUUID();
    for (const quantity of [-1, 1.5, 1_000_000, '2', null]) {
      const res = await ctx.http.put(`/v1/cart/items/${variant}`).set(bearer(u.token)).send({ quantity });
      expect(res.status, String(quantity)).toBe(400);
    }
    await ctx.http.put(`/v1/cart/items/${variant}`).set(bearer(u.token)).send({}).expect(400);
    await ctx.http.put(`/v1/cart/items/${variant}`).set(bearer(u.token)).send({ quantity: 1 }).expect(404);
    await ctx.http.put('/v1/cart/items/not-a-uuid').set(bearer(u.token)).send({ quantity: 1 }).expect(404);
    await ctx.http.put(`/v1/cart/items/${variant}`).send({ quantity: 1 }).expect(401);
    await ctx.http.get('/v1/cart').expect(401);
    await ctx.http.delete('/v1/cart').expect(401);
    // Removing a line that is not there is a harmless no-op and the cart stays empty.
    const empty = await ctx.http.put(`/v1/cart/items/${variant}`).set(bearer(u.token)).send({ quantity: 0 }).expect(200);
    expect(empty.body.lines ?? empty.body.items ?? []).toHaveLength(0);
  });
});

import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { KycPort } from '../src/wallet/kyc.port.js';
import { PinVerifier } from '../src/wallet/pin.port.js';
import { bearer, signUp, type TestContext } from './helpers.js';

export interface TU {
  token: string;
  id: string;
  handle: string;
}

/** Small fixtures shared by the creator-tools tests (users, posts, wallet funds). */
export function creatorKit(ctx: TestContext) {
  const user = async (roles?: string[]): Promise<TU> => {
    const { tokens } = await signUp(ctx);
    const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
    if (roles) await ctx.sql.query(`UPDATE users SET roles = $1 WHERE id = $2`, [roles, me.body.id]);
    return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
  };
  const post = async (u: TU, body = 'Bonjour', visibility = 'public'): Promise<string> => {
    const res = await ctx.http.post('/v1/posts').set(bearer(u.token)).send({ clientId: randomUUID(), body, visibility }).expect(201);
    return res.body.id;
  };
  const follow = (a: TU, b: TU) => ctx.http.put(`/v1/users/${b.id}/follow`).set(bearer(a.token)).expect(204);
  const block = (a: TU, b: TU) => ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
  const topup = (u: TU, amountMinor: number, currency = 'USD') =>
    ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(u.token)).send({ clientId: randomUUID(), amountMinor, currency });
  const balance = async (u: TU, currency = 'USD'): Promise<number> => {
    const res = await ctx.http.get('/v1/wallet').set(bearer(u.token)).expect(200);
    return res.body.balances.find((b: { currency: string }) => b.currency === currency).balanceMinor;
  };
  const pinOk = () => vi.spyOn(ctx.app.get(PinVerifier), 'verify').mockResolvedValue({ status: 'ok' });
  const bigLimits = () =>
    vi.spyOn(ctx.app.get(KycPort), 'limitsFor').mockResolvedValue({ tier: 2, maxBalanceMinor: 10 ** 12, maxSingleTransferMinor: 10 ** 12, maxDailyOutgoingMinor: 10 ** 12 });
  return { user, post, follow, block, topup, balance, pinOk, bigLimits };
}

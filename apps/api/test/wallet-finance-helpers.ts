import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { KycPort } from '../src/wallet/kyc.port.js';
import { PinVerifier } from '../src/wallet/pin.port.js';
import { bearer, signUp, type TestContext } from './helpers.js';

export interface FU {
  token: string;
  id: string;
  handle: string;
}

/** Fixtures shared by the wallet-finance tests (users, test funds, PIN and limits mocks). */
export function financeKit(ctx: TestContext) {
  const user = async (roles?: string[]): Promise<FU> => {
    const { tokens } = await signUp(ctx);
    const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
    if (roles) await ctx.sql.query(`UPDATE users SET roles = $1 WHERE id = $2`, [roles, me.body.id]);
    return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
  };
  const topup = (u: FU, amountMinor: number, currency = 'USD') =>
    ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(u.token)).send({ clientId: randomUUID(), amountMinor, currency }).expect(201);
  const balance = async (u: FU, currency = 'USD'): Promise<number> => {
    const res = await ctx.http.get('/v1/wallet').set(bearer(u.token)).expect(200);
    return res.body.balances.find((b: { currency: string }) => b.currency === currency).balanceMinor;
  };
  const pinOk = () => vi.spyOn(ctx.app.get(PinVerifier), 'verify').mockResolvedValue({ status: 'ok' });
  const pinWrong = () => vi.spyOn(ctx.app.get(PinVerifier), 'verify').mockResolvedValue({ status: 'invalid', attemptsRemaining: 2 });
  const limits = (over: Partial<{ maxBalanceMinor: number; maxSingleTransferMinor: number; maxDailyOutgoingMinor: number }> = {}) =>
    vi.spyOn(ctx.app.get(KycPort), 'limitsFor').mockResolvedValue({
      tier: 2,
      maxBalanceMinor: 10 ** 12,
      maxSingleTransferMinor: 10 ** 12,
      maxDailyOutgoingMinor: 10 ** 12,
      ...over,
    });
  const post = (u: FU, path: string, body: Record<string, unknown> = {}) => ctx.http.post(path).set(bearer(u.token)).send(body);
  const get = (u: FU, path: string) => ctx.http.get(path).set(bearer(u.token));
  const request = (from: FU, payer: FU, amountMinor: number, extra: Record<string, unknown> = {}) =>
    post(from, '/v1/wallet/requests', { clientId: randomUUID(), payerHandle: payer.handle, amountMinor, currency: 'USD', ...extra });
  return { user, topup, balance, pinOk, pinWrong, limits, post, get, request };
}

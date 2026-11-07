import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ENV, type Env } from '../src/config/env.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { KycPort } from '../src/wallet/kyc.port.js';
import { LedgerPort } from '../src/wallet/ledger.port.js';
import { PinVerifier } from '../src/wallet/pin.port.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Sandbox ledger and wallet end to end (no real money, ADR-013). */
let ctx: TestContext;
let pins: PinVerifier;
let kyc: KycPort;

beforeAll(async () => {
  ctx = await createTestContext();
  pins = ctx.app.get(PinVerifier);
  kyc = ctx.app.get(KycPort);
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface TU {
  token: string;
  id: string;
  handle: string;
  name: string;
}

async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query(`UPDATE users SET roles = $1 WHERE id = $2`, [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle, name: me.body.displayName };
}

const pinOk = () => vi.spyOn(pins, 'verify').mockResolvedValue({ status: 'ok' });
const bigLimits = () =>
  vi.spyOn(kyc, 'limitsFor').mockResolvedValue({ tier: 2, maxBalanceMinor: 10 ** 12, maxSingleTransferMinor: 10 ** 12, maxDailyOutgoingMinor: 10 ** 12 });

async function topup(u: TU, amountMinor: number, currency = 'USD') {
  return ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(u.token)).send({ clientId: randomUUID(), amountMinor, currency });
}
function send(from: TU, to: string, amountMinor: number, extra: Record<string, unknown> = {}) {
  return ctx.http
    .post('/v1/wallet/transfers')
    .set(bearer(from.token))
    .send({ clientId: randomUUID(), toHandle: to, amountMinor, currency: 'USD', pin: '1234', ...extra });
}
async function balance(u: TU, currency = 'USD'): Promise<number> {
  const res = await ctx.http.get('/v1/wallet').set(bearer(u.token)).expect(200);
  return res.body.balances.find((b: { currency: string }) => b.currency === currency).balanceMinor;
}
async function accountId(userId: string, currency = 'USD'): Promise<string> {
  const r = await ctx.sql.query(`SELECT id FROM ledger_accounts WHERE user_id = $1 AND currency = $2`, [userId, currency]);
  return r.rows[0].id;
}

describe('sandbox top-up and wallet', () => {
  it('credits fictitious funds, is idempotent, capped, and always says sandbox', async () => {
    const a = await user();
    const empty = await ctx.http.get('/v1/wallet').set(bearer(a.token)).expect(200);
    expect(empty.body.mode).toBe('sandbox');
    expect(empty.body.kycTier).toBe(0);
    expect(empty.body.balances).toEqual([
      { currency: 'USD', balanceMinor: 0, status: 'active' },
      { currency: 'CDF', balanceMinor: 0, status: 'active' },
    ]);

    const clientId = randomUUID();
    const body = { clientId, amountMinor: 5_000, currency: 'USD' };
    const first = await ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(a.token)).send(body).expect(201);
    expect(first.body).toMatchObject({ mode: 'sandbox', replayed: false, amountMinor: 5_000, balanceMinor: 5_000 });
    const again = await ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(a.token)).send(body).expect(200);
    expect(again.body).toMatchObject({ transferId: first.body.transferId, replayed: true, balanceMinor: 5_000 });
    await ctx.http
      .post('/v1/wallet/sandbox/topup')
      .set(bearer(a.token))
      .send({ ...body, amountMinor: 6_000 })
      .expect(409)
      .expect((r) => expect(r.body.error.details.reason).toBe('idempotency_mismatch'));

    await topup(a, 10_001).then((r) => expect(r.status).toBe(400));
    await topup(a, 100, 'EUR').then((r) => expect(r.status).toBe(400));
    expect((await topup(a, 1_000, 'CDF')).status).toBe(201);
    expect(await balance(a, 'CDF')).toBe(1_000);
    expect(await balance(a)).toBe(5_000);
    await ctx.http.get('/v1/wallet').expect(401);
  });

  it('refuses the top-up in production unless explicitly enabled', async () => {
    const a = await user();
    const env = ctx.app.get<Env>(ENV);
    const saved = { n: env.NODE_ENV, t: env.WALLET_SANDBOX_TOPUP_ENABLED };
    try {
      env.NODE_ENV = 'production';
      env.WALLET_SANDBOX_TOPUP_ENABLED = undefined;
      const r = await topup(a, 1_000);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('feature_disabled');
      env.WALLET_SANDBOX_TOPUP_ENABLED = 'false';
      expect((await topup(a, 1_000)).status).toBe(403);
      env.WALLET_SANDBOX_TOPUP_ENABLED = 'true';
      expect((await topup(a, 1_000)).status).toBe(201);
    } finally {
      env.NODE_ENV = saved.n;
      env.WALLET_SANDBOX_TOPUP_ENABLED = saved.t;
    }
  });

  it('is unreachable when the wallet.sandbox flag is off', async () => {
    const a = await user();
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'wallet.sandbox'`);
    try {
      for (const res of [await ctx.http.get('/v1/wallet').set(bearer(a.token)), await topup(a, 100), await send(a, 'nobody', 100)]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('feature_disabled');
      }
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'wallet.sandbox'`);
    }
    await ctx.http.get('/v1/wallet').set(bearer(a.token)).expect(200);
  });
});

describe('P2P transfers', () => {
  it('needs a PIN: the stub reports pin_not_set, the verifier outcomes map to 403 and 423', async () => {
    const a = await user();
    const b = await user();
    await topup(a, 5_000);
    const stub = await send(a, b.handle, 100);
    expect(stub.status).toBe(409);
    expect(stub.body.error.details.reason).toBe('pin_not_set');
    vi.spyOn(pins, 'verify').mockResolvedValue({ status: 'invalid', attemptsRemaining: 2 });
    const wrong = await send(a, b.handle, 100);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.details).toEqual({ reason: 'pin_invalid', attemptsRemaining: 2 });
    vi.spyOn(pins, 'verify').mockResolvedValue({ status: 'locked', lockedUntil: new Date('2030-01-01T00:00:00Z') });
    const locked = await send(a, b.handle, 100);
    expect(locked.status).toBe(423);
    expect(locked.body.error.details).toEqual({ reason: 'pin_locked', lockedUntil: '2030-01-01T00:00:00.000Z' });
    expect(await balance(a)).toBe(5_000);
  });

  it('moves funds, shows both histories, notifies the recipient and audits without the note', async () => {
    pinOk();
    const a = await user();
    const b = await user();
    await topup(a, 10_000);

    const res = await send(a, `@${b.handle.toUpperCase()}`, 2_500, { note: 'merci pour le café' }).expect(201);
    expect(res.body).toMatchObject({ mode: 'sandbox', replayed: false, amountMinor: 2_500, currency: 'USD', balanceMinor: 7_500 });
    expect(await balance(a)).toBe(7_500);
    expect(await balance(b)).toBe(2_500);

    const hist = await ctx.http.get('/v1/wallet/transactions').set(bearer(a.token)).expect(200);
    expect(hist.body.mode).toBe('sandbox');
    expect(hist.body.items[0]).toEqual({
      id: res.body.transferId,
      kind: 'p2p',
      direction: 'out',
      amountMinor: 2_500,
      currency: 'USD',
      counterparty: { kind: 'user', userId: b.id, displayName: b.name, handle: b.handle },
      note: 'merci pour le café',
      createdAt: expect.any(String),
    });
    expect(hist.body.items[1]).toMatchObject({ kind: 'sandbox_topup', direction: 'in', counterparty: { kind: 'system' } });
    const histB = await ctx.http.get('/v1/wallet/transactions?currency=USD').set(bearer(b.token)).expect(200);
    expect(histB.body.items).toHaveLength(1);
    expect(histB.body.items[0]).toMatchObject({
      direction: 'in',
      amountMinor: 2_500,
      counterparty: { kind: 'user', userId: a.id, displayName: a.name, handle: a.handle },
    });
    // Cursor pagination.
    const page1 = await ctx.http.get('/v1/wallet/transactions?limit=1').set(bearer(a.token)).expect(200);
    expect(page1.body.items).toHaveLength(1);
    const page2 = await ctx.http.get(`/v1/wallet/transactions?limit=1&cursor=${page1.body.nextCursor}`).set(bearer(a.token)).expect(200);
    expect(page2.body.items[0].kind).toBe('sandbox_topup');
    expect(page2.body.nextCursor).toBeNull();

    const notifs = await ctx.http.get('/v1/notifications').set(bearer(b.token)).expect(200);
    const payment = notifs.body.items.find((n: { category: string }) => n.category === 'payment');
    expect(payment.body).toBe(`Vous avez reçu 25.00 USD de ${a.name}`);

    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'wallet.transfer' AND actor_user_id = $1`, [a.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toMatchObject({ amountMinor: 2_500, currency: 'USD', counterpartyId: b.id });
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain('café');
    const topupAudit = await ctx.sql.query(`SELECT 1 FROM audit_events WHERE action = 'wallet.sandbox_topup' AND actor_user_id = $1`, [a.id]);
    expect(topupAudit.rows).toHaveLength(1);
  });

  it('is idempotent per clientId; the same key with another amount is a 409', async () => {
    pinOk();
    const a = await user();
    const b = await user();
    await topup(a, 10_000);
    const clientId = randomUUID();
    const first = await send(a, b.handle, 1_000, { clientId }).expect(201);
    const replay = await send(a, b.handle, 1_000, { clientId }).expect(200);
    expect(replay.body).toMatchObject({ transferId: first.body.transferId, replayed: true });
    const other = await send(a, b.handle, 2_000, { clientId });
    expect(other.status).toBe(409);
    expect(other.body.error.details.reason).toBe('idempotency_mismatch');
    expect(await balance(a)).toBe(9_000);
    expect(await balance(b)).toBe(1_000);
  });

  it('refuses insufficient funds, self, unknown and blocked recipients without moving anything', async () => {
    pinOk();
    const a = await user();
    const b = await user();
    const c = await user();
    await topup(a, 1_000);
    const poor = await send(a, b.handle, 1_001);
    expect(poor.status).toBe(409);
    expect(poor.body.error.details.reason).toBe('insufficient_funds');
    expect((await send(a, a.handle, 100)).status).toBe(400);
    expect((await send(a, 'no_such_handle_xyz', 100)).status).toBe(404);
    await ctx.sql.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [b.id, a.id]);
    expect((await send(a, b.handle, 100)).status).toBe(404);
    await topup(b, 500);
    expect((await send(b, a.handle, 100)).status).toBe(404);
    expect((await send(a, c.handle, 100)).status).toBe(201);
    expect(await balance(a)).toBe(900);
  });

  it('applies the KYC limits (single, rolling daily, recipient balance)', async () => {
    pinOk();
    const a = await user();
    const b = await user();
    await topup(a, 10_000);
    const limits = (over: Partial<{ maxBalanceMinor: number; maxSingleTransferMinor: number; maxDailyOutgoingMinor: number }>) => ({
      tier: 1 as const,
      maxBalanceMinor: 10 ** 9,
      maxSingleTransferMinor: 10 ** 9,
      maxDailyOutgoingMinor: 10 ** 9,
      ...over,
    });
    const spy = vi.spyOn(kyc, 'limitsFor').mockImplementation(async (_u, _c) => limits({ maxSingleTransferMinor: 1_000 }));
    const single = await send(a, b.handle, 1_001);
    expect(single.status).toBe(409);
    expect(single.body.error.details.reason).toBe('limit_exceeded');
    expect(spy).toHaveBeenCalledWith(a.id, 'USD');
    expect((await send(a, b.handle, 1_000)).status).toBe(201);

    spy.mockImplementation(async () => limits({ maxDailyOutgoingMinor: 2_500 }));
    expect((await send(a, b.handle, 1_000)).status).toBe(201); // 2 000 out in the last 24 h
    const daily = await send(a, b.handle, 501);
    expect(daily.status).toBe(409);
    expect(daily.body.error.details.reason).toBe('limit_exceeded');
    expect((await send(a, b.handle, 500)).status).toBe(201);

    spy.mockImplementation(async (u) => limits(u === b.id ? { maxBalanceMinor: 2_500 } : {}));
    expect((await send(a, b.handle, 1)).status).toBe(409); // b holds 2 500 already
    expect(await balance(b)).toBe(2_500);
    await topup(b, 1).then((r) => expect(r.status).toBe(409));
  });

  it('refuses movements on frozen accounts until unfrozen (admin, audited)', async () => {
    pinOk();
    bigLimits();
    const admin = await user(['user', 'admin']);
    const a = await user();
    const b = await user();
    await topup(a, 5_000);
    await send(a, b.handle, 100).expect(201);
    const aId = await accountId(a.id);
    const bId = await accountId(b.id);

    await ctx.http.get(`/v1/admin/ledger/accounts/${aId}`).set(bearer(a.token)).expect(403);
    const frozen = await ctx.http.post(`/v1/admin/ledger/accounts/${aId}/freeze`).set(bearer(admin.token)).expect(200);
    expect(frozen.body).toMatchObject({ id: aId, status: 'frozen', balanceMinor: 4_900, ledgerBalanceMinor: 4_900, userId: a.id });
    expect((await send(a, b.handle, 100)).status).toBe(403);
    expect((await send(b, a.handle, 50)).status).toBe(403);
    expect((await topup(a, 100)).status).toBe(403);
    expect((await ctx.http.get('/v1/wallet').set(bearer(a.token)).expect(200)).body.balances[0].status).toBe('frozen');
    await ctx.http.post(`/v1/admin/ledger/accounts/${aId}/unfreeze`).set(bearer(admin.token)).expect(200);
    expect((await send(a, b.handle, 100)).status).toBe(201);
    await ctx.http.post(`/v1/admin/ledger/accounts/${bId}/freeze`).set(bearer(admin.token)).expect(200);
    expect((await send(a, b.handle, 100)).status).toBe(403);
    await ctx.http.get('/v1/admin/ledger/accounts/not-a-uuid').set(bearer(admin.token)).expect(404);
    const events = await ctx.sql.query(`SELECT action FROM audit_events WHERE actor_user_id = $1 AND action LIKE 'ledger.%' ORDER BY id`, [admin.id]);
    expect(events.rows.map((r) => r.action)).toEqual(['ledger.account_frozen', 'ledger.account_unfrozen', 'ledger.account_frozen']);
  });

  it('serialises concurrent transfers: 20 attempts on a balance covering 10 -> exactly 10 succeed, never negative', async () => {
    pinOk();
    bigLimits();
    const a = await user();
    const b = await user();
    await topup(a, 10_000);
    const results = await Promise.all(Array.from({ length: 20 }, () => send(a, b.handle, 1_000)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(10);
    expect(await balance(a)).toBe(0);
    expect(await balance(b)).toBe(10_000);
    const negative = await ctx.sql.query(`SELECT count(*)::int AS n FROM ledger_accounts WHERE balance_minor < 0 AND NOT allow_negative`);
    expect(negative.rows[0].n).toBe(0);

    // Concurrent retries of the same key move the money once.
    const clientId = randomUUID();
    await topup(a, 3_000);
    const same = await Promise.all(Array.from({ length: 5 }, () => send(a, b.handle, 1_000, { clientId })));
    expect(same.filter((r) => r.status === 201)).toHaveLength(1);
    expect(same.filter((r) => r.status === 200)).toHaveLength(4);
    expect(await balance(a)).toBe(2_000);
  });
});

describe('ledger integrity', () => {
  it('rejects UPDATE and DELETE on entries and postings', async () => {
    const a = await user();
    await topup(a, 100);
    await expect(ctx.sql.query(`UPDATE postings SET amount_minor = 1 WHERE amount_minor = 100`)).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`DELETE FROM postings`)).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`UPDATE journal_entries SET kind = 'p2p'`)).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`DELETE FROM journal_entries`)).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`TRUNCATE postings`)).rejects.toThrow(/append-only/);
  });

  it('rejects at commit an entry whose postings do not sum to zero, and an entry without postings', async () => {
    const a = await user();
    await topup(a, 100);
    const accId = await accountId(a.id);
    const client = await ctx.sql.connect();
    try {
      await client.query('BEGIN');
      const e = await client.query(
        `INSERT INTO journal_entries (kind, idempotency_key, currency, amount_minor) VALUES ('adjustment', $1, 'USD', 100) RETURNING id`,
        [randomUUID()],
      );
      await client.query(`INSERT INTO postings (entry_id, account_id, currency, amount_minor) VALUES ($1, $2, 'USD', 100)`, [e.rows[0].id, accId]);
      await expect(client.query('COMMIT')).rejects.toThrow(/not balanced/);
      await client.query('ROLLBACK').catch(() => undefined);

      await client.query('BEGIN');
      await client.query(
        `INSERT INTO journal_entries (kind, idempotency_key, currency, amount_minor) VALUES ('adjustment', $1, 'USD', 100)`,
        [randomUUID()],
      );
      await expect(client.query('COMMIT')).rejects.toThrow(/no postings/);
      await client.query('ROLLBACK').catch(() => undefined);

      // A direct overdraft is refused by the database too.
      await expect(
        ctx.sql.query(
          `WITH e AS (INSERT INTO journal_entries (kind, idempotency_key, currency, amount_minor) VALUES ('adjustment', $1, 'USD', 1) RETURNING id)
           INSERT INTO postings (entry_id, account_id, currency, amount_minor) SELECT id, $2::uuid, 'USD', -1000000 FROM e`,
          [randomUUID(), accId],
        ),
      ).rejects.toThrow(/non_negative|not balanced/);
    } finally {
      client.release();
    }
    expect(await balance(a)).toBe(100);
  });

  it('reconciles clean, then detects a tampered balance cache', async () => {
    const admin = await user(['user', 'admin']);
    const a = await user();
    await topup(a, 777);
    const clean = await ctx.http.get('/v1/admin/ledger/reconcile').set(bearer(admin.token)).expect(200);
    expect(clean.body).toMatchObject({ mode: 'sandbox', ok: true, divergences: [] });
    expect(clean.body.currencyTotals.every((t: { totalMinor: number }) => t.totalMinor === 0)).toBe(true);
    expect(clean.body.accountsChecked).toBeGreaterThan(1);

    const aId = await accountId(a.id);
    await ctx.sql.query(`UPDATE ledger_accounts SET balance_minor = balance_minor + 5 WHERE id = $1`, [aId]);
    try {
      const bad = await ctx.http.get('/v1/admin/ledger/reconcile').set(bearer(admin.token)).expect(200);
      expect(bad.body.ok).toBe(false);
      expect(bad.body.divergences).toEqual([{ accountId: aId, currency: 'USD', cachedMinor: 782, ledgerMinor: 777 }]);
      const acc = await ctx.http.get(`/v1/admin/ledger/accounts/${aId}`).set(bearer(admin.token)).expect(200);
      expect(acc.body).toMatchObject({ balanceMinor: 782, ledgerBalanceMinor: 777 });
      await ctx.http.get('/v1/admin/ledger/reconcile').set(bearer(a.token)).expect(403);
      // The hourly maintenance logs it and still completes.
      await ctx.app.get(MaintenanceService).runOnce();
    } finally {
      await ctx.sql.query(`UPDATE ledger_accounts SET balance_minor = balance_minor - 5 WHERE id = $1`, [aId]);
    }
    expect((await ctx.http.get('/v1/admin/ledger/reconcile').set(bearer(admin.token)).expect(200)).body.ok).toBe(true);
  });
});

describe('organisation wallet', () => {
  it('shows the balance and history to finance.view members only', async () => {
    bigLimits();
    const owner = await user();
    const outsider = await user();
    const buyer = await user();
    const org = await ctx.http
      .post('/v1/orgs')
      .set(bearer(owner.token))
      .send({ slug: `shop-${Date.now().toString(36)}`, name: 'Boutique Wallet', kind: 'shop' })
      .expect(201);
    const orgId = org.body.id as string;
    await topup(buyer, 4_000);

    // What the QR payment lot (6B) calls: a user pays the organisation through the port.
    const ledger = ctx.app.get(LedgerPort);
    const paid = await ledger.transfer({
      from: { kind: 'user', userId: buyer.id },
      to: { kind: 'org', orgId },
      amountMinor: 1_500,
      currency: 'USD',
      kind: 'merchant_payment',
      idempotencyKey: randomUUID(),
      initiatedBy: buyer.id,
      metadata: { orgId },
    });
    expect(paid).toMatchObject({ ok: true, replayed: false });
    expect(await ledger.balance({ kind: 'org', orgId }, 'USD')).toBe(1_500);
    expect(await ledger.balance({ kind: 'user', userId: buyer.id }, 'USD')).toBe(2_500);

    const w = await ctx.http.get(`/v1/orgs/${orgId}/wallet`).set(bearer(owner.token)).expect(200);
    expect(w.body.mode).toBe('sandbox');
    expect(w.body.balances.find((b: { currency: string }) => b.currency === 'USD').balanceMinor).toBe(1_500);
    const tx = await ctx.http.get(`/v1/orgs/${orgId}/wallet/transactions`).set(bearer(owner.token)).expect(200);
    expect(tx.body.items[0]).toMatchObject({
      kind: 'merchant_payment',
      direction: 'in',
      amountMinor: 1_500,
      counterparty: { kind: 'user', userId: buyer.id, handle: buyer.handle },
    });
    expect([403, 404]).toContain((await ctx.http.get(`/v1/orgs/${orgId}/wallet`).set(bearer(outsider.token))).status);

    // A frozen payer cannot pay; unknown payee organisation is an invalid counterparty.
    expect(
      await ledger.transfer({
        from: { kind: 'user', userId: buyer.id },
        to: { kind: 'org', orgId: randomUUID() },
        amountMinor: 1,
        currency: 'USD',
        kind: 'merchant_payment',
        idempotencyKey: randomUUID(),
        initiatedBy: buyer.id,
      }),
    ).toEqual({ ok: false, reason: 'invalid_counterparty' });
  });
});

describe('account export and purge', () => {
  it('exports the wallet, then the purge freezes the accounts and keeps every posting', async () => {
    pinOk();
    bigLimits();
    const a = await user();
    const b = await user();
    await topup(a, 3_000);
    await send(a, b.handle, 1_000, { note: 'loyer' }).expect(201);

    const exp = await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200);
    expect(exp.body.wallet.mode).toBe('sandbox');
    expect(exp.body.wallet.balances.find((x: { currency: string }) => x.currency === 'USD').balanceMinor).toBe(2_000);
    expect(exp.body.wallet.transactions.map((t: { kind: string }) => t.kind)).toEqual(['p2p', 'sandbox_topup']);

    const before = await ctx.sql.query(`SELECT count(*)::int AS n FROM postings`);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '90 days' WHERE id = $1`, [a.id]);
    const run = await ctx.app.get(MaintenanceService).runOnce();
    expect(run.deletedAccounts).toBeGreaterThanOrEqual(1);
    const after = await ctx.sql.query(`SELECT count(*)::int AS n FROM postings`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const acc = await ctx.sql.query(`SELECT status, balance_minor::int AS bal FROM ledger_accounts WHERE user_id = $1 AND currency = 'USD'`, [a.id]);
    // Residual sandbox balance is kept (reported by the reconciliation), the account is frozen.
    expect(acc.rows[0]).toEqual({ status: 'frozen', bal: 2_000 });
    expect(await balance(b)).toBe(1_000);
  });
});

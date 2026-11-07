import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QrSigner } from '../src/payments-qr/qr-signer.js';
import { LedgerPort } from '../src/wallet/ledger.port.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ PAYMENT_QR_SECRET: 'q'.repeat(40), PAYMENT_PIN_MAX_ATTEMPTS: '3' });
  await ctx.sql.query(
    `INSERT INTO feature_flags (key, description, enabled) VALUES ('wallet.sandbox', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`,
  );
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
  handle: string;
}

async function user(): Promise<TU> {
  const s = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(s.tokens.accessToken)).expect(200);
  return { token: s.tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

let slug = 0;
async function addMember(orgId: string, inviter: TU, invitee: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(inviter.token)).send({ handle: invitee.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(invitee.token)).expect(200);
}

/** An org with an owner, a finance member and an employee (no finance access). */
async function merchant() {
  const owner = await user();
  const finance = await user();
  const employee = await user();
  slug += 1;
  const org = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug: `qr-${Date.now().toString(36)}-${slug}`, name: 'Boutique QR', kind: 'shop' })
    .expect(201);
  const orgId = org.body.id as string;
  await addMember(orgId, owner, finance, 'finance');
  await addMember(orgId, owner, employee, 'employee');
  return { owner, finance, employee, orgId };
}

const PIN = '482916';

/** A payer with a payment PIN and `amountMinor` USD of sandbox funds. */
async function payer(amountMinor = 50_00): Promise<TU> {
  const u = await user();
  await ctx.http.put('/v1/me/payment-pin').set(bearer(u.token)).send({ pin: PIN, password: PASSWORD }).expect(204);
  if (amountMinor > 0) {
    await ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(u.token)).send({ clientId: randomUUID(), amountMinor, currency: 'USD' }).expect(201);
  }
  return u;
}

const createQr = (who: TU, orgId: string, body: Record<string, unknown>) =>
  ctx.http.post(`/v1/orgs/${orgId}/payment-qr`).set(bearer(who.token)).send(body);
const resolve = (who: TU, payload: string) => ctx.http.post('/v1/wallet/qr/resolve').set(bearer(who.token)).send({ payload });
const pay = (who: TU, payload: string, extra: Record<string, unknown> = {}) =>
  ctx.http.post('/v1/wallet/qr/pay').set(bearer(who.token)).send({ clientId: randomUUID(), payload, pin: PIN, ...extra });
const balance = (u: TU) => ctx.app.get(LedgerPort).balance({ kind: 'user', userId: u.id }, 'USD');
const orgBalance = (orgId: string) => ctx.app.get(LedgerPort).balance({ kind: 'org', orgId }, 'USD');

async function fixedQr(m: { owner: TU; orgId: string }, amountMinor = 10_00, extra: Record<string, unknown> = {}): Promise<{ qrId: string; payload: string }> {
  const res = await createQr(m.owner, m.orgId, { amountMinor, currency: 'USD', label: 'Café', ...extra }).expect(201);
  return res.body;
}

describe('creating, listing and revoking QR codes', () => {
  it('lets finance.view and orders.manage roles create, refuses the others and non-members', async () => {
    const m = await merchant();
    const manager = await user();
    await addMember(m.orgId, m.owner, manager, 'manager');
    const outsider = await user();
    const body = { currency: 'USD' };
    const created = await createQr(m.finance, m.orgId, body).expect(201);
    expect(created.body).toMatchObject({ orgId: m.orgId, amountMinor: null, currency: 'USD', expiresAt: null, singleUse: false, status: 'active' });
    expect(created.body.payload).toMatch(/^CLQ1\./);
    await createQr(manager, m.orgId, body).expect(201);
    await createQr(m.employee, m.orgId, body).expect(403);
    await createQr(outsider, m.orgId, body).expect(404);
    await ctx.http.post(`/v1/orgs/${m.orgId}/payment-qr`).send(body).expect(401);
  });

  it('validates the request: currency, expiry bounds, single use needs an amount', async () => {
    const m = await merchant();
    await createQr(m.owner, m.orgId, { currency: 'XYZ' }).expect(400);
    await createQr(m.owner, m.orgId, { currency: 'usd' }).expect(400);
    await createQr(m.owner, m.orgId, { currency: 'USD', expiresInSeconds: 30 }).expect(400);
    await createQr(m.owner, m.orgId, { currency: 'USD', expiresInSeconds: 90_000 }).expect(400);
    await createQr(m.owner, m.orgId, { currency: 'USD', amountMinor: 0 }).expect(400);
    await createQr(m.owner, m.orgId, { currency: 'USD', singleUse: true }).expect(400);
    const timed = await createQr(m.owner, m.orgId, { currency: 'USD', expiresInSeconds: 600 }).expect(201);
    expect(Date.parse(timed.body.expiresAt) - Date.now()).toBeGreaterThan(500_000);
    const fixed = await createQr(m.owner, m.orgId, { currency: 'USD', amountMinor: 500 }).expect(201);
    expect(fixed.body).toMatchObject({ singleUse: true, status: 'active' });
    expect(fixed.body.expiresAt).not.toBeNull();
  });

  it('lists the QR codes of the org and revokes them (idempotent, audited, other org: 404)', async () => {
    const m = await merchant();
    const other = await merchant();
    const a = await fixedQr(m);
    const b = await createQr(m.owner, m.orgId, { currency: 'USD' }).expect(201);
    await ctx.http.delete(`/v1/orgs/${m.orgId}/payment-qr/${a.qrId}`).set(bearer(m.finance.token)).expect(204);
    await ctx.http.delete(`/v1/orgs/${m.orgId}/payment-qr/${a.qrId}`).set(bearer(m.finance.token)).expect(204);
    await ctx.http.delete(`/v1/orgs/${m.orgId}/payment-qr/${a.qrId}`).set(bearer(m.employee.token)).expect(403);
    await ctx.http.delete(`/v1/orgs/${other.orgId}/payment-qr/${a.qrId}`).set(bearer(other.owner.token)).expect(404);
    await ctx.http.delete(`/v1/orgs/${m.orgId}/payment-qr/nope`).set(bearer(m.owner.token)).expect(404);

    const list = await ctx.http.get(`/v1/orgs/${m.orgId}/payment-qr`).set(bearer(m.owner.token)).expect(200);
    expect(list.body.items.map((q: { qrId: string; status: string }) => [q.qrId, q.status])).toEqual([
      [b.body.qrId, 'active'],
      [a.qrId, 'revoked'],
    ]);
    await ctx.http.get(`/v1/orgs/${m.orgId}/payment-qr`).set(bearer(m.employee.token)).expect(403);
    const audit = await ctx.sql.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'wallet.qr_revoked' AND metadata->>'qrId' = $1`, [a.qrId]);
    expect(audit.rows[0].n).toBe(1);
  });
});

describe('resolving a QR', () => {
  it('returns the merchant identity, amount, currency and label, nothing else', async () => {
    const m = await merchant();
    const p = await payer(0);
    const qr = await fixedQr(m, 12_50);
    const res = await resolve(p, qr.payload).expect(200);
    expect(res.body).toEqual({
      org: { id: m.orgId, name: 'Boutique QR', verified: false },
      amountMinor: 12_50,
      currency: 'USD',
      label: 'Café',
      qrId: qr.qrId,
    });
    await ctx.http.post('/v1/wallet/qr/resolve').send({ payload: qr.payload }).expect(401);
  });

  it('refuses forged, altered, expired and revoked payloads with a bare reason', async () => {
    const m = await merchant();
    const p = await payer(0);
    const qr = await fixedQr(m, 12_50);
    const reason = async (payload: string) => {
      const res = await resolve(p, payload).expect(400);
      expect(Object.keys(res.body.error.details)).toEqual(['reason']);
      return res.body.error.details.reason as string;
    };
    const parts = qr.payload.split('.');
    // Amount changed, signature kept.
    expect(await reason([...parts.slice(0, 3), '1', ...parts.slice(4)].join('.'))).toBe('invalid_qr');
    // Signature changed.
    expect(await reason(`${parts.slice(0, 6).join('.')}.${'A'.repeat(43)}`)).toBe('invalid_qr');
    expect(await reason(`${qr.payload}.x`)).toBe('invalid_qr');
    expect(await reason('hello world, not a qr')).toBe('invalid_qr');
    // Signed by someone without the key.
    expect(await reason(qr.payload.replace('CLQ1', 'CLQ2'))).toBe('invalid_qr');

    // A genuine signature over an expired date.
    const signer = ctx.app.get(QrSigner);
    const expired = signer.sign({ orgId: m.orgId, qrId: qr.qrId, amountMinor: 12_50, currency: 'USD', expiresAtSec: Math.floor(Date.now() / 1000) - 5 });
    expect(await reason(expired)).toBe('expired');
    // A genuine signature for a QR that was never issued.
    const unknown = signer.sign({ orgId: m.orgId, qrId: randomUUID(), amountMinor: null, currency: 'USD', expiresAtSec: null });
    expect(await reason(unknown)).toBe('invalid_qr');

    await ctx.http.delete(`/v1/orgs/${m.orgId}/payment-qr/${qr.qrId}`).set(bearer(m.owner.token)).expect(204);
    expect(await reason(qr.payload)).toBe('revoked');
  });
});

describe('paying a QR', () => {
  it('moves the funds to the org, notifies finance members and consumes a single-use QR', async () => {
    const m = await merchant();
    const p = await payer(50_00);
    const qr = await fixedQr(m, 12_50);
    const clientId = randomUUID();
    const res = await pay(p, qr.payload, { clientId, amountMinor: 999 }).expect(200); // amount ignored: the QR fixes it
    expect(res.body).toMatchObject({ replayed: false, amountMinor: 12_50, currency: 'USD', org: { id: m.orgId, name: 'Boutique QR' } });
    expect(await balance(p)).toBe(37_50);
    expect(await orgBalance(m.orgId)).toBe(12_50);

    const entry = await ctx.sql.query(`SELECT kind, metadata FROM journal_entries WHERE id = $1`, [res.body.transferId]);
    expect(entry.rows[0].kind).toBe('merchant_payment');
    expect(entry.rows[0].metadata).toMatchObject({ qrId: qr.qrId, orgId: m.orgId });

    const financeNotes = await ctx.http.get('/v1/notifications').set(bearer(m.finance.token)).expect(200);
    expect(financeNotes.body.items.some((n: { category: string }) => n.category === 'payment')).toBe(true);
    const employeeNotes = await ctx.http.get('/v1/notifications').set(bearer(m.employee.token)).expect(200);
    expect(employeeNotes.body.items.some((n: { category: string }) => n.category === 'payment')).toBe(false);

    // Same clientId: the first result, no second movement.
    const replay = await pay(p, qr.payload, { clientId }).expect(200);
    expect(replay.body).toMatchObject({ transferId: res.body.transferId, replayed: true });
    expect(await balance(p)).toBe(37_50);
    // Another payment of a consumed QR is refused, and so is resolving it.
    const other = await payer(50_00);
    expect((await pay(other, qr.payload).expect(400)).body.error.details.reason).toBe('already_used');
    expect((await resolve(other, qr.payload).expect(400)).body.error.details.reason).toBe('already_used');
    expect(await balance(other)).toBe(50_00);
    const list = await ctx.http.get(`/v1/orgs/${m.orgId}/payment-qr`).set(bearer(m.owner.token)).expect(200);
    expect(list.body.items[0].status).toBe('consumed');
  });

  it('keeps a free-amount QR reusable and requires the amount', async () => {
    const m = await merchant();
    const p = await payer(50_00);
    const qr = (await createQr(m.owner, m.orgId, { currency: 'USD' }).expect(201)).body;
    const missing = await pay(p, qr.payload).expect(400);
    expect(missing.body.error.details.reason).toBe('amount_required');
    await pay(p, qr.payload, { amountMinor: 3_00 }).expect(200);
    await pay(p, qr.payload, { amountMinor: 4_00 }).expect(200);
    expect(await balance(p)).toBe(43_00);
    expect(await orgBalance(m.orgId)).toBe(7_00);
  });

  it('refuses without a PIN, with a wrong PIN (counted) and while locked, without touching balances', async () => {
    const m = await merchant();
    const qr = await fixedQr(m, 5_00, { singleUse: false });
    const noPin = await user();
    await ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(noPin.token)).send({ clientId: randomUUID(), amountMinor: 20_00, currency: 'USD' }).expect(201);
    const absent = await pay(noPin, qr.payload).expect(409);
    expect(absent.body.error.details.reason).toBe('pin_not_set');

    const p = await payer(20_00);
    for (let i = 0; i < 3; i += 1) {
      const bad = await pay(p, qr.payload, { pin: '000001' }).expect(403);
      expect(bad.body.error.details).toEqual({ reason: 'pin_invalid', attemptsRemaining: 2 - i });
    }
    const locked = await pay(p, qr.payload).expect(423);
    expect(locked.body.error.details.reason).toBe('pin_locked');
    expect(Date.parse(locked.body.error.details.lockedUntil)).toBeGreaterThan(Date.now());
    expect(await balance(p)).toBe(20_00);
    expect(await orgBalance(m.orgId)).toBe(0);
    const row = await ctx.sql.query(`SELECT locked_until FROM payment_pins WHERE user_id = $1`, [p.id]);
    expect(row.rows[0].locked_until).not.toBeNull();
  });

  it('refuses a replayed clientId with another amount or another QR instead of returning the first transfer', async () => {
    const m = await merchant();
    const p = await payer(50_00);
    const open = (await createQr(m.owner, m.orgId, { currency: 'USD' }).expect(201)).body;
    const clientId = randomUUID();
    await pay(p, open.payload, { clientId, amountMinor: 3_00 }).expect(200);
    const again = await pay(p, open.payload, { clientId, amountMinor: 3_00 }).expect(200);
    expect(again.body.replayed).toBe(true);
    const other = await pay(p, open.payload, { clientId, amountMinor: 9_00 }).expect(409);
    expect(other.body.error.details.reason).toBe('idempotency_mismatch');
    const m2 = await merchant();
    const open2 = (await createQr(m2.owner, m2.orgId, { currency: 'USD' }).expect(201)).body;
    await pay(p, open2.payload, { clientId, amountMinor: 3_00 }).expect(409);
    expect(await balance(p)).toBe(47_00);
    expect(await orgBalance(m2.orgId)).toBe(0);
  });

  it('refuses insufficient funds without consuming the QR, then accepts once funded', async () => {
    const m = await merchant();
    const p = await payer(5_00);
    const qr = await fixedQr(m, 10_00);
    const refused = await pay(p, qr.payload).expect(409);
    expect(refused.body.error.details.reason).toBe('insufficient_funds');
    expect((await ctx.sql.query(`SELECT consumed_at FROM payment_qr_codes WHERE id = $1`, [qr.qrId])).rows[0].consumed_at).toBeNull();
    await ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(p.token)).send({ clientId: randomUUID(), amountMinor: 20_00, currency: 'USD' }).expect(201);
    await pay(p, qr.payload).expect(200);
    expect(await orgBalance(m.orgId)).toBe(10_00);
  });

  it('refuses expired and revoked QR codes without consulting the PIN', async () => {
    const m = await merchant();
    const p = await payer(20_00);
    const qr = await fixedQr(m, 5_00, { singleUse: false });
    const signer = ctx.app.get(QrSigner);
    const expired = signer.sign({ orgId: m.orgId, qrId: qr.qrId, amountMinor: 5_00, currency: 'USD', expiresAtSec: Math.floor(Date.now() / 1000) - 1 });
    expect((await pay(p, expired, { pin: '000001' }).expect(400)).body.error.details.reason).toBe('expired');
    await ctx.http.delete(`/v1/orgs/${m.orgId}/payment-qr/${qr.qrId}`).set(bearer(m.owner.token)).expect(204);
    expect((await pay(p, qr.payload, { pin: '000001' }).expect(400)).body.error.details.reason).toBe('revoked');
    expect((await pay(p, `${qr.payload}x`).expect(400)).body.error.details.reason).toBe('invalid_qr');
    expect((await ctx.sql.query(`SELECT failed_count FROM payment_pins WHERE user_id = $1`, [p.id])).rows[0].failed_count).toBe(0);
    expect(await balance(p)).toBe(20_00);
  });

  it('refuses a QR of a suspended organisation', async () => {
    const m = await merchant();
    const p = await payer(20_00);
    const qr = await fixedQr(m, 5_00);
    await ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [m.orgId]);
    expect((await resolve(p, qr.payload).expect(400)).body.error.details.reason).toBe('invalid_qr');
    await pay(p, qr.payload).expect(400);
    expect(await balance(p)).toBe(20_00);
  });

  it('lets only one of two parallel payments of a single-use QR through', async () => {
    const m = await merchant();
    const [p1, p2] = [await payer(20_00), await payer(20_00)];
    const qr = await fixedQr(m, 5_00);
    const results = await Promise.all([pay(p1, qr.payload), pay(p2, qr.payload)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await orgBalance(m.orgId)).toBe(5_00);
  });
});

describe('re-displaying a QR', () => {
  it('returns the same signed payload, with the creation rights; revoked or foreign QR is a 404', async () => {
    const m = await merchant();
    const other = await merchant();
    const created = await createQr(m.finance, m.orgId, { currency: 'USD', amountMinor: 500 }).expect(201);
    const url = `/v1/orgs/${m.orgId}/payment-qr/${created.body.qrId}`;
    const got = await ctx.http.get(url).set(bearer(m.owner.token)).expect(200);
    expect(got.body).toEqual({ payload: created.body.payload });
    await resolve(await user(), got.body.payload).expect(200);
    await ctx.http.get(url).set(bearer(m.employee.token)).expect(403);
    await ctx.http.get(url).expect(401);
    await ctx.http.get(`/v1/orgs/${other.orgId}/payment-qr/${created.body.qrId}`).set(bearer(other.owner.token)).expect(404);
    await ctx.http.get(`/v1/orgs/${m.orgId}/payment-qr/nope`).set(bearer(m.owner.token)).expect(404);
    await ctx.http.delete(url).set(bearer(m.owner.token)).expect(204);
    await ctx.http.get(url).set(bearer(m.owner.token)).expect(404);
  });
});

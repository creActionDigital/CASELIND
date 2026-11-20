import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CaselindConsentRequiredError,
  CaselindClient,
  CaselindNotDeclaredError,
  CaselindQuotaError,
  CaselindWebhookError,
  checkManifest,
  parseWebhookEvent,
  verifyWebhook,
} from './index.js';

type Answer = { status?: number; json?: unknown; headers?: Record<string, string> };
function fakeFetch(answers: Answer[]) {
  const calls: { url: URL; method: string; body: unknown }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const a = answers.shift() ?? { status: 500, json: {} };
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status ?? 200, headers: a.headers });
  }) as typeof fetch;
  return { impl, calls };
}
const options = { baseUrl: 'https://api.example.test', clientId: 'cl_abc', redirectUri: 'https://app.example.test/cb' };
const live = { accessToken: 'cla_A', refreshToken: 'clr_A', expiresAt: Date.now() + 600_000, scopes: ['notify' as const] };
const err = (status: number, code: string, details?: unknown, headers?: Record<string, string>): Answer => ({ status, json: { error: { code, message: code, details } }, headers });

const secret = 'whsec_test';
const body = JSON.stringify({ id: 'e1', event: 'payment.confirmed', createdAt: '2026-01-01T00:00:00.000Z', appId: 'a1', data: { sub: 'sub_x', paymentRequestId: 'p', clientRef: 'c', amountMinor: 100, currency: 'USD' } });
const sign = (ts: string, b = body) => createHmac('sha256', secret).update(`${ts}.${b}`).digest('hex');
const nowSec = 1_800_000_000;
const now = () => nowSec * 1000;

describe('verifyWebhook', () => {
  const headers = (ts = String(nowSec), sig = sign(ts)) => ({ 'X-Caselind-Timestamp': ts, 'X-Caselind-Signature': sig });
  it('accepts a good delivery (any header case) and returns the typed event', async () => {
    const e = await verifyWebhook(body, headers(), secret, 300, now);
    expect(e.event).toBe('payment.confirmed');
    if (e.event === 'payment.confirmed') expect(e.data.amountMinor).toBe(100);
    const lower = { 'x-caselind-timestamp': String(nowSec), 'x-caselind-signature': sign(String(nowSec)) };
    await expect(verifyWebhook(body, lower, secret, 300, now)).resolves.toMatchObject({ id: 'e1' });
    await expect(verifyWebhook(body, new Headers(lower), secret, 300, now)).resolves.toMatchObject({ id: 'e1' });
  });
  it('refuses a wrong secret, a tampered body, a stale or future timestamp and missing headers', async () => {
    const reason = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as CaselindWebhookError).reason;
    expect(await reason(verifyWebhook(body, headers(), 'whsec_other', 300, now))).toBe('bad_signature');
    expect(await reason(verifyWebhook(body.replace('100', '999'), headers(), secret, 300, now))).toBe('bad_signature');
    expect(await reason(verifyWebhook(body, headers(String(nowSec - 301)), secret, 300, now))).toBe('stale_timestamp');
    expect(await reason(verifyWebhook(body, headers(String(nowSec + 301)), secret, 300, now))).toBe('stale_timestamp');
    expect(await reason(verifyWebhook(body, headers('abc', 'x'), secret, 300, now))).toBe('stale_timestamp');
    expect(await reason(verifyWebhook(body, {}, secret, 300, now))).toBe('missing_header');
    expect(await reason(verifyWebhook(body, headers(String(nowSec), 'a'.repeat(64)), secret, 300, now))).toBe('bad_signature');
    await expect(verifyWebhook(body, headers(String(nowSec - 301)), secret, 600, now)).resolves.toBeDefined(); // wider tolerance
  });
  it('rejects non-events', () => {
    expect(() => parseWebhookEvent('nope')).toThrow(CaselindWebhookError);
    expect(() => parseWebhookEvent('{"id":"x","event":"order.created","appId":"a","data":{"sub":"s"}}')).toThrow(CaselindWebhookError);
    expect(parseWebhookEvent('{"id":"x","event":"ping","appId":"a","data":{"sub":"s","ping":true}}').event).toBe('ping');
  });
});

describe('manifest', () => {
  const m = {
    dataAccessed: [{ scope: 'profile.basic', purpose: 'Afficher votre nom', retention: '30 jours' }],
    endpoints: [{ method: 'GET', path: '/v1/miniapp-api/me' }],
    events: ['authorization.revoked'],
    costs: { model: 'free', description: 'Gratuit', maxAmountMinor: null, currency: null },
    termsUrl: 'https://a.example.test/t',
    privacyUrl: 'https://a.example.test/p',
    supportEmail: 'a@example.test',
    dataLocation: 'UE',
  };
  it('validates locally with the shared rules', () => {
    expect(checkManifest(m, ['profile.basic'])).toEqual([]);
    expect(checkManifest({ ...m, termsUrl: 'http://x.test' }, ['profile.basic']).length).toBeGreaterThan(0);
    expect(checkManifest(m, ['profile.basic', 'notify']).map((p) => p.message).join()).toContain('notify');
  });
});

describe('client: payments, notify, retries, typed errors', () => {
  it('generates one clientRef per payment (reused on a retry) and runs the PIN flow to its outcome', async () => {
    const pending = { id: 'r1', status: 'pending' };
    const f = fakeFetch([err(429, 'rate_limited', undefined, { 'retry-after': '2' }), { status: 201, json: pending }, { json: { ...pending, status: 'declined' } }]);
    const slept: number[] = [];
    const client = new CaselindClient({ ...options, fetch: f.impl, sleep: async (ms) => void slept.push(ms) });
    client.setTokens({ ...live, scopes: ['wallet.pay' as never] });
    const seen: string[] = [];
    const out = await client.requestPayment({ amountMinor: 500, currency: 'USD' }, { onPending: (r) => void seen.push(r.status), intervalMs: 1, sleep: async () => undefined });
    expect(out.status).toBe('declined');
    expect(seen).toEqual(['pending']);
    expect(slept).toEqual([2000]); // honoured Retry-After
    const first = (f.calls[0]!.body as { clientRef: string }).clientRef;
    expect(first).toMatch(/[0-9a-f-]{36}/);
    expect((f.calls[1]!.body as { clientRef: string }).clientRef).toBe(first); // the retry is idempotent
  });

  it('does not wait for a long Retry-After nor retry a daily notification quota', async () => {
    const f = fakeFetch([err(429, 'rate_limited', undefined, { 'retry-after': '120' }), err(429, 'rate_limited', { reason: 'notify_quota', scope: 'user' }, { 'retry-after': '3600' })]);
    const client = new CaselindClient({ ...options, fetch: f.impl, sleep: async () => undefined });
    client.setTokens(live);
    await expect(client.me()).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 120 });
    const q = await client.notify({ title: 'a', body: 'b' }).catch((e: unknown) => e);
    expect(q).toBeInstanceOf(CaselindQuotaError);
    expect((q as CaselindQuotaError).scope).toBe('user');
    expect(f.calls).toHaveLength(2);
  });

  it('types not_declared and consent_required errors', async () => {
    const f = fakeFetch([
      err(403, 'forbidden', { reason: 'not_declared' }),
      err(403, 'forbidden'),
      { json: { delivered: true, remainingToday: 4 } },
    ]);
    const client = new CaselindClient({ ...options, fetch: f.impl });
    client.setTokens(live);
    expect(await client.me().catch((e: unknown) => e)).toBeInstanceOf(CaselindNotDeclaredError);
    expect(await client.orders().catch((e: unknown) => e)).toBeInstanceOf(CaselindConsentRequiredError);
    expect(await client.notify({ title: 'Bonjour', body: 'Salut' })).toEqual({ delivered: true, remainingToday: 4 });
    expect(f.calls[2]).toMatchObject({ method: 'POST', body: { title: 'Bonjour', body: 'Salut' } });
    expect(f.calls[2]!.url.pathname).toBe('/v1/miniapp-api/notify');
  });

  it('shares one refresh between concurrent calls, reports rotated tokens, and asks for consent after a revocation', async () => {
    const tokens = { access_token: 'cla_B', token_type: 'Bearer', expires_in: 900, refresh_token: 'clr_B', scope: 'profile.basic' };
    const f = fakeFetch([{ json: tokens }, { json: { id: 's' } }, { json: { id: 's' } }]);
    const saved: string[] = [];
    const client = new CaselindClient({ ...options, fetch: f.impl, onTokens: (t) => void saved.push(t.refreshToken) });
    client.setTokens({ ...live, expiresAt: Date.now() - 1 });
    await Promise.all([client.me(), client.me()]);
    expect(f.calls.filter((c) => c.url.pathname === '/v1/oauth/token')).toHaveLength(1);
    expect(saved).toEqual(['clr_B']);

    const g = fakeFetch([err(400, 'validation_failed', { error: 'invalid_grant' })]);
    const revoked = new CaselindClient({ ...options, fetch: g.impl });
    revoked.setTokens({ ...live, expiresAt: Date.now() - 1 });
    expect(await revoked.me().catch((e: unknown) => e)).toBeInstanceOf(CaselindConsentRequiredError);
    expect(revoked.tokens).toBeNull();
  });
});

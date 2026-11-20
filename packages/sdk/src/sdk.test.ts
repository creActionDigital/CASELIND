import { describe, expect, it } from 'vitest';
import { CaselindApiError, CaselindClient, CaselindRateLimitError, codeChallengeS256, generateCodeVerifier, generateState } from './index.js';

type Call = { url: URL; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(answers: Array<{ status?: number; json?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const a = answers.shift() ?? { status: 500, json: {} };
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status ?? 200, headers: a.headers });
  }) as typeof fetch;
  return { impl, calls };
}

const tokenBody = { access_token: 'cla_A', token_type: 'Bearer', expires_in: 900, refresh_token: 'clr_A', scope: 'profile.basic wallet.pay' };
const options = { baseUrl: 'https://api.example.test/', clientId: 'cl_abc', redirectUri: 'https://app.example.test/cb' };

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    expect(await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generates verifiers and states the API accepts', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(generateCodeVerifier()).not.toBe(v);
    expect(generateState().length).toBeGreaterThanOrEqual(8);
  });
});

describe('CaselindClient', () => {
  it('builds the authorization URL with S256 and a state', async () => {
    const client = new CaselindClient({ ...options, fetch: fakeFetch([]).impl });
    const p = await client.beginAuthorization(['profile.basic', 'wallet.pay']);
    const u = new URL(p.url);
    expect(u.origin + u.pathname).toBe('https://api.example.test/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cl_abc',
      redirect_uri: 'https://app.example.test/cb',
      scope: 'profile.basic wallet.pay',
      state: p.state,
      code_challenge: await codeChallengeS256(p.codeVerifier),
      code_challenge_method: 'S256',
    });
  });

  it('exchanges the code, checks the state, then calls resources with the bearer token', async () => {
    const f = fakeFetch([{ json: tokenBody }, { json: { id: 'u1', displayName: 'A', handle: 'a', avatarUrl: null } }]);
    const client = new CaselindClient({ ...options, clientSecret: 'cls_s', fetch: f.impl });
    const pending = await client.beginAuthorization(['profile.basic']);
    await expect(client.completeAuthorization(`https://app.example.test/cb?code=c&state=other`, pending)).rejects.toBeInstanceOf(CaselindApiError);
    const tokens = await client.completeAuthorization(`https://app.example.test/cb?code=thecode&state=${pending.state}`, pending);
    expect(tokens).toMatchObject({ accessToken: 'cla_A', refreshToken: 'clr_A', scopes: ['profile.basic', 'wallet.pay'] });
    expect(f.calls[0]).toMatchObject({ method: 'POST', body: { grant_type: 'authorization_code', code: 'thecode', code_verifier: pending.codeVerifier, client_id: 'cl_abc', client_secret: 'cls_s', redirect_uri: 'https://app.example.test/cb' } });
    expect(f.calls[0]!.url.toString()).toBe('https://api.example.test/v1/oauth/token');

    expect((await client.me()).handle).toBe('a');
    expect(f.calls[1]!.headers.authorization).toBe('Bearer cla_A');
    expect(f.calls[1]!.url.pathname).toBe('/v1/miniapp-api/me');
  });

  it('refreshes an expired token before the call and once after a 401', async () => {
    const f = fakeFetch([
      { json: { ...tokenBody, access_token: 'cla_B', refresh_token: 'clr_B' } },
      { json: { items: [], nextCursor: null } },
      { status: 401, json: { error: { code: 'unauthenticated', message: 'expired' } } },
      { json: { ...tokenBody, access_token: 'cla_C', refresh_token: 'clr_C' } },
      { json: { items: [], nextCursor: null } },
    ]);
    const client = new CaselindClient({ ...options, fetch: f.impl });
    client.setTokens({ accessToken: 'cla_A', refreshToken: 'clr_A', expiresAt: Date.now() - 1, scopes: ['orders.read'] });
    await client.orders({ limit: 5 });
    expect(f.calls[0]!.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'clr_A' });
    expect(f.calls[1]!.headers.authorization).toBe('Bearer cla_B');
    expect(f.calls[1]!.url.searchParams.get('limit')).toBe('5');
    await client.orders();
    expect(f.calls[3]!.body).toMatchObject({ refresh_token: 'clr_B' });
    expect(f.calls[4]!.headers.authorization).toBe('Bearer cla_C');
  });

  it('types a 429 with its Retry-After and other failures with their code', async () => {
    const f = fakeFetch([
      { status: 429, json: { error: { code: 'rate_limited', message: 'Application rate limit exceeded' } }, headers: { 'retry-after': '17' } },
      { status: 403, json: { error: { code: 'forbidden', message: 'The token does not carry the required scope' } } },
    ]);
    const client = new CaselindClient({ ...options, maxRetries: 0, fetch: f.impl });
    client.setTokens({ accessToken: 'cla_A', refreshToken: 'clr_A', expiresAt: Date.now() + 600_000, scopes: [] });
    const err = await client.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaselindRateLimitError);
    expect((err as CaselindRateLimitError).retryAfterSeconds).toBe(17);
    const denied = await client.orders().catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(CaselindApiError);
    expect(denied).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('opens a payment request and waits until the user decides', async () => {
    const pending = { id: 'r1', status: 'pending' };
    const f = fakeFetch([{ status: 201, json: pending }, { json: pending }, { json: { ...pending, status: 'paid' } }]);
    const client = new CaselindClient({ ...options, fetch: f.impl });
    client.setTokens({ accessToken: 'cla_A', refreshToken: 'clr_A', expiresAt: Date.now() + 600_000, scopes: ['wallet.pay'] });
    await client.createPaymentRequest({ clientRef: 'o-1', amountMinor: 1200, currency: 'USD' });
    expect(f.calls[0]).toMatchObject({ method: 'POST', body: { clientRef: 'o-1', amountMinor: 1200, currency: 'USD' } });
    const sleeps: number[] = [];
    const done = await client.waitForPayment('r1', { intervalMs: 5, sleep: async (ms) => void sleeps.push(ms) });
    expect(done.status).toBe('paid');
    expect(sleeps).toEqual([5]);
  });
});

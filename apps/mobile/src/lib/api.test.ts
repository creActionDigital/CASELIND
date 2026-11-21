import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiRequestError, createApiClient, shouldRetry } from './api';

const pair = (n: number) => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
  refreshToken: `refresh-token-number-${n}-xxxxxxxxxx`,
  refreshTokenExpiresAt: '2030-02-01T00:00:00.000Z',
  sessionId: '3f2b8c1e-9a4d-4b6e-8f0a-1c2d3e4f5a6b',
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const unauth = () => json(401, { error: { code: 'unauthenticated', message: 'no' } });

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  const hooks = {
    getRefreshToken: vi.fn(async () => 'refresh-token-number-0-xxxxxxxxxx'),
    onTokens: vi.fn(),
    onSignedOut: vi.fn(),
  };
  const client = createApiClient({ baseUrl: 'http://api.test/v1', hooks, fetchImpl: fetchImpl as unknown as typeof fetch });
  client.setAccessToken('access-0');
  return { client, fetchImpl, hooks };
}

describe('api client', () => {
  it('403 account_suspended : signale la restriction sans rafraîchir ni déconnecter', async () => {
    const { fetchImpl, hooks } = setup(() => json(403, { error: { code: 'account_suspended', message: 'no' } }));
    const onSuspended = vi.fn();
    const c = createApiClient({ baseUrl: 'http://api.test/v1', hooks: { ...hooks, onSuspended }, fetchImpl: fetchImpl as unknown as typeof fetch });
    c.setAccessToken('access-0');
    await expect(c.request('/me')).rejects.toMatchObject({ status: 403, code: 'account_suspended' });
    expect(onSuspended).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(hooks.onSignedOut).not.toHaveBeenCalled();
  });

  it('10 concurrent 401 requests trigger a single /auth/refresh', async () => {
    const { client, fetchImpl, hooks } = setup(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 20));
        return json(200, pair(1));
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer access-1' ? json(200, { ok: true }) : unauth();
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => client.request('/me', { schema: z.object({ ok: z.boolean() }) })),
    );
    expect(results).toHaveLength(10);
    const refreshCalls = fetchImpl.mock.calls.filter(([u]) => u.endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    expect(hooks.onTokens).toHaveBeenCalledTimes(1);
    expect(hooks.onSignedOut).not.toHaveBeenCalled();
  });

  it('signs out locally when the refresh is rejected', async () => {
    const { client, hooks } = setup((url) =>
      url.endsWith('/auth/refresh')
        ? json(401, { error: { code: 'refresh_token_invalid', message: 'x' } })
        : unauth(),
    );
    await expect(client.request('/me')).rejects.toMatchObject({ code: 'refresh_token_invalid' });
    expect(hooks.onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('keeps the session on a network error during refresh', async () => {
    const { client, hooks } = setup((url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('offline');
      return unauth();
    });
    await expect(client.request('/me')).rejects.toMatchObject({ code: 'network_error' });
    expect(hooks.onSignedOut).not.toHaveBeenCalled();
  });

  it('retries only once and exposes the error envelope', async () => {
    const { client, fetchImpl } = setup((url) => (url.endsWith('/auth/refresh') ? json(200, pair(1)) : unauth()));
    await expect(client.request('/me')).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchImpl.mock.calls.filter(([u]) => u.endsWith('/me'))).toHaveLength(2);
  });

  it('does not refresh on other 401 codes and parses details', async () => {
    const { client, fetchImpl } = setup(() =>
      json(423, { error: { code: 'account_locked', message: 'x', details: { lockedUntil: 'z' } } }),
    );
    const err = await client.request('/auth/login', { method: 'POST', body: {}, auth: false }).catch((e) => e);
    expect(err.code).toBe('account_locked');
    expect(err.detail('lockedUntil')).toBe('z');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects responses that violate the schema', async () => {
    const { client } = setup(() => json(200, { ok: 'nope' }));
    await expect(client.request('/me', { schema: z.object({ ok: z.boolean() }) })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('shouldRetry', () => {
  it('ne réessaie jamais une 4xx, une fois sinon', () => {
    expect(shouldRetry(0, new ApiRequestError(404, 'not_found', 'x'))).toBe(false);
    expect(shouldRetry(0, new ApiRequestError(403, 'forbidden', 'x'))).toBe(false);
    expect(shouldRetry(0, new ApiRequestError(503, 'unavailable', 'x'))).toBe(true);
    expect(shouldRetry(0, new TypeError('Network request failed'))).toBe(true);
    expect(shouldRetry(1, new TypeError('Network request failed'))).toBe(false);
  });
});

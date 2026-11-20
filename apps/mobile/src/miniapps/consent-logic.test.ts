import { describe, expect, it } from 'vitest';
import { costCap, deniedRedirect, isSafeRedirect, manifestOf, parseConsentParams } from './consent-logic';

const good = {
  client_id: 'cl_abc',
  redirect_uri: 'https://app.example.test/callback',
  scope: 'profile.basic wallet.pay',
  state: 'state-12345678',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
};

describe('parseConsentParams', () => {
  it('accepts a complete PKCE S256 link', () => {
    const r = parseConsentParams(good);
    expect(r).toEqual({ ok: true, value: { clientId: 'cl_abc', redirectUri: good.redirect_uri, scopes: ['profile.basic', 'wallet.pay'], state: good.state, codeChallenge: good.code_challenge } });
  });
  it('refuses a missing PKCE, a plain method, a short state, unknown scopes and unsafe redirects', () => {
    const err = (o: Record<string, string | undefined>) => {
      const r = parseConsentParams({ ...good, ...o });
      return r.ok ? null : r.error;
    };
    expect(err({ code_challenge: undefined })).toBe('code_challenge');
    expect(err({ code_challenge: 'short' })).toBe('code_challenge');
    expect(err({ code_challenge_method: 'plain' })).toBe('code_challenge_method');
    expect(err({ code_challenge_method: undefined })).toBe('code_challenge_method');
    expect(err({ state: 'abc' })).toBe('state');
    expect(err({ scope: 'admin.all' })).toBe('scope');
    expect(err({ scope: '' })).toBe('scope');
    expect(err({ client_id: '' })).toBe('client_id');
    for (const redirect_uri of ['http://app.example.test/cb', 'javascript:alert(1)', 'https://u:p@a.test/cb', 'https://a.test/cb#x', 'https://a.test/*', '//evil.test']) {
      expect(err({ redirect_uri })).toBe('redirect_uri');
    }
  });
  it('dedupes scopes and takes the first value of repeated parameters', () => {
    const r = parseConsentParams({ ...good, scope: 'notify notify', client_id: ['cl_a', 'cl_b'] });
    expect(r.ok && r.value).toMatchObject({ scopes: ['notify'], clientId: 'cl_a' });
  });
});

describe('redirects and manifest helpers', () => {
  it('builds the access_denied return with the received state', () => {
    const u = new URL(deniedRedirect('https://app.example.test/callback?x=1', 'state-12345678'));
    expect(u.searchParams.get('error')).toBe('access_denied');
    expect(u.searchParams.get('state')).toBe('state-12345678');
    expect(u.searchParams.get('x')).toBe('1');
    expect(isSafeRedirect('https://app.example.test/callback')).toBe(true);
  });
  it('reads a manifest and its cost cap, or null', () => {
    expect(manifestOf({})).toBeNull();
    expect(manifestOf(null)).toBeNull();
    const m = manifestOf({
      dataAccessed: [],
      endpoints: [],
      events: [],
      costs: { model: 'per_use', description: 'x', maxAmountMinor: 500, currency: 'USD' },
      termsUrl: 'https://a.test/t',
      privacyUrl: 'https://a.test/p',
      supportEmail: 'a@a.test',
      dataLocation: 'UE',
    });
    expect(m && costCap(m)).toEqual({ amountMinor: 500, currency: 'USD' });
  });
});

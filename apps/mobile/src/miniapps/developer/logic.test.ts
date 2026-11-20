import { describe, expect, it } from 'vitest';
import { addedScopes, errorRatePercent, isSemver, parseRedirectUris, suggestNextVersion, toggleScope, usagePoints, validateAppForm } from './logic';

describe('versions', () => {
  it('validates semver MAJEUR.MINEUR.CORRECTIF only', () => {
    expect(isSemver('1.2.3')).toBe(true);
    expect(isSemver(' 10.0.0 ')).toBe(true);
    for (const bad of ['1.2', '1.2.3-beta', 'v1.2.3', '1.2.3.4', '']) expect(isSemver(bad)).toBe(false);
  });

  it('suggests the next patch of the highest version, numerically', () => {
    expect(suggestNextVersion([])).toBe('1.0.0');
    expect(suggestNextVersion(['1.0.0', '1.10.2', '1.9.9'])).toBe('1.10.3');
    expect(suggestNextVersion(['junk'])).toBe('1.0.0');
  });

  it('lists the scopes that force a new consent', () => {
    expect(addedScopes(['profile.basic'], ['profile.basic', 'orders.read'])).toEqual(['orders.read']);
    expect(addedScopes(['profile.basic', 'orders.read'], ['profile.basic'])).toEqual([]);
  });
});

describe('application form', () => {
  const ok = { name: 'Mon app', launchUrl: 'https://a.example.test/', redirectUris: 'https://a.example.test/cb', scopes: ['profile.basic' as const] };

  it('accepts a valid form and reports the first error otherwise', () => {
    expect(validateAppForm(ok)).toBeNull();
    expect(validateAppForm({ ...ok, name: ' a ' })).toBe('name');
    expect(validateAppForm({ ...ok, launchUrl: 'http://a.example.test/' })).toBe('launchUrl');
    expect(validateAppForm({ ...ok, redirectUris: '' })).toBe('redirectUris');
    expect(validateAppForm({ ...ok, redirectUris: 'https://a.example.test/*' })).toBe('redirectUris');
    expect(validateAppForm({ ...ok, redirectUris: 'https://x.test/#frag' })).toBe('redirectUris');
    expect(validateAppForm({ ...ok, scopes: [] })).toBe('scopes');
  });

  it('splits redirect URIs on spaces, commas and lines without duplicates', () => {
    expect(parseRedirectUris('https://a.test/1, https://a.test/2\nhttps://a.test/1')).toEqual(['https://a.test/1', 'https://a.test/2']);
  });

  it('toggles scopes keeping the canonical order', () => {
    expect(toggleScope(['orders.read'], 'profile.basic')).toEqual(['profile.basic', 'orders.read']);
    expect(toggleScope(['profile.basic', 'orders.read'], 'profile.basic')).toEqual(['orders.read']);
  });
});

describe('statistics', () => {
  const items = [
    { day: '2026-11-18', authorizations: 1, activeUsers: 1, apiCalls: 10, paymentRequests: 0, paymentsConfirmed: 0, errors: 1 },
    { day: '2026-11-19', authorizations: 0, activeUsers: 2, apiCalls: 30, paymentRequests: 2, paymentsConfirmed: 1, errors: 3 },
  ];

  it('maps a series to chart points', () => {
    expect(usagePoints(items, 'apiCalls')).toEqual([{ day: '2026-11-18', value: 10 }, { day: '2026-11-19', value: 30 }]);
  });

  it('computes the error rate without dividing by zero', () => {
    expect(errorRatePercent(4, 40)).toBe(10);
    expect(errorRatePercent(0, 0)).toBe(0);
    expect(errorRatePercent(9, 3)).toBe(100);
  });
});

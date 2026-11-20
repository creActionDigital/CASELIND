import { describe, expect, it } from 'vitest';
import { manifestNeedsReconsent, readManifest, splitRevenue, undeclaredLinks, validateManifest } from '@caselind/contracts';
import { monthStartOf, previousMonthStart } from './miniapp-revenue.service.js';
import { Reflector } from '@nestjs/core';
import { AdminMiniAppVersionsController } from './miniapp-dev.controller.js';
import { appSubject, assertIndependentReviewer } from './miniapps.shared.js';

const manifest = (over: Record<string, unknown> = {}) => ({
  dataAccessed: [{ scope: 'profile.basic', purpose: 'Afficher votre nom', retention: '30 jours' }],
  endpoints: [{ method: 'GET', path: '/v1/miniapp-api/me' }],
  events: ['authorization.revoked'],
  costs: { model: 'free', description: 'Gratuit', maxAmountMinor: null, currency: null },
  termsUrl: 'https://a.example.test/t',
  privacyUrl: 'https://a.example.test/p',
  supportEmail: 'a@example.test',
  dataLocation: 'UE',
  ...over,
});

describe('revenue split', () => {
  it('rounds half up on integers and keeps gross = platform + developer', () => {
    expect(splitRevenue(1004, 1250)).toEqual({ platformMinor: 126, developerMinor: 878 }); // 125.5 -> 126
    expect(splitRevenue(1001, 1250)).toEqual({ platformMinor: 125, developerMinor: 876 }); // 125.125 -> 125
    expect(splitRevenue(500, 1250)).toEqual({ platformMinor: 63, developerMinor: 437 }); // 62.5 -> 63
    expect(splitRevenue(999, 0)).toEqual({ platformMinor: 0, developerMinor: 999 });
    expect(splitRevenue(0, 3000)).toEqual({ platformMinor: 0, developerMinor: 0 });
    for (const [g, b] of [[1, 3000], [7, 3], [123_456_789, 2999]] as const) {
      const s = splitRevenue(g, b);
      expect(s.platformMinor + s.developerMinor).toBe(g);
    }
  });
  it('computes month boundaries in UTC', () => {
    expect(monthStartOf(new Date('2026-03-31T23:59:59Z'))).toBe('2026-03-01');
    expect(previousMonthStart(new Date('2026-01-15T00:00:00Z'))).toBe('2025-12-01');
  });
});

describe('manifest', () => {
  it('accepts a complete manifest and lists every problem otherwise', () => {
    expect(validateManifest(manifest(), ['profile.basic']).ok).toBe(true);
    const bad = validateManifest(manifest({ endpoints: [{ method: 'GET', path: '/v1/miniapp-api/orders' }], events: ['payment.declined'] }), ['profile.basic']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.map((p) => p.message).join(' | ')).toMatch(/needs scope orders.read.*needs scope wallet.pay/);
    expect(validateManifest(manifest({ unknown: 1 }), ['profile.basic']).ok).toBe(false);
    expect(validateManifest(null, ['profile.basic']).ok).toBe(false);
  });
  it('asks for a new consent when data, purpose, costs or data location change', () => {
    const a = readManifest(manifest())!;
    expect(manifestNeedsReconsent(a, a)).toBe(false);
    expect(manifestNeedsReconsent(null, a)).toBe(false);
    expect(manifestNeedsReconsent(a, readManifest(manifest({ dataLocation: 'US' }))!)).toBe(true);
    expect(manifestNeedsReconsent(a, readManifest(manifest({ costs: { model: 'per_use', description: 'x', maxAmountMinor: 100, currency: 'USD' } }))!)).toBe(true);
    expect(manifestNeedsReconsent(a, readManifest(manifest({ dataAccessed: [{ scope: 'profile.basic', purpose: 'Autre usage', retention: '30 jours' }] }))!)).toBe(true);
    expect(manifestNeedsReconsent(a, readManifest(manifest({ supportEmail: 'b@example.test' }))!)).toBe(false);
  });
});

describe('notification links', () => {
  it('finds links to hosts that are not declared', () => {
    const ok = ['a.example.test'];
    expect(undeclaredLinks('Bonjour, votre colis arrive', ok)).toEqual([]);
    expect(undeclaredLinks('Voir https://a.example.test/x', ok)).toEqual([]);
    expect(undeclaredLinks('Voir https://evil.test/x et www.evil.com', ok)).toEqual(['evil.test', 'www.evil.com']);
    expect(undeclaredLinks('contactez evil.example.com', ok)).toEqual(['evil.example.com']);
    expect(undeclaredLinks('ftp://evil.test/x', ok)).toEqual(['evil.test']);
  });
});

describe('app-scoped subject', () => {
  const env = { JWT_ACCESS_SECRET: 'x'.repeat(32) } as never;
  it('is stable, different per app and per user, and not the user id', () => {
    const s = appSubject(env, 'app-1', 'user-1');
    expect(s).toBe(appSubject(env, 'app-1', 'user-1'));
    expect(s).not.toBe(appSubject(env, 'app-2', 'user-1'));
    expect(s).not.toBe(appSubject(env, 'app-1', 'user-2'));
    expect(s).not.toContain('user-1');
    expect(appSubject({ ...(env as object), MINIAPP_SUBJECT_KEY: 'k'.repeat(20) } as never, 'app-1', 'user-1')).not.toBe(s);
  });
});

describe('liens génériques', () => {
  it('rejette tout motif hôte.tld non déclaré', () => {
    expect(undeclaredLinks('allez sur evil.ru/login ou x.tk', ['a.example.test'])).toEqual(['evil.ru', 'x.tk']);
    expect(undeclaredLinks('voir a.example.test/x', ['a.example.test'])).toEqual([]);
  });
});

describe('relecture indépendante', () => {
  const tx = (rows: unknown[]) => ({ execute: async () => ({ rows }) });
  it('refuse un membre ou créateur', async () => {
    await expect(assertIndependentReviewer(tx([{}]), 'a', 'o', 'u')).rejects.toMatchObject({ status: 403 });
    await expect(assertIndependentReviewer(tx([]), 'a', 'o', 'u')).resolves.toBeUndefined();
  });
  it('revenue-share, certify et quota sont réservés à admin', () => {
    const r = new Reflector();
    for (const m of ['certify', 'revenueShare', 'setQuota'] as const) {
      expect(r.get('caselind:roles', AdminMiniAppVersionsController.prototype[m])).toEqual(['admin']);
    }
  });
});

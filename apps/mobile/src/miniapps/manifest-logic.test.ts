import { describe, expect, it } from 'vitest';
import { checkManifestText, manifestTemplate } from './manifest-logic';

describe('manifest editor logic', () => {
  it('builds a template that follows the scopes and is refused until completed', () => {
    const t = manifestTemplate(['profile.basic', 'notify']);
    expect(t.dataAccessed.map((d) => d.scope)).toEqual(['profile.basic', 'notify']);
    expect(t.endpoints.map((e) => e.path)).toEqual(['/v1/miniapp-api/me', '/v1/miniapp-api/notify']);
    expect(t.events).not.toContain('payment.confirmed');
    expect(checkManifestText(JSON.stringify(t), ['profile.basic', 'notify']).ok).toBe(false);
  });
  it('accepts a completed manifest and reports invalid JSON and scope mismatches', () => {
    const t = manifestTemplate(['profile.basic']);
    const done = {
      ...t,
      dataAccessed: [{ scope: 'profile.basic', purpose: 'Afficher votre nom', retention: '30 jours' }],
      costs: { model: 'free', description: 'Gratuit', maxAmountMinor: null, currency: null },
      termsUrl: 'https://a.example.test/t',
      privacyUrl: 'https://a.example.test/p',
      supportEmail: 'a@example.test',
      dataLocation: 'UE',
    };
    expect(checkManifestText(JSON.stringify(done), ['profile.basic']).ok).toBe(true);
    const wrong = checkManifestText(JSON.stringify(done), ['profile.basic', 'wallet.pay']);
    expect(!wrong.ok && wrong.problems.join()).toContain('wallet.pay');
    expect(checkManifestText('{oops', ['profile.basic'])).toEqual({ ok: false, problems: ['json : invalid JSON'] });
  });
});

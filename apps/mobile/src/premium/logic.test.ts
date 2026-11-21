import { describe, expect, it } from 'vitest';
import { planPrice, plansFor, subscriptionStatusKey } from './logic';

const plan = (code: string, audience: 'user' | 'org', period: 'month' | 'year', active = true) => ({ code, audience, period, priceUsdMinor: 499, priceCdfMinor: 1_397_200, active });

describe('plans et abonnements', () => {
  it('choisit le prix selon la devise', () => {
    expect(planPrice(plan('a', 'user', 'month'), 'USD')).toBe(499);
    expect(planPrice(plan('a', 'user', 'month'), 'CDF')).toBe(1_397_200);
  });
  it('filtre par audience, ignore les plans inactifs et met le mensuel avant l’annuel', () => {
    const list = [plan('premium_year', 'user', 'year'), plan('pro_month', 'org', 'month'), plan('premium_month', 'user', 'month'), plan('x', 'user', 'month', false)];
    expect(plansFor(list, 'user').map((p) => p.code)).toEqual(['premium_month', 'premium_year']);
    expect(plansFor(list, 'org').map((p) => p.code)).toEqual(['pro_month']);
  });
  it('libellé d’état : actif, résilié en cours, expiré', () => {
    expect(subscriptionStatusKey({ status: 'active', cancelledAt: null })).toBe('mon.status.active');
    expect(subscriptionStatusKey({ status: 'active', cancelledAt: '2026-01-01T00:00:00.000Z' })).toBe('mon.status.cancelled');
    expect(subscriptionStatusKey({ status: 'expired', cancelledAt: null })).toBe('mon.status.expired');
  });
});

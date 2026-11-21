import type { SubscriptionPlan } from '@caselind/contracts';
import type { MessageKey } from '../i18n';

/** Prix d'un plan dans une devise (unités mineures). */
export const planPrice = (p: Pick<SubscriptionPlan, 'priceUsdMinor' | 'priceCdfMinor'>, currency: string): number =>
  currency === 'CDF' ? p.priceCdfMinor : p.priceUsdMinor;

export const planNameKey = (code: string): MessageKey => `mon.plan.${code}` as MessageKey;
export const planPeriodKey = (period: SubscriptionPlan['period']): MessageKey => (period === 'year' ? 'mon.plan.year' : 'mon.plan.month');

/** Libellé d'état : une résiliation qui court encore se lit « résilié, actif jusqu'à la fin ». */
export function subscriptionStatusKey(s: { status: 'active' | 'expired'; cancelledAt: string | null }): MessageKey {
  if (s.status === 'expired') return 'mon.status.expired';
  return s.cancelledAt ? 'mon.status.cancelled' : 'mon.status.active';
}

/** Plans proposés à une audience (utilisateur ou organisation), mensuel avant annuel. */
export const plansFor = (plans: readonly SubscriptionPlan[], audience: 'user' | 'org'): SubscriptionPlan[] =>
  plans.filter((p) => p.audience === audience && p.active).sort((a, b) => (a.period === b.period ? 0 : a.period === 'month' ? -1 : 1));

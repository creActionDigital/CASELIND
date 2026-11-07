import { ApiRequestError } from '../lib/api';

export type CouponReason = 'expired' | 'exhausted' | 'min_not_reached' | 'not_applicable';
const COUPON_REASONS: readonly string[] = ['expired', 'exhausted', 'min_not_reached', 'not_applicable'];

/** Clé i18n d'un refus de coupon (400 `details.reason`), ou null si l'erreur n'en est pas un. */
export function couponErrorKey(err: unknown): `checkout.coupon.${CouponReason}` | null {
  if (!(err instanceof ApiRequestError) || err.status !== 400) return null;
  const reason = err.detail<string>('reason');
  return typeof reason === 'string' && COUPON_REASONS.includes(reason) ? (`checkout.coupon.${reason as CouponReason}` as const) : null;
}

export interface StockConflict {
  reason: 'unavailable' | 'insufficient_stock';
  variantIds: string[];
}

/** Conflit de réservation au checkout (409 `details {reason, variantIds}`), ou null. */
export function stockConflict(err: unknown): StockConflict | null {
  if (!(err instanceof ApiRequestError) || err.status !== 409) return null;
  const reason = err.detail<string>('reason');
  if (reason !== 'unavailable' && reason !== 'insufficient_stock') return null;
  const ids = err.detail<unknown>('variantIds');
  return { reason, variantIds: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [] };
}

/** Code coupon cité par le serveur (`details.code`), pour désigner la boutique fautive. */
export const couponErrorCode = (err: unknown): string | null => (err instanceof ApiRequestError ? (err.detail<string>('code') ?? null) : null);

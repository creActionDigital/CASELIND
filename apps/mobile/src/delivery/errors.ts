import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { MessageKey } from '../i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export type ProofFailure = { kind: 'invalid'; remaining: number | null } | { kind: 'locked' };

/** Erreur de code de livraison : 403 `invalid_proof_code` (essais restants) ou 429 `proof_locked`. */
export function proofFailure(err: unknown): ProofFailure | null {
  if (!(err instanceof ApiRequestError)) return null;
  const reason = err.detail<string>('reason');
  if (err.status === 429 && reason === 'proof_locked') return { kind: 'locked' };
  if (err.status === 403 && reason === 'invalid_proof_code') {
    const n = err.detail<number>('remainingAttempts');
    return { kind: 'invalid', remaining: typeof n === 'number' ? n : null };
  }
  return null;
}

const ZONE_REASONS = ['zone_required', 'zone_not_found', 'zone_not_covered', 'zone_currency_unsupported'] as const;
export type ZoneReason = (typeof ZONE_REASONS)[number];

/** Refus de zone au checkout : 400 avec `details[0].reason` (le détail est un tableau). */
export function zoneRefusal(err: unknown): { reason: ZoneReason; orgId: string | null } | null {
  if (!(err instanceof ApiRequestError) || err.status !== 400 || !Array.isArray(err.details)) return null;
  const first = err.details[0] as { reason?: unknown; orgId?: unknown } | undefined;
  const reason = first?.reason;
  if (typeof reason !== 'string' || !(ZONE_REASONS as readonly string[]).includes(reason)) return null;
  return { reason: reason as ZoneReason, orgId: typeof first?.orgId === 'string' ? first.orgId : null };
}

/** Le partage de position doit s'arrêter : hors trajet ou consentement absent. */
export function isLocationStop(err: unknown): boolean {
  if (!(err instanceof ApiRequestError)) return false;
  const reason = err.detail<string>('reason');
  return (err.status === 409 && reason === 'not_in_transit') || (err.status === 403 && reason === 'location_consent_required');
}

const REASON_KEYS: Record<string, MessageKey> = {
  courier_not_eligible: 'delivery.error.courier_not_eligible',
  invalid_transition: 'delivery.error.invalid_transition',
  order_not_ready: 'delivery.error.order_not_ready',
  not_delivered: 'delivery.error.not_delivered',
  already_rated: 'delivery.error.already_rated',
  zone_limit: 'delivery.error.zone_limit',
  not_in_transit: 'delivery.error.not_in_transit',
  location_consent_required: 'delivery.error.location_consent_required',
  proof_locked: 'delivery.error.proof_locked',
  zone_required: 'delivery.error.zone_required',
  zone_not_found: 'delivery.error.zone_not_found',
  zone_not_covered: 'delivery.error.zone_not_covered',
  zone_currency_unsupported: 'delivery.error.zone_currency_unsupported',
  express_unavailable: 'courier.error.express_unavailable',
};

/** Message localisé, avec les raisons propres à la livraison ; sinon le message générique. */
export function deliveryErrorMessage(err: unknown, t: T, locale = 'fr'): string {
  if (err instanceof ApiRequestError) {
    const proof = proofFailure(err);
    if (proof?.kind === 'locked') return t('delivery.error.proof_locked');
    if (proof?.kind === 'invalid') {
      return proof.remaining === null ? t('delivery.error.invalid_proof_code') : t('delivery.error.invalid_proof_code_n', { n: proof.remaining });
    }
    const zone = zoneRefusal(err);
    if (zone) return t(REASON_KEYS[zone.reason]!);
    const reason = err.detail<string>('reason');
    if (typeof reason === 'string' && REASON_KEYS[reason]) return t(REASON_KEYS[reason]!);
  }
  return errorMessage(err, t, locale);
}

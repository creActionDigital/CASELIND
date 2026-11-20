import { proofFailure } from '../delivery/errors';
import type { MessageKey } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Un autre coursier a été plus rapide (ou la demande n'est plus proposée). */
export function isCourierRequestTaken(err: unknown): boolean {
  return err instanceof ApiRequestError && err.status === 409 && err.detail<string>('reason') === 'request_unavailable';
}

const REASON_KEYS: Record<string, MessageKey> = {
  request_unavailable: 'courier.error.request_unavailable',
  open_limit: 'courier.error.open_limit',
  courier_busy: 'courier.error.courier_busy',
  not_open_yet: 'courier.error.not_open_yet',
  courier_not_registered: 'courier.error.courier_not_registered',
  kyc_required: 'courier.error.kyc_required',
  own_request: 'courier.error.own_request',
  too_far: 'courier.error.too_far',
  same_point: 'courier.error.same_point',
  currency_unsupported: 'courier.error.currency_unsupported',
  schedule_out_of_range: 'courier.error.schedule_out_of_range',
  invalid_transition: 'courier.error.invalid_transition',
  not_delivered: 'courier.error.not_delivered',
  already_rated: 'courier.error.already_rated',
  not_in_transit: 'courier.error.not_in_transit',
  location_consent_required: 'courier.error.location_consent_required',
};

/** Raison portée par `details` (objet pour un 409/403, tableau pour un 400). */
function reasonOf(err: ApiRequestError): string | undefined {
  const direct = err.detail<string>('reason');
  if (typeof direct === 'string') return direct;
  const first = Array.isArray(err.details) ? (err.details[0] as { reason?: unknown } | undefined) : undefined;
  return typeof first?.reason === 'string' ? first.reason : undefined;
}

export function courierErrorMessage(err: unknown, t: T, locale = 'fr'): string {
  if (err instanceof ApiRequestError) {
    const proof = proofFailure(err);
    if (proof?.kind === 'locked') return t('courier.error.proof_locked');
    if (proof?.kind === 'invalid') {
      return proof.remaining === null ? t('delivery.error.invalid_proof_code') : t('delivery.error.invalid_proof_code_n', { n: proof.remaining });
    }
    const reason = reasonOf(err);
    if (reason && REASON_KEYS[reason]) return t(REASON_KEYS[reason]!);
  }
  return errorMessage(err, t, locale);
}

import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { MessageKey } from '../i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export type StartCodeFailure = { kind: 'invalid'; remaining: number | null } | { kind: 'locked' };

/** Code de départ : 403 `invalid_start_code` (essais restants) ou 429 `code_locked` (10 min). */
export function startCodeFailure(err: unknown): StartCodeFailure | null {
  if (!(err instanceof ApiRequestError)) return null;
  const reason = err.detail<string>('reason');
  if (err.status === 429 && reason === 'code_locked') return { kind: 'locked' };
  if (err.status === 403 && reason === 'invalid_start_code') {
    const n = err.detail<number>('remainingAttempts');
    return { kind: 'invalid', remaining: typeof n === 'number' ? n : null };
  }
  return null;
}

/** Un autre chauffeur a été plus rapide (ou la course n'est plus proposée). */
export function isRideTaken(err: unknown): boolean {
  return err instanceof ApiRequestError && err.status === 409 && (err.detail<string>('reason') === 'ride_unavailable' || err.code === 'ride_unavailable');
}

const REASON_KEYS: Record<string, MessageKey> = {
  ride_unavailable: 'mobility.error.ride_unavailable',
  driver_busy: 'mobility.error.driver_busy',
  out_of_range: 'mobility.error.out_of_range',
  vehicle_mismatch: 'mobility.error.vehicle_mismatch',
  driver_offline: 'mobility.error.driver_offline',
  driver_not_approved: 'mobility.error.driver_not_approved',
  kyc_required: 'mobility.error.kyc_required',
  active_ride: 'mobility.error.active_ride',
  scheduled_limit: 'mobility.error.scheduled_limit',
  schedule_out_of_range: 'mobility.error.schedule_out_of_range',
  currency_unsupported: 'mobility.error.currency_unsupported',
  ride_not_active: 'mobility.error.ride_not_active',
  ride_not_completed: 'mobility.error.ride_not_completed',
  already_rated: 'mobility.error.already_rated',
  reason_not_allowed: 'mobility.error.reason_not_allowed',
  favorites_limit: 'mobility.error.favorites_limit',
  kind_taken: 'mobility.error.kind_taken',
  invalid_transition: 'mobility.error.invalid_transition',
  own_ride: 'mobility.error.own_ride',
  code_locked: 'mobility.error.code_locked',
};

/** Message localisé avec les raisons propres à la mobilité ; sinon le message générique. */
export function mobilityErrorMessage(err: unknown, t: T, locale = 'fr'): string {
  if (err instanceof ApiRequestError) {
    const code = startCodeFailure(err);
    if (code?.kind === 'locked') return t('mobility.error.code_locked');
    if (code?.kind === 'invalid') {
      return code.remaining === null ? t('mobility.error.invalid_start_code') : t('mobility.error.invalid_start_code_n', { n: code.remaining });
    }
    const reason = err.detail<string>('reason');
    if (typeof reason === 'string' && REASON_KEYS[reason]) return t(REASON_KEYS[reason]!);
    if (REASON_KEYS[err.code]) return t(REASON_KEYS[err.code]!);
  }
  return errorMessage(err, t, locale);
}

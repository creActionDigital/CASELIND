import { ApiRequestError } from '../lib/api';
import type { MessageKey } from '../i18n';

export type WalletFailure =
  | { kind: 'insufficient_funds' }
  | { kind: 'limit_exceeded'; limitMinor?: number }
  | { kind: 'pin_invalid'; attemptsRemaining?: number }
  | { kind: 'pin_locked'; minutes?: number }
  | { kind: 'pin_not_set' }
  | { kind: 'recipient_not_found' }
  | { kind: 'account_frozen' }
  | { kind: 'self_transfer' }
  | { kind: 'idempotency_mismatch' }
  | { kind: 'other' };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Minutes restantes d'un verrouillage, d'après `retryAfterSeconds` ou `lockedUntil` si l'API les fournit. */
function lockMinutes(err: ApiRequestError, now: number): number | undefined {
  const secs = num(err.detail('retryAfterSeconds'));
  if (secs !== undefined) return Math.max(1, Math.ceil(secs / 60));
  const until = err.detail<string>('lockedUntil');
  const t = typeof until === 'string' ? Date.parse(until) : NaN;
  return Number.isNaN(t) ? undefined : Math.max(1, Math.ceil((t - now) / 60_000));
}

/**
 * Classe un refus d'envoi (`POST /wallet/transfers`) d'après `details.reason` puis le statut HTTP.
 * Le contrat 6A donne : 404 destinataire, 400 soi-même, 409 fonds/limite/pin non défini/rejeu, 403 PIN faux ou compte gelé,
 * 423 PIN verrouillé. Les détails facultatifs (`attemptsRemaining`, `limitMinor`, durée) sont lus s'ils existent.
 */
export function classifyWalletError(err: unknown, now: number = Date.now()): WalletFailure {
  if (!(err instanceof ApiRequestError)) return { kind: 'other' };
  const reason = err.detail<string>('reason');
  switch (reason) {
    case 'insufficient_funds':
      return { kind: 'insufficient_funds' };
    case 'limit_exceeded':
      return { kind: 'limit_exceeded', limitMinor: num(err.detail('limitMinor')) };
    case 'pin_not_set':
      return { kind: 'pin_not_set' };
    case 'pin_locked':
      return { kind: 'pin_locked', minutes: lockMinutes(err, now) };
    case 'pin_invalid':
      return { kind: 'pin_invalid', attemptsRemaining: num(err.detail('attemptsRemaining')) };
    case 'account_frozen':
      return { kind: 'account_frozen' };
    case 'idempotency_mismatch':
      return { kind: 'idempotency_mismatch' };
  }
  if (err.status === 423) return { kind: 'pin_locked', minutes: lockMinutes(err, now) };
  if (err.status === 404) return { kind: 'recipient_not_found' };
  if (err.status === 400 && /yourself/i.test(err.message)) return { kind: 'self_transfer' };
  if (err.status === 403) {
    return /pin/i.test(err.message)
      ? { kind: 'pin_invalid', attemptsRemaining: num(err.detail('attemptsRemaining')) }
      : { kind: 'account_frozen' };
  }
  return { kind: 'other' };
}

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Clé de message et paramètres d'un refus ; `null` pour `other` (l'appelant retombe sur `errorMessage`). */
export function failureMessage(f: WalletFailure, t: T, formatLimit: (minor: number) => string): string | null {
  switch (f.kind) {
    case 'insufficient_funds':
      return t('wallet.error.insufficient');
    case 'limit_exceeded':
      return f.limitMinor !== undefined ? t('wallet.error.limit', { limit: formatLimit(f.limitMinor) }) : t('wallet.error.limitGeneric');
    case 'pin_invalid':
      return f.attemptsRemaining !== undefined ? t('wallet.error.pinInvalid', { n: f.attemptsRemaining }) : t('wallet.error.pinInvalidGeneric');
    case 'pin_locked':
      return f.minutes !== undefined ? t('wallet.error.pinLocked', { n: f.minutes }) : t('wallet.error.pinLockedGeneric');
    case 'pin_not_set':
      return t('wallet.error.pinNotSet');
    case 'recipient_not_found':
      return t('wallet.error.recipient');
    case 'account_frozen':
      return t('wallet.error.frozen');
    case 'self_transfer':
      return t('wallet.error.self');
    case 'idempotency_mismatch':
      return t('wallet.error.idempotency');
    default:
      return null;
  }
}

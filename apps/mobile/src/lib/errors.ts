import { ApiRequestError } from './api';
import type { MessageKey } from '../i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Message utilisateur localisé pour une erreur d'API (selon `code`, jamais le `message` serveur). */
export function errorMessage(err: unknown, t: T, locale = 'fr'): string {
  if (!(err instanceof ApiRequestError)) return t('error.unknown');
  switch (err.code) {
    case 'account_locked': {
      const until = err.detail<string>('lockedUntil');
      const date = until ? new Date(until) : null;
      if (!date || Number.isNaN(date.getTime())) return t('error.account_locked_generic');
      const when = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      return t('error.account_locked', { when });
    }
    case 'otp_invalid': {
      const n = err.detail<number>('attemptsRemaining');
      return typeof n === 'number' ? t('error.otp_invalid', { n }) : t('error.otp_invalid_generic');
    }
    case 'otp_resend_too_soon': {
      const n = err.detail<number>('retryAfterSeconds');
      return t('error.otp_resend_too_soon', { n: typeof n === 'number' ? n : 30 });
    }
    default: {
      // `details.reason` (ex. contact_requests_restricted) est plus précis que le code HTTP générique.
      const reason = err.detail<string>('reason');
      const byReason = `error.${reason}`;
      if (typeof reason === 'string' && isKnown(byReason)) return t(byReason);
      const key = `error.${err.code}`;
      return isKnown(key) ? t(key) : t('error.unknown');
    }
  }
}

const KNOWN = new Set<string>([
  'error.network_error', 'error.internal_error', 'error.invalid_response', 'error.validation_failed',
  'error.invalid_credentials', 'error.account_not_verified', 'error.account_suspended', 'error.otp_expired',
  'error.rate_limited', 'error.forbidden', 'error.feature_disabled', 'error.not_found', 'error.conflict',
  'error.unauthenticated', 'error.refresh_token_invalid',
  'error.contact_requests_restricted', 'error.recall_window_elapsed', 'error.group_full', 'error.last_owner',
  'error.payload_too_large', 'error.unsupported_media_type', 'error.quota_exceeded',
]);
function isKnown(key: string): key is MessageKey {
  return KNOWN.has(key);
}

/** Délai (secondes) conseillé par un 429, pour décompte éventuel. */
export function retryAfterSeconds(err: unknown): number | null {
  if (err instanceof ApiRequestError) {
    const n = err.detail<number>('retryAfterSeconds');
    if (typeof n === 'number') return n;
  }
  return null;
}

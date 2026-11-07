import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { MessageKey } from '../i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Erreurs de `POST /auth/2fa/verify` : défi expiré (410), défi épuisé (plus d'essais), code faux.
 * `dead` = le défi ne peut plus servir : il faut se reconnecter.
 */
export function twoFactorErrorMessage(err: unknown, t: T, locale: string): { message: string; dead: boolean } {
  if (err instanceof ApiRequestError) {
    if (err.code === 'otp_expired') return { message: t('security.login.expired'), dead: true };
    if (err.code === 'otp_invalid') {
      const left = err.detail<number>('attemptsRemaining');
      if (typeof left === 'number') {
        return left <= 0
          ? { message: t('security.login.exhausted'), dead: true }
          : { message: t('security.login.wrongCode', { n: left }), dead: false };
      }
      // Sans compteur : code de secours faux, ou défi déjà consommé / épuisé.
      return { message: t('security.login.wrongOrUsed'), dead: false };
    }
  }
  return { message: errorMessage(err, t, locale), dead: false };
}

/** Erreurs de `POST /auth/qr/approve` : QR inconnu (404), expiré (410), déjà approuvé (409). */
export function qrErrorMessage(err: unknown, t: T, locale: string): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 404 || err.status === 400) return t('security.qr.invalid');
    if (err.status === 410) return t('security.qr.expired');
    if (err.status === 409) return t('security.qr.alreadyApproved');
  }
  return errorMessage(err, t, locale);
}

/** Erreurs d'activation, de désactivation de la 2FA et du changement d'identifiant. */
export function securityErrorMessage(err: unknown, t: T, locale: string): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'invalid_credentials') return t('security.error.password');
    if (err.status === 409) return t('security.error.conflict');
  }
  return errorMessage(err, t, locale);
}

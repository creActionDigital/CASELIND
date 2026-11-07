import { ApiRequestError } from '../lib/api';
import type { MessageKey } from '../i18n';
import { classifyWalletError, failureMessage } from '../wallet/errors';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export type PayFailure =
  | { kind: 'qr'; reason: 'invalid_qr' | 'expired' | 'revoked' | 'already_used' | 'amount_required' }
  | { kind: 'pin_locked'; until?: Date }
  | { kind: 'wallet' };

const QR_REASONS = ['invalid_qr', 'expired', 'revoked', 'already_used', 'amount_required'] as const;

export function classifyPayError(err: unknown): PayFailure {
  if (err instanceof ApiRequestError) {
    const reason = err.detail<string>('reason');
    const hit = QR_REASONS.find((r) => r === reason);
    if (hit) return { kind: 'qr', reason: hit };
    if (reason === 'pin_locked' || err.status === 423) {
      const u = err.detail<string>('lockedUntil');
      const d = typeof u === 'string' ? new Date(u) : null;
      return { kind: 'pin_locked', until: d && !Number.isNaN(d.getTime()) ? d : undefined };
    }
  }
  return { kind: 'wallet' };
}

/** Message traduit ; `null` si l'erreur n'est pas connue (l'appelant retombe sur `errorMessage`). */
export function payErrorMessage(err: unknown, t: T, formatMoneyMinor: (m: number) => string, formatTime: (d: Date) => string): string | null {
  const f = classifyPayError(err);
  if (f.kind === 'qr') return t(`pay.error.${f.reason}` as MessageKey);
  if (f.kind === 'pin_locked') return f.until ? t('pay.error.pinLockedUntil', { time: formatTime(f.until) }) : t('wallet.error.pinLockedGeneric');
  return failureMessage(classifyWalletError(err), t, formatMoneyMinor);
}

/** Refus du QR lui-même (retour à l'écran de scan plutôt qu'au récapitulatif). */
export const isQrRefusal = (err: unknown): boolean => {
  const f = classifyPayError(err);
  return f.kind === 'qr' && f.reason !== 'amount_required';
};

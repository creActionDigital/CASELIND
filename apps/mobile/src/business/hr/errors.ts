import type { MessageKey } from '../../i18n';
import { ApiRequestError } from '../../lib/api';
import { sellerErrorMessage } from '../../seller/ui';

type T = (k: MessageKey, p?: Record<string, string | number>) => string;

const HR_REASONS = ['leave_overlap', 'shift_overlap', 'leave_not_pending', 'leave_not_cancellable'];
const INV_REASONS = ['batch_code_taken', 'batch_insufficient', 'count_already_open', 'count_not_open'];

/** Message localisé des 409 propres aux RH et aux lots ; le reste suit les règles du vendeur (stock négatif, réseau…). */
export function businessErrorMessage(err: unknown, t: T, locale: string): string {
  if (err instanceof ApiRequestError) {
    const reason = err.detail<string>('reason');
    if (err.status === 409 && reason && HR_REASONS.includes(reason)) return t(`hr.err.${reason}` as MessageKey);
    if (err.status === 409 && reason && INV_REASONS.includes(reason)) return t(`inv.err.${reason}` as MessageKey);
    if (err.status === 403 && err.code === 'forbidden') return t('hr.err.forbidden');
  }
  return sellerErrorMessage(err, t, locale);
}

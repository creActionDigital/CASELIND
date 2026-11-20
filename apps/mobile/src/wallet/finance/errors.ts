import { ApiRequestError } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import type { MessageKey } from '../../i18n';
import { formatMoney } from '../../shop/format';
import { classifyWalletError, failureMessage } from '../errors';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

const REASONS: Record<string, MessageKey> = {
  pending_limit: 'wf.req.err.limit',
  scheduled_limit: 'wf.sch.err.limit',
  savings_limit: 'wf.sav.err.limit',
  goal_insufficient: 'wf.sav.err.insufficient',
  withdraw_first: 'wf.sav.err.withdrawFirst',
  contact_requests_restricted: 'wf.req.err.contact',
};

/** Message d'un refus de la finance du portefeuille : raisons propres, puis refus de virement (fonds, limite, PIN, gel), puis message générique. */
export function financeErrorMessage(err: unknown, t: T, locale: string, currency = 'USD'): string {
  if (err instanceof ApiRequestError) {
    const key = REASONS[err.detail<string>('reason') ?? ''];
    if (key) return t(key);
  }
  const f = classifyWalletError(err);
  return failureMessage(f, t, (m) => formatMoney(m, currency, locale)) ?? errorMessage(err, t, locale);
}

/** Le refus est-il lié au PIN (à rejouer sur l'écran du PIN plutôt que sur le formulaire) ? */
export function isPinFailure(err: unknown): boolean {
  const k = classifyWalletError(err).kind;
  return k === 'pin_invalid' || k === 'pin_locked' || k === 'pin_not_set';
}

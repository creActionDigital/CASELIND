import { ApiRequestError } from '../lib/api';
import type { MessageKey } from '../i18n';
import { sellerErrorMessage } from '../seller/ui';

type T = (k: MessageKey, p?: Record<string, string | number>) => string;

const BY_REASON: Record<string, MessageKey> = {
  supplier_name_taken: 'biz.supplier.err.taken',
  supplier_limit: 'biz.supplier.err.limit',
  supplier_inactive: 'biz.po.err.inactive',
  currency_mismatch: 'biz.po.err.currencyMismatch',
  invalid_state: 'biz.po.err.state',
  quantity_exceeds_ordered: 'biz.po.err.receiveExceeds',
};

/** Message localisé d'une erreur de l'API de gestion : les 409 connus ont leur texte, le reste passe par les messages vendeur. */
export function businessErrorMessage(err: unknown, t: T, locale: string): string {
  if (err instanceof ApiRequestError && err.status === 409) {
    const key = BY_REASON[err.detail<string>('reason') ?? ''];
    if (key) return t(key);
  }
  return sellerErrorMessage(err, t, locale);
}

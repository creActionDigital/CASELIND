import type { CreatePaymentQrRequest } from '@caselind/contracts';
import { parseWalletAmount } from '../wallet/amount';

export type QrMode = 'free' | 'fixed';
/** Durées proposées pour un QR à montant fixe (secondes ; le contrat accepte 60 à 86 400). */
export const QR_EXPIRIES = [900, 3600, 86_400] as const;

export type QrFormIssue = 'amount' | 'amount_high' | 'label';

/** Montant saisi par le client sur un QR sans montant : mêmes règles que le wallet. */
export function validateFreeAmount(input: string, currency: string): { minor: number } | { issue: 'invalid' | 'too_high' } {
  return parseWalletAmount(input, currency);
}

/** Corps de `POST /orgs/:orgId/payment-qr`, ou le problème à signaler. */
export function buildCreateQr(f: {
  mode: QrMode;
  amount: string;
  currency: string;
  label: string;
  expiresInSeconds: number;
  singleUse: boolean;
}): { body: CreatePaymentQrRequest } | { issue: QrFormIssue } {
  const label = f.label.trim();
  if (label.length > 80) return { issue: 'label' };
  const base = { currency: f.currency as CreatePaymentQrRequest['currency'], ...(label ? { label } : {}) };
  if (f.mode === 'free') return { body: base };
  const a = parseWalletAmount(f.amount, f.currency);
  if ('issue' in a) return { issue: a.issue === 'too_high' ? 'amount_high' : 'amount' };
  const exp = Math.min(86_400, Math.max(60, Math.round(f.expiresInSeconds)));
  return { body: { ...base, amountMinor: a.minor, expiresInSeconds: exp, singleUse: f.singleUse } };
}

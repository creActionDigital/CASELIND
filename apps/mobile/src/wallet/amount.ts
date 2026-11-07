import { WALLET_AMOUNT_MAX } from '@caselind/contracts';
import { parseDecimalToMinor } from '../seller/money';

export const WALLET_CURRENCIES = ['USD', 'CDF'] as const;
export type WalletCurrency = (typeof WALLET_CURRENCIES)[number];

/** Plafond d'une recharge de test, miroir du défaut serveur (100,00 USD ; ×2800 en CDF). Le serveur reste la référence. */
const TOPUP_MAX_USD_MINOR = 100_00;
export function topupMaxMinor(currency: string): number {
  return currency === 'CDF' ? TOPUP_MAX_USD_MINOR * 2800 : TOPUP_MAX_USD_MINOR;
}

export type AmountIssue = 'invalid' | 'too_high';

/** Saisie décimale -> unités mineures (réutilise la conversion du vendeur, sans flottant), avec plafond optionnel. */
export function parseWalletAmount(input: string, currency: string, max: number = WALLET_AMOUNT_MAX): { minor: number } | { issue: AmountIssue } {
  const minor = parseDecimalToMinor(input, currency);
  if (minor === null) return { issue: 'invalid' };
  return minor > max ? { issue: 'too_high' } : { minor };
}

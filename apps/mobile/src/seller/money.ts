/** Conversion saisie décimale <-> unités mineures, selon la devise (ISO 4217). Aucune arithmétique flottante. */

const DECIMALS: Record<string, number> = { USD: 2, CDF: 2, EUR: 2, XAF: 0, XOF: 0, RWF: 0, UGX: 0, JPY: 0 };

export const SELLER_CURRENCIES = ['USD', 'CDF'] as const;
export type SellerCurrency = (typeof SELLER_CURRENCIES)[number];

export function minorDigits(currency: string): number {
  return DECIMALS[currency] ?? 2;
}

/**
 * « 12,50 » ou « 12.50 » -> 1250 (USD). Renvoie null si la saisie est vide, négative, non numérique,
 * a trop de décimales pour la devise, ou donne une valeur nulle / hors plage de l'API.
 */
export function parseDecimalToMinor(input: string, currency: string): number | null {
  const s = input.trim().replace(/[\s ]/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const digits = minorDigits(currency);
  const frac = m[2] ?? '';
  if (frac.length > digits) return null;
  const minor = Number(m[1] + frac.padEnd(digits, '0'));
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > 1_000_000_000_000) return null;
  return minor;
}

/** 1250 (USD) -> « 12.50 » (pour préremplir un champ de saisie). */
export function minorToDecimalString(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const s = String(Math.abs(minor)).padStart(digits + 1, '0');
  return `${minor < 0 ? '-' : ''}${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

/** Montant lisible localisé (« 12,50 $US »). */
export function formatMinor(minor: number, currency: string, locale: string): string {
  const value = Number(minorToDecimalString(minor, currency));
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${minorToDecimalString(minor, currency)} ${currency}`;
  }
}

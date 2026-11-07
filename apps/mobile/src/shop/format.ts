/** Montants en unités mineures (centimes) : conversion selon les décimales de la devise, puis `Intl.NumberFormat`. */
export function currencyDigits(currency: string, locale = 'fr'): number {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatMoney(minor: number, currency: string, locale = 'fr'): string {
  const digits = currencyDigits(currency, locale);
  const major = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(major);
  } catch {
    return `${major.toFixed(digits)} ${currency}`;
  }
}

/** Saisie « 12,50 » ou « 12.5 » en unités mineures ; null si invalide. */
export function parseMajorToMinor(input: string, currency: string, locale = 'fr'): number | null {
  const s = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const digits = currencyDigits(currency, locale);
  return Math.round(Number(s) * 10 ** digits);
}

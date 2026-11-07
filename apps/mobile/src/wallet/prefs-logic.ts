/** Préférences locales du wallet (partie pure, sans dépendance native). */
export interface WalletPrefs {
  hidden: boolean;
  currency: string;
}

/** Montant masqué par défaut ; USD par défaut. */
export const DEFAULT_PREFS: WalletPrefs = { hidden: true, currency: 'USD' };

export function parsePrefs(raw: string | null | undefined): WalletPrefs {
  try {
    const j = raw ? (JSON.parse(raw) as Partial<WalletPrefs>) : {};
    return {
      hidden: typeof j.hidden === 'boolean' ? j.hidden : DEFAULT_PREFS.hidden,
      currency: typeof j.currency === 'string' && /^[A-Z]{3}$/.test(j.currency) ? j.currency : DEFAULT_PREFS.currency,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

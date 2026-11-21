export type ThemeMode = 'system' | 'light' | 'dark';

export interface Prefs {
  onboardingDone: boolean;
  /** Langue choisie au premier lancement (avant connexion). */
  locale: 'fr' | 'en' | 'sw' | null;
  /** Code pays ISO 3166-1 alpha-2 choisi au premier lancement. */
  country: string | null;
  theme: ThemeMode;
  /** Vrai juste après une inscription : l'accueil propose de compléter le profil une seule fois. */
  profileSetupPending: boolean;
}

export const DEFAULT_PREFS: Prefs = { onboardingDone: false, locale: null, country: null, theme: 'system', profileSetupPending: false };

/** Lecture tolérante du JSON stocké : tout champ invalide retombe sur sa valeur par défaut. */
export function parsePrefs(raw: string | null | undefined): Prefs {
  if (!raw) return DEFAULT_PREFS;
  let o: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return DEFAULT_PREFS;
    o = v as Record<string, unknown>;
  } catch {
    return DEFAULT_PREFS;
  }
  return {
    onboardingDone: o.onboardingDone === true,
    locale: o.locale === 'fr' || o.locale === 'en' || o.locale === 'sw' ? o.locale : null,
    country: typeof o.country === 'string' && /^[A-Z]{2}$/.test(o.country) ? o.country : null,
    theme: o.theme === 'light' || o.theme === 'dark' ? o.theme : 'system',
    profileSetupPending: o.profileSetupPending === true,
  };
}

/** Thème effectif : « système » suit le réglage de l'appareil. */
export const resolveDark = (mode: ThemeMode, systemIsDark: boolean): boolean => (mode === 'system' ? systemIsDark : mode === 'dark');

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePrefs } from '../prefs/store';
import { en } from './en';
import { fr, type MessageKey } from './fr';
import { sw } from './sw';

export type Locale = 'fr' | 'en' | 'sw';
export type { MessageKey };

const dictionaries: Record<Locale, Record<MessageKey, string>> = { fr, en, sw: { ...en, ...sw } as Record<MessageKey, string> };

export function isLocale(value: string): value is Locale {
  return value === 'fr' || value === 'en' || value === 'sw';
}

type Params = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  let text = dictionaries[locale][key] ?? fr[key];
  if (params) {
    // Pluriel : « mot(s) » / « mot(x) » après {k} devient singulier ou pluriel selon la valeur numérique de k (fr : 0 et 1 au singulier).
    text = text.replace(/\{(\w+)\}([^{]*)/g, (m, k: string, rest: string) => {
      const n = Number(params[k]);
      if (params[k] === undefined || params[k] === '' || !Number.isFinite(n)) return m;
      const one = locale === 'fr' ? Math.abs(n) < 2 : Math.abs(n) === 1;
      return `{${k}}${rest.replace(/\((s|x|es)\)/g, (_, suf: string) => (one ? '' : suf))}`;
    });
    for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

interface I18nValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: MessageKey, params?: Params): string;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Français par défaut ; l'anglais n'est choisi que sur demande (menu Langue) ou via le profil. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('fr');
  // Langue choisie au premier lancement, relue depuis les préférences de l'appareil.
  const prefs = usePrefs();
  useEffect(() => {
    if (prefs.loaded && prefs.locale) setLocale(prefs.locale);
  }, [prefs.loaded, prefs.locale]);
  const t = useCallback((key: MessageKey, params?: Params) => translate(locale, key, params), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

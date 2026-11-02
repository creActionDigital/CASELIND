import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en } from './en';
import { fr, type MessageKey } from './fr';

export type Locale = 'fr' | 'en';
export type { MessageKey };

const dictionaries: Record<Locale, Record<MessageKey, string>> = { fr, en };

export function isLocale(value: string): value is Locale {
  return value === 'fr' || value === 'en';
}

type Params = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  let text = dictionaries[locale][key] ?? fr[key];
  if (params) {
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
  const t = useCallback((key: MessageKey, params?: Params) => translate(locale, key, params), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

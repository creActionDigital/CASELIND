import type { Locale } from '../i18n';

/** Pays proposés au premier lancement : code ISO, nom français, nom anglais (le swahili reprend l'anglais). */
export const COUNTRIES: { code: string; fr: string; en: string }[] = [
  { code: 'CD', fr: 'RD Congo', en: 'DR Congo' },
  { code: 'CG', fr: 'Congo-Brazzaville', en: 'Congo-Brazzaville' },
  { code: 'RW', fr: 'Rwanda', en: 'Rwanda' },
  { code: 'BI', fr: 'Burundi', en: 'Burundi' },
  { code: 'UG', fr: 'Ouganda', en: 'Uganda' },
  { code: 'KE', fr: 'Kenya', en: 'Kenya' },
  { code: 'TZ', fr: 'Tanzanie', en: 'Tanzania' },
  { code: 'ZM', fr: 'Zambie', en: 'Zambia' },
  { code: 'AO', fr: 'Angola', en: 'Angola' },
  { code: 'CM', fr: 'Cameroun', en: 'Cameroon' },
  { code: 'SN', fr: 'Sénégal', en: 'Senegal' },
  { code: 'CI', fr: 'Côte d’Ivoire', en: 'Côte d’Ivoire' },
  { code: 'ZA', fr: 'Afrique du Sud', en: 'South Africa' },
  { code: 'FR', fr: 'France', en: 'France' },
  { code: 'BE', fr: 'Belgique', en: 'Belgium' },
];

export const countryName = (code: string, locale: Locale): string => {
  const c = COUNTRIES.find((x) => x.code === code);
  return c ? (locale === 'fr' ? c.fr : c.en) : code;
};

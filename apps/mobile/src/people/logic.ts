/** Logique pure du sélecteur de personnes : numéros E.164, fusion et dédoublonnage des sources, filtre. */
export interface Person {
  id?: string;
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
}

export type PersonSource = 'recent' | 'phone' | 'following' | 'followers' | 'search';

const DIAL: Record<string, string> = { CD: '243', CG: '242', RW: '250', BI: '257', UG: '256', KE: '254', TZ: '255', ZM: '260', AO: '244', FR: '33', BE: '32' };
const E164 = /^\+[1-9]\d{7,14}$/;

/** Numéro de carnet -> E.164, ou null s'il est inexploitable. Un numéro local (0…) prend l'indicatif du pays du compte. */
export function normalizePhone(raw: string, country = 'CD'): string | null {
  let s = raw.replace(/[\s().\- ]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  const dial = DIAL[country] ?? '243';
  if (!s.startsWith('+')) {
    if (!/^\d+$/.test(s)) return null;
    s = s.startsWith('0') ? `+${dial}${s.slice(1)}` : s.startsWith(dial) ? `+${s}` : `+${dial}${s}`;
  }
  return E164.test(s) ? s : null;
}

/** Numéros uniques et valides à envoyer à l'API (plafond 500). */
export function phonesToMatch(rawNumbers: string[], country?: string, max = 500): string[] {
  const out = new Set<string>();
  for (const r of rawNumbers) {
    const n = normalizePhone(r, country);
    if (n) out.add(n);
    if (out.size >= max) break;
  }
  return [...out];
}

const key = (p: Person) => p.handle.toLowerCase();

/** Dédoublonne par @pseudo en gardant la première occurrence (ordre = priorité des sources) ; retire `excludeHandle` (soi-même). */
export function dedupe(list: Person[], excludeHandle?: string): Person[] {
  const seen = new Set<string>(excludeHandle ? [excludeHandle.toLowerCase()] : []);
  return list.filter((p) => !seen.has(key(p)) && !!seen.add(key(p)));
}

export interface Sections {
  recent: Person[];
  phone: Person[];
  following: Person[];
  followers: Person[];
  search: Person[];
}

/** Filtre local (nom ou pseudo, sans accent ni casse). */
export function matchesQuery(p: Person, q: string): boolean {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = n(q.trim().replace(/^@/, ''));
  return !needle || n(p.displayName).includes(needle) || n(p.handle).includes(needle);
}

/**
 * Sections affichées : chaque personne n'apparaît qu'une fois, dans la première section qui la contient
 * (Récents, Contacts du téléphone, Abonnements, Abonnés), et les résultats de recherche n'ajoutent que les inconnus.
 * Avec une saisie, les sources locales sont filtrées.
 */
export function buildSections(src: Sections, query: string, selfHandle?: string): Sections {
  const seen = new Set<string>(selfHandle ? [selfHandle.toLowerCase()] : []);
  const take = (list: Person[], filter: boolean) =>
    list.filter((p) => (!filter || matchesQuery(p, query)) && !seen.has(key(p)) && !!seen.add(key(p)));
  const f = query.trim().length > 0;
  const recent = take(src.recent, f);
  const phone = take(src.phone, f);
  const following = take(src.following, f);
  const followers = take(src.followers, f);
  return { recent, phone, following, followers, search: take(src.search, false) };
}

/** Saisie manuelle de dernier recours : « @pseudo » valide -> personne sans autre donnée. */
export function manualPerson(query: string): Person | null {
  const h = query.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_.]{3,30}$/.test(h) ? { handle: h, displayName: h } : null;
}

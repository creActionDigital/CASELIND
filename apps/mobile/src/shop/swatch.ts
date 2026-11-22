/** Aide aux sélecteurs de variantes : reconnaît les axes « couleur » / « taille » et la teinte d'une valeur. */

const COLORS: Record<string, string> = {
  noir: '#111111', black: '#111111', nyeusi: '#111111',
  blanc: '#FFFFFF', white: '#FFFFFF', nyeupe: '#FFFFFF',
  gris: '#9A9AA0', grey: '#9A9AA0', gray: '#9A9AA0', kijivu: '#9A9AA0',
  rouge: '#D70015', red: '#D70015', nyekundu: '#D70015',
  bleu: '#2563EB', blue: '#2563EB', buluu: '#2563EB',
  vert: '#1B7F3B', green: '#1B7F3B', kijani: '#1B7F3B',
  jaune: '#F5C400', yellow: '#F5C400', njano: '#F5C400',
  orange: '#F57C00',
  rose: '#EC6BA5', pink: '#EC6BA5', waridi: '#EC6BA5',
  violet: '#7C3AED', purple: '#7C3AED', zambarau: '#7C3AED',
  marron: '#8B5A2B', brun: '#8B5A2B', brown: '#8B5A2B', kahawia: '#8B5A2B',
  beige: '#D8C3A5',
  marine: '#1E2A5A', navy: '#1E2A5A',
  kaki: '#6B6B3A', khaki: '#6B6B3A',
};

export function isColorAxis(name: string): boolean {
  return /couleur|color|colour|teinte/i.test(name);
}

export function isSizeAxis(name: string): boolean {
  return /taille|size|pointure/i.test(name);
}

/** Teinte CSS d'une valeur de couleur, ou `null` si elle n'est pas reconnue (on affiche alors une pastille texte). */
export function swatchColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return v;
  return COLORS[v] ?? null;
}

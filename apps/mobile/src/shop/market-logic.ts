import type { StorefrontProduct } from '@caselind/contracts';
import { parseMajorToMinor } from './format';

/** Produits similaires : même catégorie que la fiche, sans la fiche elle-même, au plus `max`. */
export function similarProducts(items: readonly StorefrontProduct[], currentId: string, max = 8): StorefrontProduct[] {
  return items.filter((p) => p.id !== currentId).slice(0, max);
}

/** Sépare la description d'un produit de ses caractéristiques (lignes « - Clé : valeur » sous un titre « Caractéristiques »). */
export function splitDescription(desc: string | null | undefined): { text: string; specs: [string, string][] } {
  const specs: [string, string][] = [];
  const text: string[] = [];
  for (const line of (desc ?? '').split('\n')) {
    const m = /^\s*[-•]\s*([^:]{2,40}?)\s*:\s*(.+)$/.exec(line);
    if (m) specs.push([m[1]!, m[2]!.trim()]);
    else if (!/^\s*(caract[ée]ristiques|features|specifications|sifa)\s*:?\s*$/i.test(line)) text.push(line);
  }
  return { text: text.join('\n').trim(), specs };
}

export interface CategoryDraft {
  min: string;
  max: string;
  currency?: string;
}

/** Bornes de prix saisies -> unités mineures. `invalid` : saisie illisible ou minimum au-dessus du maximum. */
export function priceBounds(d: CategoryDraft, locale = 'fr'): { minPrice?: number; maxPrice?: number } | 'invalid' {
  const cur = d.currency ?? 'USD';
  const conv = (s: string): number | undefined | null => (s.trim() ? parseMajorToMinor(s, cur, locale) : undefined);
  const lo = conv(d.min);
  const hi = conv(d.max);
  if (lo === null || hi === null) return 'invalid';
  if (lo !== undefined && hi !== undefined && lo > hi) return 'invalid';
  return { ...(lo !== undefined ? { minPrice: lo } : {}), ...(hi !== undefined ? { maxPrice: hi } : {}) };
}

/** Icône d'une catégorie d'après son nom (repli : étiquette). */
export function categoryIcon(name: string): 'phone-portrait-outline' | 'shirt-outline' | 'home-outline' | 'sparkles-outline' | 'restaurant-outline' | 'football-outline' | 'car-outline' | 'cloud-download-outline' | 'pricetag-outline' | 'medkit-outline' | 'happy-outline' | 'construct-outline' | 'book-outline' | 'diamond-outline' | 'leaf-outline' {
  const n = name.toLowerCase();
  if (/électro|electro|phone|informat|vifaa vya umeme/.test(n)) return 'phone-portrait-outline';
  if (/mode|fashion|vêt|vet|nguo/.test(n)) return 'shirt-outline';
  if (/maison|home|nyumba|meuble/.test(n)) return 'home-outline';
  if (/beaut|urembo|cosm/.test(n)) return 'sparkles-outline';
  if (/aliment|food|chakula|épicerie/.test(n)) return 'restaurant-outline';
  if (/sport|michezo/.test(n)) return 'football-outline';
  if (/auto|voiture|car|gari/.test(n)) return 'car-outline';
  if (/num[ée]rique|digital|dijiti/.test(n)) return 'cloud-download-outline';
  if (/sant[ée]|health|afya|pharma/.test(n)) return 'medkit-outline';
  if (/b[ée]b[ée]|baby|enfant|watoto|mtoto/.test(n)) return 'happy-outline';
  if (/service|huduma/.test(n)) return 'construct-outline';
  if (/livre|book|vitabu|papeter/.test(n)) return 'book-outline';
  if (/bijou|jewel|vito/.test(n)) return 'diamond-outline';
  if (/jardin|garden|agri|bustani/.test(n)) return 'leaf-outline';
  return 'pricetag-outline';
}

import type { StorefrontProduct } from '@caselind/contracts';
import { parseMajorToMinor } from './format';

/** Produits similaires : même catégorie que la fiche, sans la fiche elle-même, au plus `max`. */
export function similarProducts(items: readonly StorefrontProduct[], currentId: string, max = 8): StorefrontProduct[] {
  return items.filter((p) => p.id !== currentId).slice(0, max);
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
export function categoryIcon(name: string): 'phone-portrait-outline' | 'shirt-outline' | 'home-outline' | 'sparkles-outline' | 'restaurant-outline' | 'football-outline' | 'car-outline' | 'cloud-download-outline' | 'pricetag-outline' {
  const n = name.toLowerCase();
  if (/électro|electro|phone|informat|vifaa vya umeme/.test(n)) return 'phone-portrait-outline';
  if (/mode|fashion|vêt|vet|nguo/.test(n)) return 'shirt-outline';
  if (/maison|home|nyumba|meuble/.test(n)) return 'home-outline';
  if (/beaut|urembo|cosm/.test(n)) return 'sparkles-outline';
  if (/aliment|food|chakula|épicerie/.test(n)) return 'restaurant-outline';
  if (/sport|michezo/.test(n)) return 'football-outline';
  if (/auto|voiture|car|gari/.test(n)) return 'car-outline';
  if (/num[ée]rique|digital|dijiti/.test(n)) return 'cloud-download-outline';
  return 'pricetag-outline';
}

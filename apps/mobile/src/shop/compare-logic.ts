import type { StorefrontProductDetail } from '@caselind/contracts';

export const MAX_COMPARE_PRODUCTS = 4;

/** Ajoute ou retire un produit de la liste à comparer (4 au plus : le plus ancien sort). */
export const toggleCompareProduct = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-MAX_COMPARE_PRODUCTS));

export interface CompareRow {
  id: string;
  title: string;
  shop: string;
  currency: string;
  /** Prix effectif le plus bas et le plus haut parmi les variantes actives (promotion comprise). */
  minPriceMinor: number;
  maxPriceMinor: number;
  hasPromotion: boolean;
  inStock: boolean;
  variantCount: number;
  /** Noms des options (taille, couleur...), triés. */
  optionNames: string[];
  /** Vrai pour le prix le plus bas parmi les produits de la MÊME devise (jamais d'écart entre devises). */
  cheapest: boolean;
}

/** Une ligne par produit ; « le moins cher » n'est marqué que dans une devise commune à au moins deux produits. */
export function buildCompareRows(details: readonly StorefrontProductDetail[]): CompareRow[] {
  const rows = details.map((d): CompareRow => {
    const prices = d.variants.map((v) => v.priceMinor);
    const names = new Set<string>();
    for (const v of d.variants) for (const k of Object.keys(v.options)) names.add(k);
    return {
      id: d.id,
      title: d.title,
      shop: d.org.name,
      currency: d.currency,
      minPriceMinor: prices.length ? Math.min(...prices) : d.minPriceMinor,
      maxPriceMinor: prices.length ? Math.max(...prices) : d.minPriceMinor,
      hasPromotion: d.variants.some((v) => !!v.promotion) || !!d.promotion,
      inStock: d.variants.some((v) => v.inStock),
      variantCount: d.variants.length,
      optionNames: [...names].sort(),
      cheapest: false,
    };
  });
  for (const cur of new Set(rows.map((r) => r.currency))) {
    const same = rows.filter((r) => r.currency === cur);
    if (same.length < 2) continue;
    const best = Math.min(...same.map((r) => r.minPriceMinor));
    for (const r of same) r.cheapest = r.minPriceMinor === best;
  }
  return rows;
}

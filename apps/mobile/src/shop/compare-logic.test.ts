import type { StorefrontProductDetail } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { buildCompareRows, MAX_COMPARE_PRODUCTS, toggleCompareProduct } from './compare-logic';

const detail = (id: string, currency: string, prices: number[], opts: Record<string, string>[] = [{}], promo = false): StorefrontProductDetail =>
  ({
    id,
    title: `Produit ${id}`,
    categoryId: null,
    coverUrl: null,
    minPriceMinor: Math.min(...prices),
    currency,
    inStock: true,
    org: { id: 'o', slug: 's', name: `Boutique ${id}`, logoUrl: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    description: null,
    media: [],
    variants: prices.map((p, i) => ({ id: `${id}-${i}`, options: opts[i] ?? {}, priceMinor: p, currency, inStock: i !== 1, promotion: promo && i === 0 ? { label: 'Soldes', endsAt: '2026-12-01T00:00:00.000Z', kind: 'percent' as const } : null })),
  }) as unknown as StorefrontProductDetail;

describe('liste à comparer', () => {
  it('ajoute, retire, et garde les 4 derniers', () => {
    let ids: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e']) ids = toggleCompareProduct(ids, id);
    expect(ids).toEqual(['b', 'c', 'd', 'e']);
    expect(ids.length).toBe(MAX_COMPARE_PRODUCTS);
    expect(toggleCompareProduct(ids, 'c')).toEqual(['b', 'd', 'e']);
  });
});

describe('lignes de comparaison', () => {
  it('prix min/max, options, stock et promotion', () => {
    const [r] = buildCompareRows([detail('a', 'USD', [1000, 1500, 1200], [{ taille: 'M' }, { taille: 'L', couleur: 'bleu' }, {}], true)]);
    expect(r).toMatchObject({ minPriceMinor: 1000, maxPriceMinor: 1500, variantCount: 3, hasPromotion: true, inStock: true, cheapest: false });
    expect(r!.optionNames).toEqual(['couleur', 'taille']);
  });
  it('« le moins cher » seulement parmi une même devise', () => {
    const rows = buildCompareRows([detail('a', 'USD', [1000]), detail('b', 'USD', [800]), detail('c', 'CDF', [500000])]);
    expect(rows.map((r) => r.cheapest)).toEqual([false, true, false]);
  });
  it('égalité : les deux sont marqués', () => {
    const rows = buildCompareRows([detail('a', 'USD', [900]), detail('b', 'USD', [900])]);
    expect(rows.every((r) => r.cheapest)).toBe(true);
  });
});

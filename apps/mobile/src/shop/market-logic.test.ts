import type { StorefrontProduct } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { categoryIcon, priceBounds, similarProducts, splitDescription } from './market-logic';

const p = (id: string) => ({ id }) as StorefrontProduct;

describe('market-logic', () => {
  it('similarProducts exclut la fiche courante et plafonne', () => {
    const list = ['a', 'b', 'c', 'd'].map(p);
    expect(similarProducts(list, 'b', 2).map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('priceBounds convertit en unités mineures sans flottant et refuse min > max', () => {
    expect(priceBounds({ min: '1,50', max: '20', currency: 'USD' })).toEqual({ minPrice: 150, maxPrice: 2000 });
    expect(priceBounds({ min: '', max: '', currency: 'CDF' })).toEqual({});
    expect(priceBounds({ min: '30', max: '20' })).toBe('invalid');
    expect(priceBounds({ min: 'abc', max: '' })).toBe('invalid');
  });
  it('categoryIcon reconnaît les 8 catégories du cahier', () => {
    expect(categoryIcon('Électronique')).toBe('phone-portrait-outline');
    expect(categoryIcon('Produits numériques')).toBe('cloud-download-outline');
    expect(categoryIcon('Automobile')).toBe('car-outline');
    expect(categoryIcon('Divers')).toBe('pricetag-outline');
  });
});

describe('splitDescription', () => {
  it('extrait les caractéristiques du texte', () => {
    const r = splitDescription('Un sac solide.\n\nCaractéristiques\n- Matière : coton\n- Dimensions : 30 x 20 cm');
    expect(r.text).toBe('Un sac solide.');
    expect(r.specs).toEqual([['Matière', 'coton'], ['Dimensions', '30 x 20 cm']]);
    expect(splitDescription(null)).toEqual({ text: '', specs: [] });
  });
});

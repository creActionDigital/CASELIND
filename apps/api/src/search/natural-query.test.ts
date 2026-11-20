import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, parseNaturalQuery, toMinor } from './natural-query.js';

type Expected = Partial<typeof EMPTY_FILTERS>;

const TABLE: [string, Expected][] = [
  ['sandales pas chères près de Goma', { keywords: 'sandales', categorySlug: 'mode', cheapFirst: true, city: 'Goma' }],
  ['téléphone moins de 20 $ à Bukavu', { keywords: 'téléphone', categorySlug: 'electronique', maxPriceMinor: 2000, currency: 'USD', city: 'Bukavu' }],
  ['je cherche des chaussures pas plus de 50 dollars', { keywords: 'chaussures', maxPriceMinor: 5000, currency: 'USD' }],
  ['riz moins de 5000 fc', { keywords: 'riz', categorySlug: 'alimentation', maxPriceMinor: 500000, currency: 'CDF' }],
  ['laptop under $300 near Kinshasa', { keywords: 'laptop', maxPriceMinor: 30000, currency: 'USD', city: 'Kinshasa' }],
  ['cheap shoes', { keywords: 'shoes', cheapFirst: true, categorySlug: 'mode' }],
  ['phone between 100 and 200 usd', { keywords: 'phone', minPriceMinor: 10000, maxPriceMinor: 20000, currency: 'USD' }],
  ['entre 10 et 50 € robe', { keywords: 'robe', minPriceMinor: 1000, maxPriceMinor: 5000, currency: 'EUR' }],
  ['viatu bei nafuu karibu na Goma', { keywords: 'viatu', categorySlug: 'mode', cheapFirst: true, city: 'Goma' }],
  ['simu chini ya 100 dola', { keywords: 'simu', maxPriceMinor: 10000, currency: 'USD' }],
  ['restaurant près de Lubumbashi', { placeKind: 'restaurant', city: 'Lubumbashi', keywords: null }],
  ['pharmacie à Goma', { placeKind: 'pharmacy', city: 'Goma' }],
  ['hotel in Kigali', { placeKind: 'hotel', city: 'Kigali' }],
  ['mgahawa karibu na Bukavu', { placeKind: 'restaurant', city: 'Bukavu' }],
  ['électricien près de moi', { placeKind: 'services', keywords: 'électricien', nearMe: true, city: null }],
  ['plombier autour de Goma', { placeKind: 'services', keywords: 'plombier', city: 'Goma' }],
  ['pizza près de la gare', { keywords: 'pizza', city: 'Gare' }],
  ['pain plus de 2 $', { keywords: 'pain', minPriceMinor: 200, currency: 'USD' }],
  ['télévision max 1 000 000 fc', { keywords: 'télévision', categorySlug: 'electronique', maxPriceMinor: 100000000, currency: 'CDF' }],
  ['bébé couches abordables', { categorySlug: 'bebe', cheapFirst: true, keywords: 'bébé couches' }],
  ['a pair of sandals', { keywords: 'pair sandals', city: null }],
  ['', { keywords: null }],
];

describe('parseNaturalQuery', () => {
  it.each(TABLE)('%s', (phrase, expected) => {
    expect(parseNaturalQuery(phrase)).toMatchObject(expected);
  });

  it('never returns more than the schema allows', () => {
    const f = parseNaturalQuery('x'.repeat(400));
    expect(f.keywords!.length).toBeLessThanOrEqual(100);
  });

  it('converts amounts to minor units', () => {
    expect(toMinor('20')).toBe(2000);
    expect(toMinor('20,5')).toBe(2050);
    // A huge number must not become an out-of-range bigint later (500): it reads as no price.
    expect(toMinor('99999999999999999999')).toBe(0);
    expect(toMinor('1.000')).toBe(100000);
    expect(toMinor('0.99')).toBe(99);
  });
});

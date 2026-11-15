import { describe, expect, it } from 'vitest';
import { hasPrice, kindKey, LISTING_KINDS, priceLabel } from './logic';

describe('listings logic', () => {
  it('lost and found items have no price', () => {
    expect(LISTING_KINDS.filter((k) => !hasPrice(k))).toEqual(['lost', 'found']);
  });
  it('formats a price, or nothing when there is none', () => {
    expect(priceLabel({ priceMinor: null, currency: null }, 'fr')).toBeNull();
    expect(priceLabel({ priceMinor: 2500, currency: 'USD' }, 'fr')).toContain('25');
  });
  it('maps each kind to its own label key', () => {
    expect(kindKey('vehicle')).toBe('listings.kind.vehicle');
  });
});

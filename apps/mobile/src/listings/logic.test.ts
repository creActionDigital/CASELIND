import { describe, expect, it } from 'vitest';
import { hasPrice, kindKey, LISTING_KINDS, parseVisitTime, priceLabel } from './logic';

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

describe('parseVisitTime', () => {
  it('accepte une date UTC valide et refuse le reste', () => {
    expect(parseVisitTime('2030-01-02', '14:30')).toBe('2030-01-02T14:30:00.000Z');
    expect(parseVisitTime('2030-1-2', '14:30')).toBeNull();
    expect(parseVisitTime('2030-02-30', '14:30')).not.toBe('2030-02-30T14:30:00.000Z');
    expect(parseVisitTime('2030-01-02', '25:00')).toBeNull();
  });
});

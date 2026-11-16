import { describe, expect, it } from 'vitest';
import { hasPrice, kindKey, LISTING_KINDS, offerBounds, offerErrorKey, parseVisitTime, priceLabel, toggleCompare, visitErrorKey } from './logic';

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
  it('lit une heure locale valide et refuse le reste', () => {
    expect(parseVisitTime('2030-01-02', '14:30')).toBe(new Date(2030, 0, 2, 14, 30).toISOString());
    expect(visitErrorKey({ reason: 'too_late' })).toBe('listings.visit.err.late');
    expect(visitErrorKey({ reason: 'x', note: 'visit_exists' })).toBeNull();
    expect(visitErrorKey([{ path: 'scheduledAt', message: 'm' }])).toBe('listings.visit.err.date');
    expect(parseVisitTime('2030-1-2', '14:30')).toBeNull();
    expect(parseVisitTime('2030-02-30', '14:30')).not.toBe('2030-02-30T14:30:00.000Z');
    expect(parseVisitTime('2030-01-02', '25:00')).toBeNull();
  });
});

describe('offres et comparaison', () => {
  it('calcule les bornes et les erreurs', () => {
    expect(offerBounds(25_001)).toEqual({ min: 2_501, max: 25_001 });
    expect(offerErrorKey({ reason: 'offer_limit' })).toBe('listings.offer.err.limit');
    expect(offerErrorKey([{ path: 'amountMinor', message: 'm' }])).toBe('listings.offer.err.amount');
    expect(offerErrorKey({ reason: 'zzz' })).toBeNull();
  });
  it('garde 3 annonces au plus, retire au second appui', () => {
    expect(toggleCompare(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleCompare(['a', 'b', 'c'], 'd')).toEqual(['b', 'c', 'd']);
    expect(toggleCompare(['a', 'b'], 'a')).toEqual(['b']);
  });
});

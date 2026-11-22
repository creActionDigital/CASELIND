import { describe, expect, it } from 'vitest';
import { KIND_STYLE, MAP_CATEGORIES, placeActions, placeHref, rideToHref, showsHoursFirst } from './kinds';

describe('placeActions', () => {
  it('propose des actions propres au type, vers des écrans existants', () => {
    expect(placeActions('hospital', 'x')[0].href).toBe('/health/professionals');
    expect(placeActions('restaurant', 'chez-mama')[0].href).toBe('/store/chez-mama');
    expect(placeActions('hotel', 'h').map((a) => a.href)).toEqual(['/store/h', '/bookings']);
    expect(placeActions('fuel_station', 'x')).toEqual([]);
  });
  it('met les horaires en avant pour pharmacie et santé', () => {
    expect(showsHoursFirst('pharmacy')).toBe(true);
    expect(showsHoursFirst('school')).toBe(false);
  });
  it('transmet la position seulement si connue', () => {
    expect(placeHref({ slug: 'a' }).params).toEqual({ slug: 'a' });
    expect(placeHref({ slug: 'a', lat: -1.6, lng: 29.2, label: 'Gare' }).params).toEqual({ slug: 'a', lat: '-1.6', lng: '29.2', label: 'Gare' });
  });
  it('donne un style et une destination de course à chaque catégorie de la carte', () => {
    for (const k of MAP_CATEGORIES) expect(KIND_STYLE[k].color).toMatch(/^#[0-9A-F]{6}$/);
    expect(rideToHref({ lat: -1.66, lng: 29.22, name: 'Pharmacie' }).params).toEqual({ destLat: '-1.66', destLng: '29.22', destLabel: 'Pharmacie' });
  });
});

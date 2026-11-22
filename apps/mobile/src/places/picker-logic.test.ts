import { describe, expect, it } from 'vitest';
import { addRecentPlace, labelForPoint, matchSaved, parseRecentPlaces } from './picker-logic';

const a = { lat: -1.6585, lng: 29.2205, label: 'Maison' };
describe('picker-logic', () => {
  it('recents : dédoublonne par position et plafonne à 5', () => {
    let l = [a];
    l = addRecentPlace(l, { ...a, label: 'Autre nom' });
    expect(l).toHaveLength(1);
    for (let i = 0; i < 7; i++) l = addRecentPlace(l, { lat: i, lng: i, label: `p${i}` });
    expect(l).toHaveLength(5);
    expect(l[0]!.label).toBe('p6');
  });
  it('parse tolère le JSON invalide', () => {
    expect(parseRecentPlaces('x')).toEqual([]);
    expect(parseRecentPlaces(JSON.stringify([a, { lat: 999, lng: 0, label: 'x' }]))).toEqual([a]);
  });
  it('matchSaved ignore accents et casse', () => {
    expect(matchSaved([{ label: 'Marché Birere' }], 'marche')).toHaveLength(1);
    expect(matchSaved([{ label: 'Marché' }], 'zzz')).toHaveLength(0);
  });
  it('labelForPoint prend le lieu connu proche, sinon le repli', () => {
    expect(labelForPoint({ lat: -1.6586, lng: 29.2205 }, [a], 'Point')).toBe('Maison');
    expect(labelForPoint({ lat: -1.7, lng: 29.2 }, [a], 'Point')).toBe('Point');
  });
});

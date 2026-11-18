import { describe, expect, it } from 'vitest';
import { buildHours, isOpenNow, parseAreas, parseDay } from './logic';

describe('horaires', () => {
  it('lit les intervalles et refuse les saisies invalides', () => {
    expect(parseDay('')).toEqual([]);
    expect(parseDay('8:00-12:00, 14:00–18:30')).toEqual([{ open: '08:00', close: '12:00' }, { open: '14:00', close: '18:30' }]);
    expect(parseDay('18:00-08:00')).toBeNull();
    expect(parseDay('08:00-12:00, 11:00-13:00')).toBeNull();
    expect(parseDay('25:00-26:00')).toBeNull();
    expect(parseDay('20:00-24:00')).toEqual([{ open: '20:00', close: '24:00' }]);
    expect(parseDay('abc')).toBeNull();
  });
  it('construit la semaine : tout vide = aucun horaire, un jour invalide = invalid', () => {
    const empty = { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' };
    expect(buildHours(empty)).toBeNull();
    expect(buildHours({ ...empty, mon: '08:00-17:00' })).toMatchObject({ mon: [{ open: '08:00', close: '17:00' }], tue: [] });
    expect(buildHours({ ...empty, mon: 'x' })).toBe('invalid');
  });
  it('dit si la boutique est ouverte', () => {
    const hours = { mon: [{ open: '08:00', close: '17:00' }] };
    expect(isOpenNow(hours, new Date(2026, 10, 16, 9, 0))).toBe(true); // lundi 16 nov. 2026
    expect(isOpenNow(hours, new Date(2026, 10, 16, 17, 0))).toBe(false);
    expect(isOpenNow(hours, new Date(2026, 10, 17, 9, 0))).toBe(false);
    expect(isOpenNow(null)).toBeNull();
  });
});

describe('zones desservies', () => {
  it('découpe, nettoie et dédoublonne', () => {
    expect(parseAreas('Goma, goma\n Gisenyi ,,')).toEqual(['Goma', 'Gisenyi']);
  });
});

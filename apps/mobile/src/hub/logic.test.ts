import { describe, expect, it } from 'vitest';
import { formatCount, HUB_TABS, tabIndexFromOffset } from './logic';

describe('hub logic', () => {
  it('garde l’ordre Live · Vidéos · Posts · Produits', () => {
    expect([...HUB_TABS]).toEqual(['live', 'videos', 'posts', 'products']);
  });
  it('déduit l’onglet du défilement', () => {
    expect(tabIndexFromOffset(0, 400)).toBe(0);
    expect(tabIndexFromOffset(210, 400)).toBe(1);
    expect(tabIndexFromOffset(1200, 400)).toBe(3);
    expect(tabIndexFromOffset(9999, 400)).toBe(3);
    expect(tabIndexFromOffset(-50, 400)).toBe(0);
    expect(tabIndexFromOffset(100, 0)).toBe(0);
  });
  it('formate les compteurs', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1200)).toBe('1,2 k');
    expect(formatCount(2000)).toBe('2 k');
    expect(formatCount(1999)).toBe('1,9 k');
    expect(formatCount(234_000)).toBe('234 k');
    expect(formatCount(1_500_000)).toBe('1,5 M');
    expect(formatCount(1200, 'en')).toBe('1.2k');
    expect(formatCount(-3)).toBe('0');
  });
});

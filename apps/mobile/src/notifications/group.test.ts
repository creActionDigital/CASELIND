import { describe, expect, it } from 'vitest';
import { dayKeyOf, groupByDay } from './group';

const now = new Date(2026, 10, 21, 15, 0);
const at = (daysAgo: number, h = 10) => new Date(2026, 10, 21 - daysAgo, h).toISOString();

describe('groupByDay', () => {
  it('classe par jour du calendrier local', () => {
    expect(dayKeyOf(at(0, 1), now)).toBe('today');
    expect(dayKeyOf(at(1, 23), now)).toBe('yesterday');
    expect(dayKeyOf(at(3), now)).toBe('week');
    expect(dayKeyOf(at(6), now)).toBe('week');
    expect(dayKeyOf(at(7), now)).toBe('older');
  });
  it('garde l’ordre et omet les sections vides', () => {
    const g = groupByDay([{ createdAt: at(0) }, { createdAt: at(0, 8) }, { createdAt: at(20) }], now);
    expect(g.map((s) => [s.key, s.data.length])).toEqual([['today', 2], ['older', 1]]);
  });
});

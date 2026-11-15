import { describe, expect, it } from 'vitest';
import { isDate, parseTimes, todayLocal } from './logic';

describe('health logic', () => {
  it('reads times in several spellings, sorted and de-duplicated', () => {
    expect(parseTimes('8:00, 20h30 ; 08:00')).toEqual(['08:00', '20:30']);
    expect(parseTimes('07:05')).toEqual(['07:05']);
  });
  it('refuses invalid or too many times', () => {
    expect(parseTimes('')).toBeNull();
    expect(parseTimes('24:00')).toBeNull();
    expect(parseTimes('12:60')).toBeNull();
    expect(parseTimes('midi')).toBeNull();
    expect(parseTimes('01:00 02:00 03:00 04:00 05:00 06:00 07:00')).toBeNull();
  });
  it('formats the local date and checks typed dates', () => {
    expect(todayLocal(new Date(2026, 10, 5))).toBe('2026-11-05');
    expect(isDate('2026-11-05')).toBe(true);
    expect(isDate('05/11/2026')).toBe(false);
  });
});

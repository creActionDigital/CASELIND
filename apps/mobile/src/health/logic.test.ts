import { describe, expect, it } from 'vitest';
import { appointmentActions, parseDayWindows, isDate, localToIso, parseTimes, todayLocal } from './logic';

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


describe('health appointments logic', () => {
  it('turns a local date and time into an ISO instant, refusing the past and nonsense', () => {
    const now = new Date(2026, 10, 15, 10, 0);
    expect(localToIso('2026-11-16', '9:30', now)).toBe(new Date(2026, 10, 16, 9, 30).toISOString());
    expect(localToIso('2026-11-14', '09:30', now)).toBeNull();
    expect(localToIso('2026-11-16', '25:00', now)).toBeNull();
    expect(localToIso('16/11/2026', '09:30', now)).toBeNull();
  });
  it('offers each side only the moves the server allows', () => {
    expect(appointmentActions('patient', 'requested')).toEqual(['cancel']);
    expect(appointmentActions('patient', 'completed')).toEqual([]);
    expect(appointmentActions('professional', 'requested')).toEqual(['confirm', 'decline']);
    expect(appointmentActions('professional', 'confirmed')).toEqual(['complete', 'cancel']);
    expect(appointmentActions('professional', 'declined')).toEqual([]);
  });
});

describe('parseDayWindows (lot 18c)', () => {
  it('reads windows in several spellings', () => {
    expect(parseDayWindows(2, '8:00-12:00, 14h-17:30')).toEqual([{ day: 2, start: '08:00', end: '12:00' }, { day: 2, start: '14:00', end: '17:30' }]);
    expect(parseDayWindows(1, '')).toEqual([]);
  });
  it('refuses reversed, overlapping, invalid or more than 4 windows', () => {
    expect(parseDayWindows(1, '12:00-08:00')).toBeNull();
    expect(parseDayWindows(1, '08:00-10:00, 09:00-11:00')).toBeNull();
    expect(parseDayWindows(1, '25:00-26:00')).toBeNull();
    expect(parseDayWindows(1, '01:00-02:00,03:00-04:00,05:00-06:00,07:00-08:00,09:00-10:00')).toBeNull();
  });
});

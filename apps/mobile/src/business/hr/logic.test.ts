import type { Shift } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { addDays, buildLeave, buildShift, isDate, parseGross, parseQuota, periodOf, previewLeaveDays, shiftsByDay, weekDays, weekStart } from './logic';

describe('dates', () => {
  it('validates calendar dates', () => {
    expect(isDate('2026-02-28')).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('26-02-28')).toBe(false);
  });
  it('finds the Monday of a week and its seven days', () => {
    expect(weekStart('2026-11-19')).toBe('2026-11-16');
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekDays('2026-11-16')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('leave form', () => {
  it('previews calendar days and builds the request', () => {
    expect(previewLeaveDays({ startsOn: '2026-03-02', endsOn: '2026-03-06' })).toBe(5);
    expect(previewLeaveDays({ startsOn: '2026-03-06', endsOn: '2026-03-02' })).toBeNull();
    expect(buildLeave({ kind: 'annual', startsOn: '2026-03-02', endsOn: '2026-03-06', reason: '  ' })).toEqual({ ok: { kind: 'annual', startsOn: '2026-03-02', endsOn: '2026-03-06' } });
    expect(buildLeave({ kind: 'sick', startsOn: '2026-03-02', endsOn: '2026-03-02', reason: ' Grippe ' })).toEqual({ ok: { kind: 'sick', startsOn: '2026-03-02', endsOn: '2026-03-02', reason: 'Grippe' } });
  });
  it('names the first error', () => {
    expect(buildLeave({ kind: 'annual', startsOn: 'x', endsOn: '2026-03-06', reason: '' })).toEqual({ error: 'startsOn' });
    expect(buildLeave({ kind: 'annual', startsOn: '2026-03-02', endsOn: '2026-02-30', reason: '' })).toEqual({ error: 'endsOn' });
    expect(buildLeave({ kind: 'annual', startsOn: '2026-03-06', endsOn: '2026-03-02', reason: '' })).toEqual({ error: 'endBeforeStart' });
    expect(buildLeave({ kind: 'annual', startsOn: '2026-01-01', endsOn: '2028-01-01', reason: '' })).toEqual({ error: 'tooLong' });
  });
});

describe('shift form', () => {
  const base = { userId: 'u1', shiftDate: '2026-03-02', startsAt: '08:00', endsAt: '12:00', note: '' };
  it('accepts a same-day slot', () => {
    expect(buildShift(base)).toEqual({ ok: { userId: 'u1', shiftDate: '2026-03-02', startsAt: '08:00', endsAt: '12:00' } });
  });
  it('refuses missing employee, bad date, bad time, end not after start', () => {
    expect(buildShift({ ...base, userId: null })).toEqual({ error: 'employee' });
    expect(buildShift({ ...base, shiftDate: '2026-13-01' })).toEqual({ error: 'date' });
    expect(buildShift({ ...base, startsAt: '8:00' })).toEqual({ error: 'time' });
    expect(buildShift({ ...base, endsAt: '08:00' })).toEqual({ error: 'order' });
  });
  it('groups shifts by day in time order, empty days included', () => {
    const s = (id: string, shiftDate: string, startsAt: string): Shift => ({ id, userId: 'u1', handle: 'h', displayName: 'N', shiftDate, startsAt, endsAt: '23:00', note: null });
    const g = shiftsByDay([s('b', '2026-03-03', '13:00'), s('a', '2026-03-03', '08:00'), s('c', '2026-03-05', '09:00')], ['2026-03-02', '2026-03-03', '2026-03-04']);
    expect(g.map((d) => d.items.map((x) => x.id))).toEqual([[], ['a', 'b'], []]);
  });
});

describe('salary register entry', () => {
  it('builds the first of the month', () => {
    expect(periodOf('2026-03')).toBe('2026-03-01');
    expect(periodOf('2026-13')).toBeNull();
    expect(periodOf('2026-03-01')).toBeNull();
  });
  it('parses a declared gross amount without computing anything', () => {
    expect(parseGross('1250,50', 'USD')).toBe(125050);
    expect(parseGross('0', 'USD')).toBe(0);
    expect(parseGross('12.345', 'USD')).toBeNull();
    expect(parseGross('-5', 'USD')).toBeNull();
    expect(parseGross('abc', 'CDF')).toBeNull();
  });
  it('parses the annual quota', () => {
    expect(parseQuota('')).toBeNull();
    expect(parseQuota('20')).toBe(20);
    expect(parseQuota('366')).toBeUndefined();
    expect(parseQuota('2x')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { customSplitPreview, daysLeft, equalSplitPreview, nextRunDates, parseDateOnly, parseLocalDateTime, requestActions, scheduledRunAt, splitEqual } from './logic';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('splitEqual', () => {
  const cases: Array<[number, number]> = [
    [1000, 3],
    [1, 1],
    [100, 7],
    [999_999, 20],
    [5, 5],
    [0, 4],
    [7, 3],
  ];
  it.each(cases)('total %i in %i parts sums exactly, parts differ by at most 1', (total, parts) => {
    const r = splitEqual(total, parts);
    expect(r).toHaveLength(parts);
    expect(sum(r)).toBe(total);
    expect(Math.max(...r) - Math.min(...r)).toBeLessThanOrEqual(1);
  });
  it('gives the extra units to the first parts', () => {
    expect(splitEqual(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEqual(10, 4)).toEqual([3, 3, 2, 2]);
  });
  it('refuses nonsense', () => {
    expect(splitEqual(10, 0)).toEqual([]);
    expect(splitEqual(-1, 2)).toEqual([]);
    expect(splitEqual(1.5, 2)).toEqual([]);
  });
});

describe('split previews', () => {
  it('equal: participants plus the creator, exact sum', () => {
    const p = equalSplitPreview(1000, 2)!;
    expect(p.shares).toEqual([334, 333]);
    expect(p.selfMinor).toBe(333);
    expect(sum(p.shares) + p.selfMinor).toBe(1000);
  });
  it('equal: too small a total or no participant', () => {
    expect(equalSplitPreview(2, 2)).toBeNull();
    expect(equalSplitPreview(1000, 0)).toBeNull();
    expect(equalSplitPreview(3, 2)).not.toBeNull();
  });
  it('custom: the creator keeps the rest, never more than the total', () => {
    expect(customSplitPreview(1000, [400, 300])).toEqual({ shares: [400, 300], selfMinor: 300 });
    expect(customSplitPreview(1000, [500, 500])).toEqual({ shares: [500, 500], selfMinor: 0 });
    expect(customSplitPreview(1000, [600, 500])).toEqual({ issue: 'over' });
    expect(customSplitPreview(1000, [])).toEqual({ issue: 'empty' });
    expect(customSplitPreview(1000, [0, 5])).toEqual({ issue: 'empty' });
  });
});

describe('scheduled run dates', () => {
  it('weekly: 7 days apart', () => {
    const first = new Date('2026-01-05T09:00:00.000Z');
    expect(scheduledRunAt(first, 'weekly', 2).toISOString()).toBe('2026-01-19T09:00:00.000Z');
  });
  it('monthly: end of month without drift', () => {
    const first = new Date('2026-01-31T10:00:00.000Z');
    expect([0, 1, 2, 3].map((n) => scheduledRunAt(first, 'monthly', n).toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('monthly: leap year and year change', () => {
    expect(scheduledRunAt(new Date('2027-12-31T00:00:00.000Z'), 'monthly', 2).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(scheduledRunAt(new Date('2026-11-15T00:00:00.000Z'), 'monthly', 3).toISOString().slice(0, 10)).toBe('2027-02-15');
  });
  it('once: only the first run', () => {
    const dates = nextRunDates({ firstRunAt: '2026-03-01T08:00:00.000Z', frequency: 'once', runsDone: 0, maxRuns: null, endsOn: null }, 5);
    expect(dates).toEqual(['2026-03-01T08:00:00.000Z']);
    expect(nextRunDates({ firstRunAt: '2026-03-01T08:00:00.000Z', frequency: 'once', runsDone: 1, maxRuns: null, endsOn: null }, 5)).toEqual([]);
  });
  it('honours maxRuns, runsDone and endsOn', () => {
    const base = { firstRunAt: '2026-01-01T08:00:00.000Z', frequency: 'weekly' as const };
    expect(nextRunDates({ ...base, runsDone: 0, maxRuns: null, endsOn: null }, 3)).toHaveLength(3);
    expect(nextRunDates({ ...base, runsDone: 2, maxRuns: 4, endsOn: null }, 5).map((d) => d.slice(0, 10))).toEqual(['2026-01-15', '2026-01-22']);
    expect(nextRunDates({ ...base, runsDone: 0, maxRuns: null, endsOn: '2026-01-15' }, 10).map((d) => d.slice(0, 10))).toEqual(['2026-01-01', '2026-01-08', '2026-01-15']);
  });
});

describe('date input', () => {
  it('parseDateOnly accepts real calendar days only', () => {
    expect(parseDateOnly('2026-02-28')).toBe('2026-02-28');
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(parseDateOnly('2026-13-01')).toBeNull();
    expect(parseDateOnly('28/02/2026')).toBeNull();
  });
  it('parseLocalDateTime', () => {
    expect(parseLocalDateTime('2026-05-01 09:30')).toBe(new Date(2026, 4, 1, 9, 30).toISOString());
    expect(parseLocalDateTime('2026-05-01 24:00')).toBeNull();
    expect(parseLocalDateTime('2026-05-01 09:60')).toBeNull();
    expect(parseLocalDateTime('2026-02-31 09:00')).toBeNull();
    expect(parseLocalDateTime('demain')).toBeNull();
  });
});

describe('request helpers', () => {
  it('actions by side and status', () => {
    expect(requestActions({ status: 'pending', direction: 'received' })).toEqual({ pay: true, decline: true, cancel: false });
    expect(requestActions({ status: 'pending', direction: 'sent' })).toEqual({ pay: false, decline: false, cancel: true });
    expect(requestActions({ status: 'paid', direction: 'received' })).toEqual({ pay: false, decline: false, cancel: false });
    expect(requestActions({ status: 'expired', direction: 'sent' })).toEqual({ pay: false, decline: false, cancel: false });
  });
  it('daysLeft rounds up and never goes negative', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(daysLeft('2026-01-15T00:00:00Z', now)).toBe(14);
    expect(daysLeft('2026-01-01T06:00:00Z', now)).toBe(1);
    expect(daysLeft('2025-12-01T00:00:00Z', now)).toBe(0);
  });
});

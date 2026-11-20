import { describe, expect, it } from 'vitest';
import { averageMinor, denseSeries, lastDays, moneySeries, ratePercent, sumPoints } from './analytics.logic.js';

describe('analytics logic', () => {
  it('lists the UTC days ending today, oldest first', () => {
    const days = lastDays(new Date('2026-03-02T23:59:59Z'), 4);
    expect(days).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('densifies a series: missing days are 0, days outside the window are ignored', () => {
    const days = lastDays(new Date('2026-03-02T10:00:00Z'), 3);
    const s = denseSeries(days, [{ day: '2026-03-02', value: 5 }, { day: '2026-01-01', value: 9 }]);
    expect(s).toEqual([{ day: '2026-02-28', value: 0 }, { day: '2026-03-01', value: 0 }, { day: '2026-03-02', value: 5 }]);
    expect(sumPoints(s)).toBe(5);
  });

  it('computes the average basket and the retention rate without dividing by zero', () => {
    expect(averageMinor(4000, 2)).toBe(2000);
    expect(averageMinor(1000, 3)).toBe(333);
    expect(averageMinor(0, 0)).toBe(0);
    expect(ratePercent(1, 3)).toBe(33);
    expect(ratePercent(0, 0)).toBeNull();
  });

  it('builds one dense series per currency', () => {
    const days = ['2026-03-01', '2026-03-02'];
    const out = moneySeries(days, [
      { currency: 'USD', day: '2026-03-02', count: 2, amountMinor: 3000 },
      { currency: 'CDF', day: '2026-03-01', count: 1, amountMinor: 500 },
    ]);
    expect(out.map((c) => c.currency)).toEqual(['CDF', 'USD']);
    expect(out[1]).toEqual({
      currency: 'USD',
      count: 2,
      amountMinor: 3000,
      averageMinor: 1500,
      byDay: [{ day: '2026-03-01', count: 0, amountMinor: 0 }, { day: '2026-03-02', count: 2, amountMinor: 3000 }],
    });
    expect(moneySeries(days, [])).toEqual([]);
  });
});

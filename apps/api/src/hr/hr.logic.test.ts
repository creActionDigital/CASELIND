import { leaveDays } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { daysInYear, dateRangesOverlap, leaveBalance, timeRangesOverlap } from './hr.logic.js';

describe('leave days', () => {
  it('counts calendar days, both ends included', () => {
    expect(leaveDays('2026-03-02', '2026-03-02')).toBe(1);
    expect(leaveDays('2026-03-02', '2026-03-08')).toBe(7);
    expect(leaveDays('2026-02-27', '2026-03-02')).toBe(4);
    expect(leaveDays('2028-02-28', '2028-03-01')).toBe(3);
    expect(leaveDays('2026-12-30', '2027-01-02')).toBe(4);
  });
  it('splits a leave across years', () => {
    expect(daysInYear('2026-12-30', '2027-01-02', 2026)).toBe(2);
    expect(daysInYear('2026-12-30', '2027-01-02', 2027)).toBe(2);
    expect(daysInYear('2026-12-30', '2027-01-02', 2028)).toBe(0);
  });
});

describe('interval overlap', () => {
  it('date ranges are inclusive', () => {
    const a = { startsOn: '2026-05-04', endsOn: '2026-05-08' };
    expect(dateRangesOverlap(a, { startsOn: '2026-05-08', endsOn: '2026-05-10' })).toBe(true);
    expect(dateRangesOverlap(a, { startsOn: '2026-05-09', endsOn: '2026-05-10' })).toBe(false);
    expect(dateRangesOverlap(a, { startsOn: '2026-05-01', endsOn: '2026-05-03' })).toBe(false);
    expect(dateRangesOverlap(a, { startsOn: '2026-05-01', endsOn: '2026-06-01' })).toBe(true);
  });
  it('time ranges are half-open', () => {
    const a = { startsAt: '08:00', endsAt: '12:00' };
    expect(timeRangesOverlap(a, { startsAt: '12:00', endsAt: '16:00' })).toBe(false);
    expect(timeRangesOverlap(a, { startsAt: '11:59', endsAt: '16:00' })).toBe(true);
    expect(timeRangesOverlap(a, { startsAt: '09:00', endsAt: '10:00' })).toBe(true);
    expect(timeRangesOverlap(a, { startsAt: '06:00', endsAt: '08:00' })).toBe(false);
  });
});

describe('indicative balance', () => {
  it('subtracts approved and pending annual days from the quota; other kinds are only listed', () => {
    const b = leaveBalance(
      [
        { kind: 'annual', status: 'approved', startsOn: '2026-03-02', endsOn: '2026-03-06' },
        { kind: 'annual', status: 'requested', startsOn: '2026-07-01', endsOn: '2026-07-02' },
        { kind: 'sick', status: 'approved', startsOn: '2026-04-01', endsOn: '2026-04-03' },
      ],
      20,
      2026,
    );
    expect(b).toMatchObject({ annualUsedDays: 5, annualPendingDays: 2, annualRemainingDays: 13 });
    expect(b.usedByKind).toEqual([{ kind: 'annual', days: 5 }, { kind: 'sick', days: 3 }]);
  });
  it('has no remaining figure without a quota', () => {
    expect(leaveBalance([], null, 2026).annualRemainingDays).toBeNull();
  });
});

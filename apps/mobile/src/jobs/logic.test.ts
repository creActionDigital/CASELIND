import { describe, expect, it } from 'vitest';
import { canManageJobs, canWithdraw, nextStatuses, salaryLabel } from './logic';

describe('jobs logic', () => {
  it('offers the recruiter only the allowed next statuses', () => {
    expect(nextStatuses('submitted')).toEqual(['viewed', 'shortlisted', 'rejected']);
    expect(nextStatuses('offered')).toEqual(['hired', 'rejected']);
    expect(nextStatuses('hired')).toEqual([]);
  });
  it('a decided application cannot be withdrawn', () => {
    expect(canWithdraw('interview')).toBe(true);
    expect(['hired', 'rejected', 'withdrawn'].some((s) => canWithdraw(s as never))).toBe(false);
  });
  it('mirrors hr.manage', () => {
    expect(['owner', 'admin', 'hr'].every((r) => canManageJobs(r as never))).toBe(true);
    expect(['sales', 'employee', 'manager'].some((r) => canManageJobs(r as never))).toBe(false);
    expect(canManageJobs(undefined)).toBe(false);
  });
  it('formats a salary range, a single bound, or nothing', () => {
    expect(salaryLabel({ salary: null }, 'fr')).toBeNull();
    expect(salaryLabel({ salary: { minMinor: 30000, maxMinor: null, currency: 'USD' } }, 'fr')).toContain('300');
    expect(salaryLabel({ salary: { minMinor: 30000, maxMinor: 50000, currency: 'USD' } }, 'fr')).toContain('–');
  });
});

describe('interview helpers', () => {
  it('parses a local date and time, rejects nonsense', async () => {
    const { parseLocalDateTime, canPropose } = await import('./logic');
    expect(parseLocalDateTime('2030-02-10 14:30')).toBe(new Date(2030, 1, 10, 14, 30).toISOString());
    expect(parseLocalDateTime('2030-02-31 14:30')).toBeNull();
    expect(parseLocalDateTime('demain')).toBeNull();
    expect(canPropose('shortlisted')).toBe(true);
    expect(canPropose('rejected')).toBe(false);
  });
});

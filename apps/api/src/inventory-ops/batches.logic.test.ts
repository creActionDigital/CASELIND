import { describe, expect, it } from 'vitest';
import { daysToExpiry, fefoCompare, fefoOrder, fefoPlan } from './batches.logic.js';

const b = (id: string, expiresOn: string | null, qty: number, receivedOn = '2026-01-01') => ({ id, batchCode: id, expiresOn, receivedOn, quantityRemaining: qty });

describe('FEFO order', () => {
  it('sorts by expiry, undated last, then oldest received; empty batches are dropped', () => {
    const list = [b('nodate', null, 5), b('late', '2026-12-01', 5), b('soon', '2026-06-01', 5), b('soon-older', '2026-06-01', 5, '2025-12-01'), b('empty', '2026-01-01', 0)];
    expect(fefoOrder(list).map((x) => x.id)).toEqual(['soon-older', 'soon', 'late', 'nodate']);
  });
  it('compares equal batches as 0', () => {
    expect(fefoCompare(b('a', null, 1), b('a', null, 1))).toBe(0);
  });
});

describe('FEFO plan', () => {
  it('takes from the earliest batches, skips expired ones and reports the shortfall', () => {
    const list = [b('expired', '2026-01-01', 10), b('a', '2026-06-01', 3), b('b', '2026-07-01', 4)];
    expect(fefoPlan(list, 5, '2026-03-01')).toEqual({ plan: [{ batchId: 'a', batchCode: 'a', take: 3 }, { batchId: 'b', batchCode: 'b', take: 2 }], shortfall: 0 });
    expect(fefoPlan(list, 20, '2026-03-01').shortfall).toBe(13);
  });
  it('a batch expiring today is still usable', () => {
    expect(fefoPlan([b('t', '2026-03-01', 2)], 2, '2026-03-01').shortfall).toBe(0);
  });
});

describe('days to expiry', () => {
  it('is signed and null without a date', () => {
    expect(daysToExpiry('2026-03-08', '2026-03-01')).toBe(7);
    expect(daysToExpiry('2026-02-27', '2026-03-01')).toBe(-2);
    expect(daysToExpiry(null, '2026-03-01')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { estimateCourierFee, roundCoord } from './courier-requests.shared.js';

const A = { lat: -1.6585, lng: 29.2205 };
const B = { lat: -1.68, lng: 29.24 };

describe('courier request helpers', () => {
  it('rounds coordinates to 3 decimals', () => {
    expect(roundCoord(-1.65849)).toBe(-1.658);
    expect(roundCoord(29.2205)).toBe(29.221);
  });

  it('estimates from the moto tariff, grows with the size, and refuses an unknown currency', () => {
    const doc = estimateCourierFee(undefined, 'USD', A, B, null, 1.35)!;
    const small = estimateCourierFee(undefined, 'USD', A, B, 'small', 1.35)!;
    const large = estimateCourierFee(undefined, 'USD', A, B, 'large', 1.35)!;
    expect(doc.feeMinor).toBeGreaterThanOrEqual(100);
    expect(small.feeMinor).toBe(doc.feeMinor);
    expect(large.feeMinor).toBeGreaterThan(small.feeMinor);
    expect(estimateCourierFee(undefined, 'CDF', A, B, null, 1.35)!.feeMinor).toBeGreaterThan(doc.feeMinor);
    expect(estimateCourierFee(undefined, 'EUR', A, B, null, 1.35)).toBeNull();
  });
});

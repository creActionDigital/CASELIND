import { describe, expect, it } from 'vitest';
import { percentile, summarize } from '../../../scripts/load/stats.mjs';

describe('load test statistics', () => {
  it('computes nearest-rank percentiles', () => {
    const v = Array.from({ length: 100 }, (_, i) => 100 - i); // unsorted 100..1
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile(v, 99)).toBe(99);
    expect(percentile(v, 100)).toBe(100);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([5, 1], 0)).toBe(1);
    expect(percentile([], 95)).toBeNaN();
  });

  it('summarizes count, error rate and throughput', () => {
    const s = summarize([10, 20, 30, 40], 1, 2);
    expect(s).toMatchObject({ count: 4, failed: 1, errorRate: 0.25, rps: 2, p50: 20, max: 40 });
    expect(summarize([], 0, 5).errorRate).toBe(0);
  });
});

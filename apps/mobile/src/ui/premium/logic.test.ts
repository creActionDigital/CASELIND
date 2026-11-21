import { describe, expect, it } from 'vitest';
import { clamp01, formatDelta, pageIndex, shouldDismiss, staggerDelay } from './logic';

describe('premium logic', () => {
  it('pageIndex borne la page', () => {
    expect(pageIndex(0, 300, 3)).toBe(0);
    expect(pageIndex(310, 300, 3)).toBe(1);
    expect(pageIndex(9999, 300, 3)).toBe(2);
    expect(pageIndex(-50, 300, 3)).toBe(0);
    expect(pageIndex(100, 0, 3)).toBe(0);
  });
  it('clamp01', () => {
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
  });
  it('formatDelta', () => {
    expect(formatDelta(12)).toBe('+12 %');
    expect(formatDelta(-3.26)).toBe('-3.3 %');
    expect(formatDelta(0)).toBe('0 %');
    expect(formatDelta(null)).toBeNull();
  });
  it('staggerDelay plafonné', () => {
    expect(staggerDelay(2)).toBe(80);
    expect(staggerDelay(100)).toBe(320);
  });
  it('shouldDismiss', () => {
    expect(shouldDismiss(200, 0, 500)).toBe(true);
    expect(shouldDismiss(30, 0.2, 500)).toBe(false);
    expect(shouldDismiss(40, 1.2, 500)).toBe(true);
  });
});

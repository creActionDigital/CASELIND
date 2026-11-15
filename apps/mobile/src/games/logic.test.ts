import { describe, expect, it } from 'vitest';
import { clock, completeAnswers, secondsLeft } from './logic';

describe('games logic', () => {
  it('counts the seconds left and never goes below zero', () => {
    const now = Date.parse('2026-11-15T10:00:00Z');
    expect(secondsLeft('2026-11-15T10:01:30Z', now)).toBe(90);
    expect(secondsLeft('2026-11-15T09:59:00Z', now)).toBe(0);
  });
  it('formats a clock', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(120)).toBe('2:00');
    expect(clock(0)).toBe('0:00');
  });
  it('needs one answer per question', () => {
    expect(completeAnswers([1, 0], 2)).toEqual([1, 0]);
    expect(completeAnswers([1], 2)).toBeNull();
    expect(completeAnswers([1, undefined], 2)).toBeNull();
  });
});

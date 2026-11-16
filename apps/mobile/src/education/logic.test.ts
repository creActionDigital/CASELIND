import { describe, expect, it } from 'vitest';
import { completeAnswers, correctIndex, formatCountdown, parseOptions } from './logic';

describe('education logic', () => {
  it('needs one answer per question before sending', () => {
    expect(completeAnswers([1, 0], 2)).toEqual([1, 0]);
    expect(completeAnswers([1], 2)).toBeNull();
    expect(completeAnswers([1, undefined], 2)).toBeNull();
    expect(completeAnswers([0, 0, 2], 2)).toEqual([0, 0]);
  });
  it('formats the countdown and stops at zero', () => {
    expect(formatCountdown(125)).toBe('2:05');
    expect(formatCountdown(-3)).toBe('0:00');
  });
  it('splits options one per line and ignores blanks', () => {
    expect(parseOptions(' Kinshasa \n\nGoma\n  ')).toEqual(['Kinshasa', 'Goma']);
  });
  it('converts a 1-based correct answer, refusing anything outside the options', () => {
    expect(correctIndex('2', 3)).toBe(1);
    expect(correctIndex('0', 3)).toBeNull();
    expect(correctIndex('4', 3)).toBeNull();
    expect(correctIndex('1.5', 3)).toBeNull();
    expect(correctIndex('', 3)).toBeNull();
  });
});

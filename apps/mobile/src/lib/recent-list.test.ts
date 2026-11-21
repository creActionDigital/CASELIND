import { describe, expect, it } from 'vitest';
import { pushRecent } from './recent-logic';

describe('pushRecent', () => {
  it('met en tête, sans doublon ni vide, et plafonne', () => {
    expect(pushRecent(['a', 'b'], 'B')).toEqual(['B', 'a']);
    expect(pushRecent(['a'], '  ')).toEqual(['a']);
    expect(pushRecent(['1', '2', '3'], '4', 3)).toEqual(['4', '1', '2']);
  });
});

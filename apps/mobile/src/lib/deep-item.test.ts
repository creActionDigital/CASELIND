import { describe, expect, it } from 'vitest';
import { mergeDeepItem } from './deep-item';

describe('mergeDeepItem', () => {
  it('ajoute en tête seulement si absent', () => {
    expect(mergeDeepItem([{ id: 'a' }], { id: 'b' })).toEqual([{ id: 'b' }, { id: 'a' }]);
    expect(mergeDeepItem([{ id: 'a' }], { id: 'a' })).toEqual([{ id: 'a' }]);
    expect(mergeDeepItem([{ id: 'a' }], undefined)).toEqual([{ id: 'a' }]);
  });
});

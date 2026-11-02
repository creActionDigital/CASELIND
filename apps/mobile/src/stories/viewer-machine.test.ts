import type { StoryGroup } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { next, previous, startPosition } from './viewer-machine';

const group = (userId: string, n: number, seenUpTo = 0): StoryGroup =>
  ({ author: { userId }, stories: Array.from({ length: n }, (_, i) => ({ seen: i < seenUpTo })), hasUnseen: seenUpTo < n }) as StoryGroup;
const groups = [group('a', 2), group('b', 1), group('c', 3)];

describe('viewer machine', () => {
  it('démarre à la première story non vue de l’auteur', () => {
    expect(startPosition([group('a', 3, 2)], 'a')).toEqual({ group: 0, story: 2 });
    expect(startPosition(groups, 'zzz')).toBeNull();
  });
  it('avance dans le groupe, puis chez l’auteur suivant, puis ferme', () => {
    expect(next(groups, { group: 0, story: 0 })).toEqual({ kind: 'move', pos: { group: 0, story: 1 } });
    expect(next(groups, { group: 0, story: 1 })).toEqual({ kind: 'move', pos: { group: 1, story: 0 } });
    expect(next(groups, { group: 2, story: 2 })).toEqual({ kind: 'close' });
  });
  it('recule, passe à la dernière story de l’auteur précédent, reste au début', () => {
    expect(previous(groups, { group: 0, story: 1 })).toEqual({ kind: 'move', pos: { group: 0, story: 0 } });
    expect(previous(groups, { group: 2, story: 0 })).toEqual({ kind: 'move', pos: { group: 1, story: 0 } });
    expect(previous(groups, { group: 1, story: 0 })).toEqual({ kind: 'move', pos: { group: 0, story: 1 } });
    expect(previous(groups, { group: 0, story: 0 })).toEqual({ kind: 'move', pos: { group: 0, story: 0 } });
  });
});

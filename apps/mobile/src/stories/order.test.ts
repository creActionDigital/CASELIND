import type { StoryGroup } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { firstUnseenIndex, orderStoryGroups } from './order';

const story = (seen: boolean) => ({ seen }) as StoryGroup['stories'][number];
const group = (userId: string, seen: boolean[]): StoryGroup =>
  ({ author: { userId }, stories: seen.map(story), hasUnseen: seen.some((s) => !s) }) as StoryGroup;

describe('orderStoryGroups', () => {
  it('place soi, puis les non vues, puis les vues, en gardant l’ordre serveur', () => {
    const out = orderStoryGroups([group('seen1', [true]), group('u1', [false]), group('me', [true]), group('u2', [true, false])], 'me');
    expect(out.map((g) => g.author.userId)).toEqual(['me', 'u1', 'u2', 'seen1']);
  });
  it('ignore les groupes vides', () => {
    expect(orderStoryGroups([group('a', [])], 'me')).toEqual([]);
  });
  it('trouve la première story non vue, sinon 0', () => {
    expect(firstUnseenIndex(group('a', [true, true, false]))).toBe(2);
    expect(firstUnseenIndex(group('a', [true, true]))).toBe(0);
  });
});

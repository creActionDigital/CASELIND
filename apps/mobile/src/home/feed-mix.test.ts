import { describe, expect, it } from 'vitest';
import { mixFeed } from './feed-mix';

const posts = Array.from({ length: 9 }, (_, i) => ({ id: `a${i}` }));
describe('mixFeed', () => {
  it('intercale un produit tous les N éléments sans doublon', () => {
    const out = mixFeed(posts, [{ id: 'x' }, { id: 'y' }], [], 4);
    expect(out.map((e) => e.type).join()).toBe('post,post,post,post,product,post,post,post,post,product,post');
  });
  it('sans produit ni promotion, ne renvoie que les publications', () => {
    expect(mixFeed(posts, [], []).every((e) => e.type === 'post')).toBe(true);
  });
  it('alterne avec les promotions quand elles existent', () => {
    const out = mixFeed(posts, [{ id: 'x' }], [{ id: 'm' }], 4);
    expect(out.filter((e) => e.type === 'promo')).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { socialTarget } from './routing';
import {
  buildOptimisticPost,
  groupComments,
  formatRelativeTime,
  mergeServerPost,
  nextReaction,
  prependPost,
  removePost,
  totalReactions,
  updatePost,
  pollPercent,
  withMyReaction,
  type CachedPost,
  type PostPages,
} from './logic';
import type { Post } from './types';

const AUTHOR = { id: '22222222-2222-4222-8222-222222222222', handle: 'ada', displayName: 'Ada', avatarUrl: null };
const CID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-02T12:00:00.000Z');

function post(over: Partial<CachedPost> = {}): CachedPost {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    author: AUTHOR,
    kind: 'text',
    body: 'salut',
    visibility: 'public',
    media: [],
    reactions: { like: 2, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 },
    myReaction: null,
    commentsCount: 0,
    moderation: 'visible',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  };
}
const pages = (...items: CachedPost[][]): PostPages => ({
  pages: items.map((i) => ({ items: i, nextCursor: null })),
  pageParams: items.map(() => undefined),
});

describe('formatRelativeTime', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  it('formats minutes, hours and days', () => {
    expect(formatRelativeTime(ago(10_000), 'fr', NOW)).toBe("à l'instant");
    expect(formatRelativeTime(ago(10_000), 'en', NOW)).toBe('now');
    expect(formatRelativeTime(ago(5 * 60_000), 'fr', NOW)).toBe('5 min');
    expect(formatRelativeTime(ago(3 * 3_600_000), 'fr', NOW)).toBe('3 h');
    expect(formatRelativeTime(ago(2 * 86_400_000), 'fr', NOW)).toBe('2 j');
    expect(formatRelativeTime(ago(2 * 86_400_000), 'en', NOW)).toBe('2 d');
  });
  it('falls back to a short date after a week and tolerates future/invalid dates', () => {
    expect(formatRelativeTime(ago(30 * 86_400_000), 'en', NOW)).toMatch(/Oct/);
    expect(formatRelativeTime(new Date(NOW.getTime() + 60_000).toISOString(), 'fr', NOW)).toBe("à l'instant");
    expect(formatRelativeTime('nope', 'fr', NOW)).toBe('');
  });
});

describe('reactions', () => {
  it('toggles the same reaction off and switches otherwise', () => {
    expect(nextReaction(null, 'like')).toBe('like');
    expect(nextReaction('like', 'like')).toBeNull();
    expect(nextReaction('like', 'love')).toBe('love');
  });
  it('adds, switches and removes while keeping counts consistent', () => {
    const p = post();
    const liked = withMyReaction(p, 'like');
    expect(liked.reactions.like).toBe(3);
    expect(totalReactions(liked.reactions)).toBe(3);
    const loved = withMyReaction(liked, 'love');
    expect(loved.reactions).toMatchObject({ like: 2, love: 1 });
    const none = withMyReaction(loved, null);
    expect(none.reactions).toMatchObject({ like: 2, love: 0 });
    expect(none.myReaction).toBeNull();
    expect(withMyReaction(p, null)).toBe(p);
  });
  it('never goes below zero', () => {
    const p = post({ myReaction: 'angry', reactions: { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 } });
    expect(withMyReaction(p, null).reactions.angry).toBe(0);
  });
});

describe('optimistic posts', () => {
  it('builds a local post whose id is the clientId', () => {
    const p = buildOptimisticPost({ clientId: CID, author: AUTHOR, body: 'x', visibility: 'friends', media: [{ uri: 'file://a.mp4', mime: 'video/mp4' }], now: NOW });
    expect(p).toMatchObject({ id: CID, kind: 'video', local: 'sending', progress: 0, visibility: 'friends' });
    expect(buildOptimisticPost({ clientId: CID, author: AUTHOR, body: 'x', visibility: 'public', media: [] }).kind).toBe('text');
  });
  it('prepends to the first page without duplicates', () => {
    const a = post({ id: 'a' });
    const b = post({ id: 'b' });
    const next = prependPost(pages([a], [b]), b)!;
    expect(next.pages[0].items.map((p) => p.id)).toEqual(['b', 'a']);
    expect(next.pages[1].items).toEqual([]);
    expect(prependPost(undefined, a)).toBeUndefined();
  });
  it('replaces the optimistic post by the server one, or drops a duplicate', () => {
    const local = post({ id: CID, local: 'sending' });
    const server: Post = post({ id: '66666666-6666-4666-8666-666666666666' });
    const merged = mergeServerPost(pages([local, post({ id: 'z' })]), CID, server)!;
    expect(merged.pages[0].items.map((p) => p.id)).toEqual([server.id, 'z']);
    // La réponse est arrivée par un rechargement avant la fin de l'envoi : un seul exemplaire.
    const dup = mergeServerPost(pages([server, local]), CID, server)!;
    expect(dup.pages[0].items.map((p) => p.id)).toEqual([server.id]);
    // Liste rechargée sans l'élément provisoire : insertion en tête.
    expect(mergeServerPost(pages([post({ id: 'z' })]), CID, server)!.pages[0].items[0].id).toBe(server.id);
  });
  it('updates and removes one post', () => {
    const data = pages([post({ id: 'a' }), post({ id: 'b' })]);
    expect(updatePost(data, 'a', (p) => ({ ...p, body: 'edit' }))!.pages[0].items[0].body).toBe('edit');
    expect(removePost(data, 'a')!.pages[0].items.map((p) => p.id)).toEqual(['b']);
  });
});

describe('groupComments', () => {
  const c = (id: string, replyToId: string | null = null) => ({ id, replyToId });
  it('nests replies under their parent and keeps order', () => {
    const t = groupComments([c('a'), c('b'), c('a1', 'a'), c('a2', 'a'), c('b1', 'b')]);
    expect(t.map((x) => x.comment.id)).toEqual(['a', 'b']);
    expect(t[0].replies.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(t[1].replies.map((r) => r.id)).toEqual(['b1']);
  });
  it('shows an orphan reply as a top-level comment', () => {
    expect(groupComments([c('x', 'missing')]).map((x) => x.comment.id)).toEqual(['x']);
  });
});

describe('socialTarget', () => {
  it('opens the post when present, else the actor profile, else nothing', () => {
    expect(socialTarget({ kind: 'comment', postId: 'p1', actorId: 'u1' })).toEqual({ pathname: '/post/[postId]', params: { postId: 'p1' } });
    expect(socialTarget({ kind: 'follow', actorId: 'u1' })).toEqual({ pathname: '/user/[userId]', params: { userId: 'u1' } });
    expect(socialTarget({ conversationId: 'c1' })).toBeNull();
    expect(socialTarget(null)).toBeNull();
  });
});

describe('pollPercent', () => {
  it('arrondit et évite la division par zéro', () => {
    expect(pollPercent(1, 3)).toBe(33);
    expect(pollPercent(0, 0)).toBe(0);
  });
});

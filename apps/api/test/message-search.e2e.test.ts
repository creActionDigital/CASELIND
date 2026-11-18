import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { escapeLike, snippetAround } from '../src/messaging/message-search.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
}

async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id };
}

async function group(owner: TU, members: TU[], title = 'Famille'): Promise<string> {
  const res = await ctx.http
    .post('/v1/conversations')
    .set(bearer(owner.token))
    .send({ kind: 'group', title, memberIds: members.map((m) => m.id) })
    .expect(201);
  return res.body.id;
}

async function direct(a: TU, b: TU): Promise<string> {
  const res = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id });
  return res.body.id;
}

const say = async (u: TU, convId: string, body: string): Promise<string> =>
  (
    await ctx.http
      .post(`/v1/conversations/${convId}/messages`)
      .set(bearer(u.token))
      .send({ clientId: randomUUID(), kind: 'text', body })
      .expect(201)
  ).body.id;

const search = (u: TU, query: Record<string, string | number>) =>
  ctx.http.get('/v1/messages/search').set(bearer(u.token)).query(query);

describe('message search', () => {
  it('finds text in the caller conversations only, with an excerpt, the conversation and the date', async () => {
    const [a, b, outsider] = [await user(), await user(), await user()];
    const g = await group(a, [b], 'Les copains');
    const dm = await direct(a, b);
    const m1 = await say(a, g, 'Rendez-vous samedi pour le BARBECUE chez moi');
    await say(b, dm, 'On fait un barbecue aussi ?');
    await say(a, g, 'rien à voir');
    const res = await search(b, { q: 'barbecue' }).expect(200);
    expect(res.body.items).toHaveLength(2);
    const hit = res.body.items.find((h: { messageId: string }) => h.messageId === m1);
    expect(hit).toMatchObject({ conversationId: g, conversationKind: 'group', conversationTitle: 'Les copains', senderId: a.id });
    expect(hit.snippet.toLowerCase()).toContain('barbecue');
    expect(Date.parse(hit.createdAt)).not.toBeNaN();
    const dmHit = res.body.items.find((h: { conversationId: string }) => h.conversationId === dm);
    expect(dmHit.conversationKind).toBe('direct');
    expect(dmHit.conversationTitle).toEqual(expect.any(String)); // the peer's name
    expect(res.body.nextCursor).toBeNull();

    expect((await search(outsider, { q: 'barbecue' }).expect(200)).body.items).toEqual([]);
    // Narrowed to one conversation; a foreign conversation is a plain 404.
    expect((await search(b, { q: 'barbecue', conversationId: g }).expect(200)).body.items).toHaveLength(1);
    await search(outsider, { q: 'barbecue', conversationId: g }).expect(404);
    await search(b, { q: 'barbecue', conversationId: randomUUID() }).expect(404);
  });

  it('starts at the member entry, skips hidden, recalled and former conversations', async () => {
    const [a, b] = [await user(), await user()];
    const g = await group(a, [b]);
    await say(a, g, 'secret-avant-arrivee zebra');
    const late = await user();
    await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(a.token)).send({ userIds: [late.id] }).expect(201);
    const after = await say(a, g, 'message-apres zebra');
    const seen = await search(late, { q: 'zebra' }).expect(200);
    expect(seen.body.items.map((h: { messageId: string }) => h.messageId)).toEqual([after]);
    expect((await search(a, { q: 'zebra' }).expect(200)).body.items).toHaveLength(2);

    // Hidden for me / recalled for all.
    await ctx.http.delete(`/v1/messages/${after}`).set(bearer(late.token)).expect(204);
    expect((await search(late, { q: 'zebra' }).expect(200)).body.items).toEqual([]);
    expect((await search(b, { q: 'zebra' }).expect(200)).body.items).toHaveLength(2);
    await ctx.http.delete(`/v1/messages/${after}?scope=all`).set(bearer(a.token)).expect(204);
    expect((await search(b, { q: 'zebra' }).expect(200)).body.items).toHaveLength(1);

    // Left the group: nothing of it any more.
    await ctx.http.delete(`/v1/conversations/${g}/members/${b.id}`).set(bearer(b.token)).expect(204);
    expect((await search(b, { q: 'zebra' }).expect(200)).body.items).toEqual([]);
  });

  it('skips expired messages, system messages and senders blocked either way', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const g = await group(a, [b, c], 'titre-unique-systeme');
    const id = await say(a, g, 'phrase-expiree');
    await ctx.sql.query(`UPDATE messages SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    expect((await search(b, { q: 'phrase-expiree' }).expect(200)).body.items).toEqual([]);
    // The group title only lives in a system event, never in a hit.
    expect((await search(b, { q: 'titre-unique-systeme' }).expect(200)).body.items).toEqual([]);

    await say(b, g, 'mot-de-b kiwi');
    await say(c, g, 'mot-de-c kiwi');
    expect((await search(a, { q: 'kiwi' }).expect(200)).body.items).toHaveLength(2);
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    const res = await search(a, { q: 'kiwi' }).expect(200);
    expect(res.body.items.map((h: { senderId: string }) => h.senderId)).toEqual([c.id]);
    expect((await search(b, { q: 'kiwi' }).expect(200)).body.items.map((h: { senderId: string }) => h.senderId)).toEqual([c.id, b.id]);
  });

  it('treats % and _ as literal characters', async () => {
    const [a, b] = [await user(), await user()];
    const g = await group(a, [b]);
    const pct = await say(a, g, 'remise de 50% aujourd hui');
    const und = await say(a, g, 'fichier mon_nom.txt');
    await say(a, g, 'remise de 50 pourcent');
    await say(a, g, 'fichier monXnom.txt');
    await say(a, g, 'back\\slash ici');
    expect((await search(b, { q: '50%' }).expect(200)).body.items.map((h: { messageId: string }) => h.messageId)).toEqual([pct]);
    expect((await search(b, { q: 'mon_nom' }).expect(200)).body.items.map((h: { messageId: string }) => h.messageId)).toEqual([und]);
    expect((await search(b, { q: '%%' }).expect(200)).body.items).toEqual([]);
    expect((await search(b, { q: '__' }).expect(200)).body.items).toEqual([]);
    expect((await search(b, { q: 'back\\s' }).expect(200)).body.items).toHaveLength(1);
  });

  it('validates the query and paginates with a cursor', async () => {
    const [a, b] = [await user(), await user()];
    const g = await group(a, [b]);
    for (let i = 0; i < 5; i++) await say(a, g, `pagination numero ${i}`);
    await search(b, {}).expect(400);
    await search(b, { q: 'x' }).expect(400);
    await search(b, { q: ' x ' }).expect(400);
    await search(b, { q: 'x'.repeat(101) }).expect(400);
    await search(b, { q: 'ab', limit: 0 }).expect(400);
    await search(b, { q: 'ab', limit: 51 }).expect(400);
    await search(b, { q: 'ab', cursor: 'garbage' }).expect(400);
    await ctx.http.get('/v1/messages/search?q=pagination').expect(401);

    const p1 = await search(b, { q: 'pagination', limit: 2 }).expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await search(b, { q: 'pagination', limit: 2, cursor: p1.body.nextCursor }).expect(200);
    const p3 = await search(b, { q: 'pagination', limit: 2, cursor: p2.body.nextCursor }).expect(200);
    const all = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((h: { messageId: string }) => h.messageId);
    expect(new Set(all).size).toBe(5);
    expect(p3.body.nextCursor).toBeNull();
  });
});

describe('search helpers', () => {
  it('escapes LIKE wildcards and builds a short excerpt around the match', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    const body = `${'x '.repeat(100)}NEEDLE${' y'.repeat(100)}`;
    const s = snippetAround(body, 'needle');
    expect(s).toContain('NEEDLE');
    expect(s.length).toBeLessThan(130);
    expect(s.startsWith('…') && s.endsWith('…')).toBe(true);
    expect(snippetAround('court', 'cou')).toBe('court');
  });
});

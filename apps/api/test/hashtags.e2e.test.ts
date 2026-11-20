import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseHashtags } from '../src/creator/hashtags.js';
import { MIGRATIONS_DIR } from '../src/db/migrator.js';
import { bearer, createTestContext, type TestContext } from './helpers.js';
import { creatorKit, type TU } from './creator-helpers.js';

let ctx: TestContext;
let kit: ReturnType<typeof creatorKit>;

beforeAll(async () => {
  ctx = await createTestContext();
  kit = creatorKit(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const tagsOf = async (postId: string): Promise<string[]> =>
  (await ctx.sql.query(`SELECT tag FROM post_hashtags WHERE post_id = $1 ORDER BY tag`, [postId])).rows.map((r) => r.tag);
const tagPosts = (u: TU, tag: string) => ctx.http.get(`/v1/hashtags/${encodeURIComponent(tag)}/posts`).set(bearer(u.token));

describe('parseHashtags', () => {
  it('extracts distinct lowercase tags with accents, ignores urls, words glued to #, numbers and long tags', () => {
    expect(parseHashtags('Salut #Kinshasa #kinshasa #été_2026 et #Ça va')).toEqual(['kinshasa', 'été_2026', 'ça']);
    expect(parseHashtags('mail a#b, https://x.test/page#anchor, #123, #' + 'a'.repeat(41) + ', ##double')).toEqual([]);
    expect(parseHashtags('(#ok) "#aussi" #fin.')).toEqual(['ok', 'aussi', 'fin']);
    expect(parseHashtags(Array.from({ length: 15 }, (_, i) => `#t${i}`).join(' '))).toHaveLength(10);
    expect(parseHashtags(null)).toEqual([]);
  });
});

describe('hashtags', () => {
  it('fills the tags on creation and replaces them on edit', async () => {
    const u = await kit.user();
    const id = await kit.post(u, 'Premier jour #Foot et #musique');
    expect(await tagsOf(id)).toEqual(['foot', 'musique']);
    await ctx.http.patch(`/v1/posts/${id}`).set(bearer(u.token)).send({ body: 'Maintenant #cuisine seulement' }).expect(200);
    expect(await tagsOf(id)).toEqual(['cuisine']);
    await ctx.http.patch(`/v1/posts/${id}`).set(bearer(u.token)).send({ visibility: 'followers' }).expect(200);
    expect(await tagsOf(id)).toEqual(['cuisine']);
  });

  it('lists the posts of a tag the reader can see, not hidden, deleted, private or blocked ones', async () => {
    const a = await kit.user();
    const b = await kit.user();
    const reader = await kit.user();
    const tag = `rumba${Date.now()}`;
    const pub = await kit.post(a, `#${tag} public`);
    const hid = await kit.post(a, `#${tag} masquee`);
    const priv = await kit.post(a, `#${tag} prive`, 'private');
    const del = await kit.post(a, `#${tag} supprimee`);
    const foll = await kit.post(a, `#${tag} abonnes`, 'followers');
    const blockedPost = await kit.post(b, `#${tag} bloque`);
    await ctx.sql.query(`UPDATE posts SET hidden = true WHERE id = $1`, [hid]);
    await ctx.http.delete(`/v1/posts/${del}`).set(bearer(a.token)).expect(204);
    await kit.block(reader, b);

    const ids = (await tagPosts(reader, tag.toUpperCase()).expect(200)).body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual([pub]);
    for (const hiddenId of [hid, priv, del, foll, blockedPost]) expect(ids).not.toContain(hiddenId);
    await kit.follow(reader, a);
    expect((await tagPosts(reader, tag).expect(200)).body.items.map((p: { id: string }) => p.id)).toEqual([foll, pub]);
    await tagPosts(reader, 'bad tag!').expect(400);
  });

  it('ranks trending tags on public visible recent posts only and suggests by prefix', async () => {
    const a = await kit.user();
    const reader = await kit.user();
    const t1 = `top${Date.now()}`;
    const t2 = `autre${Date.now()}`;
    const t3 = `masque${Date.now()}`;
    await kit.post(a, `#${t1} un`);
    await kit.post(await kit.user(), `#${t1} deux`);
    await kit.post(a, `#${t2} seul`);
    await kit.post(a, `#${t2} prive`, 'private');
    const h = await kit.post(a, `#${t3} un`);
    await ctx.sql.query(`UPDATE posts SET hidden = true WHERE id = $1`, [h]);
    const old = await kit.post(a, `#${t3} vieux`);
    await ctx.sql.query(`UPDATE posts SET created_at = now() - interval '3 days' WHERE id = $1`, [old]);

    const res = await ctx.http.get('/v1/hashtags/trending').set(bearer(reader.token)).expect(200);
    const counts = new Map<string, number>(res.body.items.map((i: { tag: string; postsCount: number }) => [i.tag, i.postsCount]));
    expect(res.body.hours).toBe(24);
    expect(counts.get(t1)).toBe(2);
    expect(counts.get(t2)).toBe(1);
    expect(counts.has(t3)).toBe(false);
    expect(res.body.items.length).toBeLessThanOrEqual(20);
    const week = await ctx.http.get('/v1/hashtags/trending?hours=168').set(bearer(reader.token)).expect(200);
    expect(week.body.items.find((i: { tag: string }) => i.tag === t3)?.postsCount).toBe(1);
    await ctx.http.get('/v1/hashtags/trending?hours=0').set(bearer(reader.token)).expect(400);

    const sug = await ctx.http.get(`/v1/hashtags/suggest?q=${encodeURIComponent('#' + t1.slice(0, 6))}`).set(bearer(reader.token)).expect(200);
    expect(sug.body.items.map((i: { tag: string }) => i.tag)).toContain(t1);
    const none = await ctx.http.get('/v1/hashtags/suggest?q=%25%25').set(bearer(reader.token)).expect(200);
    expect(none.body.items).toEqual([]);
  });

  it('backfills existing posts from the migration regex (10 tags at most, no urls)', async () => {
    const a = await kit.user();
    const id = randomUUID();
    const many = Array.from({ length: 12 }, (_, i) => `#tag${String.fromCharCode(97 + i)}`).join(' ');
    await ctx.sql.query(
      `INSERT INTO posts (id, author_id, client_id, kind, body, visibility) VALUES ($1, $2, gen_random_uuid(), 'text', $3, 'public')`,
      [id, a.id, `Vieux #Été #été ${many} https://x.test/p#frag mot#colle #123`],
    );
    const sql = readFileSync(`${MIGRATIONS_DIR}/0086_creator_tools.sql`, 'utf8');
    const start = sql.indexOf('INSERT INTO post_hashtags');
    const backfill = sql.slice(start, sql.indexOf('ON CONFLICT DO NOTHING;', start) + 'ON CONFLICT DO NOTHING;'.length);
    await ctx.sql.query(`DELETE FROM post_hashtags WHERE post_id = $1`, [id]);
    await ctx.sql.query(backfill);
    const tags = await tagsOf(id);
    expect(tags).toHaveLength(10);
    expect(tags).toContain('été');
    expect(tags).not.toContain('frag');
    expect(tags).not.toContain('colle');
    expect(tags).not.toContain('123');
  });

  it('removes the tags with the post (account purge cascades)', async () => {
    const u = await kit.user();
    const id = await kit.post(u, '#ephemere');
    await ctx.sql.query(`DELETE FROM posts WHERE id = $1`, [id]);
    expect(await tagsOf(id)).toEqual([]);
  });
});

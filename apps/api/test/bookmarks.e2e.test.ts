import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const save = (u: TU, id: string) => ctx.http.put(`/v1/me/bookmarks/posts/${id}`).set(bearer(u.token));
const list = (u: TU, qs = '') => ctx.http.get(`/v1/me/bookmarks/posts${qs}`).set(bearer(u.token));

describe('post bookmarks', () => {
  it('saves idempotently, flags the post as bookmarked and lists newest first', async () => {
    const author = await kit.user();
    const me = await kit.user();
    const a = await kit.post(author, 'Premier');
    const b = await kit.post(author, 'Second');
    await save(me, a).expect(204);
    await save(me, a).expect(204);
    await save(me, b).expect(204);

    const res = await list(me).expect(200);
    expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([b, a]);
    expect(res.body.items.every((p: { bookmarked: boolean }) => p.bookmarked)).toBe(true);

    const detail = await ctx.http.get(`/v1/posts/${a}`).set(bearer(me.token)).expect(200);
    expect(detail.body.bookmarked).toBe(true);
    const other = await ctx.http.get(`/v1/posts/${a}`).set(bearer(author.token)).expect(200);
    expect(other.body.bookmarked).toBe(false);

    await ctx.http.delete(`/v1/me/bookmarks/posts/${a}`).set(bearer(me.token)).expect(204);
    await ctx.http.delete(`/v1/me/bookmarks/posts/${a}`).set(bearer(me.token)).expect(204);
    expect((await list(me).expect(200)).body.items).toHaveLength(1);
  });

  it('paginates with a cursor', async () => {
    const author = await kit.user();
    const me = await kit.user();
    for (let i = 0; i < 3; i += 1) await save(me, await kit.post(author, `p${i}`)).expect(204);
    const page1 = await list(me, '?limit=2').expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await list(me, `?limit=2&cursor=${page1.body.nextCursor}`).expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('refuses a post the caller cannot see (404) and leaves out posts that became invisible', async () => {
    const author = await kit.user();
    const me = await kit.user();
    const priv = await kit.post(author, 'secret', 'private');
    await save(me, priv).expect(404);
    await save(me, 'not-a-uuid').expect(404);

    const pub = await kit.post(author, 'public');
    const hid = await kit.post(author, 'to hide');
    const gone = await kit.post(author, 'to delete');
    for (const id of [pub, hid, gone]) await save(me, id).expect(204);
    await ctx.sql.query(`UPDATE posts SET hidden = true WHERE id = $1`, [hid]);
    await ctx.http.delete(`/v1/posts/${gone}`).set(bearer(author.token)).expect(204);
    expect((await list(me).expect(200)).body.items.map((p: { id: string }) => p.id)).toEqual([pub]);

    await ctx.http.patch(`/v1/posts/${pub}`).set(bearer(author.token)).send({ visibility: 'private' }).expect(200);
    expect((await list(me).expect(200)).body.items).toHaveLength(0);
  });

  it('omits the posts of a blocked author', async () => {
    const author = await kit.user();
    const me = await kit.user();
    const id = await kit.post(author, 'visible for now');
    await save(me, id).expect(204);
    await kit.block(me, author);
    expect((await list(me).expect(200)).body.items).toHaveLength(0);
  });

  it('caps the list at 1000 (409 bookmarks_full)', async () => {
    const author = await kit.user();
    const me = await kit.user();
    const id = await kit.post(author, 'one more');
    await ctx.sql.query(
      `INSERT INTO posts (author_id, client_id, kind, body, visibility)
       SELECT $1, gen_random_uuid(), 'text', 'filler', 'public' FROM generate_series(1, 1000)`,
      [author.id],
    );
    await ctx.sql.query(
      `INSERT INTO post_bookmarks (user_id, post_id) SELECT $1, id FROM posts WHERE body = 'filler' LIMIT 1000`,
      [me.id],
    );
    const res = await save(me, id).expect(409);
    expect(res.body.error.details.reason).toBe('bookmarks_full');
    // Re-saving a post already in the list stays idempotent.
    const first = await ctx.sql.query(`SELECT post_id FROM post_bookmarks WHERE user_id = $1 LIMIT 1`, [me.id]);
    await save(me, first.rows[0].post_id).expect(204);
  });

  it('is behind authentication', async () => {
    await ctx.http.get('/v1/me/bookmarks/posts').expect(401);
  });
});

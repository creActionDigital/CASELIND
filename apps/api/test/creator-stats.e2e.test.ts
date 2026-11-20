import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
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

const seen = (u: TU, postIds: string[]) => ctx.http.post('/v1/posts/impressions').set(bearer(u.token)).send({ postIds });
const overview = (u: TU, days?: number) => ctx.http.get(`/v1/me/creator/overview${days ? `?days=${days}` : ''}`).set(bearer(u.token));
const today = () => new Date().toISOString().slice(0, 10);

describe('impressions', () => {
  it('counts impressions and daily unique viewers, never for the author, hidden or invisible posts', async () => {
    const author = await kit.user();
    const v1 = await kit.user();
    const v2 = await kit.user();
    const pub = await kit.post(author, 'vue');
    const priv = await kit.post(author, 'prive', 'private');
    const hid = await kit.post(author, 'masquee');
    await ctx.sql.query(`UPDATE posts SET hidden = true WHERE id = $1`, [hid]);

    expect((await seen(author, [pub])).body.recorded).toBe(0);
    expect((await seen(v1, [pub, priv, hid, randomUUID()])).body.recorded).toBe(1);
    expect((await seen(v1, [pub])).body.recorded).toBe(1);
    await seen(v2, [pub, pub]).expect(200);

    const row = await ctx.sql.query(`SELECT impressions, unique_viewers FROM post_impressions WHERE post_id = $1 AND day = $2`, [pub, today()]);
    expect(row.rows[0]).toEqual({ impressions: 3, unique_viewers: 2 });
    for (const id of [priv, hid]) expect((await ctx.sql.query(`SELECT 1 FROM post_impressions WHERE post_id = $1`, [id])).rows).toHaveLength(0);

    // No identity: the de-duplication table holds 8-byte hashes only.
    const hashes = await ctx.sql.query(`SELECT encode(viewer_hash, 'hex') AS h FROM post_impression_viewers WHERE post_id = $1`, [pub]);
    expect(hashes.rows).toHaveLength(2);
    for (const { h } of hashes.rows) {
      expect(h).toHaveLength(16);
      for (const id of [v1.id, v2.id]) expect(id.replace(/-/g, '')).not.toContain(h);
    }
  });

  it('validates the batch and brakes a flood', async () => {
    const v = await kit.user();
    await seen(v, []).expect(400);
    await seen(v, Array.from({ length: 51 }, () => randomUUID())).expect(400);
    await seen(v, ['nope']).expect(400);
    for (let i = 0; i < 30; i += 1) await seen(v, [randomUUID()]).expect(200);
    await seen(v, [randomUUID()]).expect(429);
  });
});

describe('creator overview', () => {
  it('returns a dense daily series and totals without any viewer identity', async () => {
    const author = await kit.user();
    const fan = await kit.user();
    const other = await kit.user();
    const best = await kit.post(author, 'la meilleure');
    const quiet = await kit.post(author, 'la discrete');
    await seen(fan, [best, quiet]);
    await seen(other, [best]);
    await ctx.http.put(`/v1/posts/${best}/reaction`).set(bearer(fan.token)).send({ type: 'love' }).expect(200);
    await ctx.http.put(`/v1/posts/${best}/reaction`).set(bearer(author.token)).send({ type: 'like' }).expect(200); // own reaction: not counted
    await ctx.http.post(`/v1/posts/${best}/comments`).set(bearer(fan.token)).send({ body: 'bravo' }).expect(201);
    await kit.follow(fan, author);
    await ctx.http.put(`/v1/me/bookmarks/posts/${best}`).set(bearer(fan.token)).expect(204);

    const res = await overview(author, 7).expect(200);
    expect(res.body.mode).toBe('sandbox');
    expect(res.body.series).toHaveLength(7);
    expect(res.body.series.at(-1).date).toBe(today());
    expect(res.body.totals).toEqual({ impressions: 3, uniqueViewers: 3, reactions: 1, comments: 1, bookmarks: 1, newFollowers: 1 });
    expect(res.body.series.at(-1)).toMatchObject({ impressions: 3, uniqueViewers: 3, reactions: 1, comments: 1, newFollowers: 1 });
    expect(res.body.topPosts[0]).toMatchObject({ postId: best, impressions: 2, reactions: 1, comments: 1, excerpt: 'la meilleure' });
    expect(res.body.topPosts).toHaveLength(2);
    expect(res.body.tipsReceived).toEqual([]);
    expect(res.body.boosts).toEqual([]);
    const text = JSON.stringify(res.body);
    for (const id of [fan.id, other.id]) expect(text).not.toContain(id);

    expect((await overview(author, 30).expect(200)).body.series).toHaveLength(30);
    expect((await overview(author, 90).expect(200)).body.series).toHaveLength(90);
    expect((await overview(author).expect(200)).body.days).toBe(7);
    await overview(author, 15).expect(400);
    const empty = await overview(await kit.user(), 7).expect(200);
    expect(empty.body.totals.impressions).toBe(0);
    expect(empty.body.series.every((d: { impressions: number }) => d.impressions === 0)).toBe(true);
  });

  it('puts past days in their own bucket', async () => {
    const author = await kit.user();
    const id = await kit.post(author, 'hier');
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await ctx.sql.query(`INSERT INTO post_impressions (post_id, day, impressions, unique_viewers) VALUES ($1, $2, 5, 4)`, [id, yesterday]);
    const res = await overview(author, 7).expect(200);
    expect(res.body.series.find((d: { date: string }) => d.date === yesterday)).toMatchObject({ impressions: 5, uniqueViewers: 4 });
    expect(res.body.totals.impressions).toBe(5);
  });
});

describe('maintenance', () => {
  it('drops de-duplication rows older than 8 days and ends boosts past their end', async () => {
    const author = await kit.user();
    const id = await kit.post(author, 'ancienne');
    await ctx.sql.query(`INSERT INTO post_impression_viewers (post_id, day, viewer_hash) VALUES ($1, current_date - 9, '\\x0102030405060708'), ($1, current_date - 2, '\\x0102030405060709')`, [id]);
    await ctx.sql.query(
      `INSERT INTO post_boosts (post_id, user_id, client_id, starts_at, ends_at, budget_minor, currency)
       VALUES ($1, $2, gen_random_uuid(), now() - interval '3 days', now() - interval '1 day', 500, 'USD')`,
      [id, author.id],
    );
    await ctx.app.get(MaintenanceService).runOnce();
    const left = await ctx.sql.query(`SELECT count(*)::int AS n FROM post_impression_viewers WHERE post_id = $1`, [id]);
    expect(left.rows[0].n).toBe(1);
    const boost = await ctx.sql.query(`SELECT status FROM post_boosts WHERE post_id = $1`, [id]);
    expect(boost.rows[0].status).toBe('ended');
  });
});

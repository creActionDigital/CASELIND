import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

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
  identifier: string;
}

async function user(): Promise<TU> {
  const { tokens, identifier } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, identifier };
}

const follow = (a: TU, b: TU) => ctx.sql.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [a.id, b.id]);

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function uploadImage(u: TU, purpose: string): Promise<string> {
  const up = await ctx.http
    .post('/v1/media/uploads')
    .set(bearer(u.token))
    .send({ purpose, mime: 'image/png', sizeBytes: TINY_PNG.length })
    .expect(201);
  await ctx.http
    .put(up.body.uploadUrl)
    .set(bearer(u.token))
    .set('X-Upload-Token', up.body.uploadToken)
    .set('Content-Type', 'application/octet-stream')
    .send(TINY_PNG)
    .expect(200);
  return up.body.assetId;
}

async function postStory(u: TU, body: Record<string, unknown> = {}) {
  const mediaId = (body.mediaId as string | undefined) ?? (await uploadImage(u, 'story'));
  return ctx.http
    .post('/v1/stories')
    .set(bearer(u.token))
    .send({ clientId: randomUUID(), mediaId, ...body });
}

async function story(u: TU, body: Record<string, unknown> = {}): Promise<{ id: string; mediaId: string }> {
  const res = await postStory(u, body);
  expect(res.status).toBe(201);
  return res.body;
}

const expire = (id: string) => ctx.sql.query(`UPDATE stories SET expires_at = now() - interval '1 hour', created_at = now() - interval '25 hours' WHERE id = $1`, [id]);

describe('creation', () => {
  it('creates a story, is idempotent per clientId and sets the 24 h expiry', async () => {
    const a = await user();
    const mediaId = await uploadImage(a, 'story');
    const clientId = randomUUID();
    const first = await ctx.http.post('/v1/stories').set(bearer(a.token)).send({ clientId, mediaId, caption: ' Salut ' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ authorId: a.id, mediaId, caption: 'Salut', visibility: 'followers', seen: true, viewCount: 0 });
    const ttl = Date.parse(first.body.expiresAt) - Date.parse(first.body.createdAt);
    expect(ttl).toBe(24 * 3_600_000);
    const replay = await ctx.http.post('/v1/stories').set(bearer(a.token)).send({ clientId, mediaId });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
  });

  it('refuses invalid media, a foreign upload, a wrong purpose, a reused media and bad input', async () => {
    const [a, b] = [await user(), await user()];
    expect((await postStory(a, { mediaId: randomUUID() })).status).toBe(400);
    expect((await postStory(a, { mediaId: await uploadImage(b, 'story') })).status).toBe(400);
    expect((await postStory(a, { mediaId: await uploadImage(a, 'post') })).status).toBe(400);
    const pending = await ctx.http.post('/v1/media/uploads').set(bearer(a.token)).send({ purpose: 'story', mime: 'image/png', sizeBytes: 10 }).expect(201);
    expect((await postStory(a, { mediaId: pending.body.assetId })).status).toBe(400);
    const s = await story(a);
    expect((await postStory(a, { mediaId: s.mediaId })).status).toBe(400);
    expect((await postStory(a, { caption: 'x'.repeat(501) })).status).toBe(400);
    expect((await postStory(a, { visibility: 'private_list' })).status).toBe(400);
    expect((await ctx.http.post('/v1/stories').send({}).expect(401)).status).toBe(401);
  });
});

describe('visibility', () => {
  it('shows followers stories to followers only, friends stories to mutual follows only', async () => {
    const [author, follower, friend, stranger] = [await user(), await user(), await user(), await user()];
    await follow(follower, author);
    await follow(friend, author);
    await follow(author, friend);
    const pub = await story(author, { visibility: 'followers' });
    const priv = await story(author, { visibility: 'friends' });

    const listOf = async (v: TU) => (await ctx.http.get(`/v1/users/${author.id}/stories`).set(bearer(v.token)).expect(200)).body.items.map((s: { id: string }) => s.id);
    expect(await listOf(stranger)).toEqual([]);
    expect(await listOf(follower)).toEqual([pub.id]);
    expect(new Set(await listOf(friend))).toEqual(new Set([pub.id, priv.id]));
    expect(new Set(await listOf(author))).toEqual(new Set([pub.id, priv.id]));

    await ctx.http.post(`/v1/stories/${pub.id}/view`).set(bearer(stranger.token)).expect(404);
    await ctx.http.post(`/v1/stories/${priv.id}/view`).set(bearer(follower.token)).expect(404);
    await ctx.http.post(`/v1/stories/${priv.id}/view`).set(bearer(friend.token)).expect(204);
    await ctx.http.get('/v1/users/not-a-uuid/stories').set(bearer(friend.token)).expect(404);
  });

  it('hides everything either way once a block exists', async () => {
    const [author, fan] = [await user(), await user()];
    await follow(fan, author);
    const s = await story(author);
    await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(fan.token)).expect(204);
    await ctx.http.put(`/v1/blocks/${fan.id}`).set(bearer(author.token)).expect(204);
    await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(fan.token)).expect(404);
    await ctx.http.get(`/v1/users/${author.id}/stories`).set(bearer(fan.token)).expect(404);
    const bar = await ctx.http.get('/v1/stories/feed').set(bearer(fan.token)).expect(200);
    expect(bar.body.items).toEqual([]);
    await ctx.http.delete(`/v1/blocks/${fan.id}`).set(bearer(author.token)).expect(204);
    await ctx.http.put(`/v1/blocks/${author.id}`).set(bearer(fan.token)).expect(204);
    await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(fan.token)).expect(404);
  });

  it('expires: 404 for others, still in the archive of the author', async () => {
    const [author, fan] = [await user(), await user()];
    await follow(fan, author);
    const s = await story(author);
    await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(fan.token)).expect(204);
    await expire(s.id);
    await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(fan.token)).expect(404);
    expect((await ctx.http.get(`/v1/users/${author.id}/stories`).set(bearer(fan.token)).expect(200)).body.items).toEqual([]);
    expect((await ctx.http.get(`/v1/users/${author.id}/stories`).set(bearer(author.token)).expect(200)).body.items).toEqual([]);
    const archive = await ctx.http.get('/v1/me/stories/archive').set(bearer(author.token)).expect(200);
    expect(archive.body.items.map((i: { id: string }) => i.id)).toEqual([s.id]);
    expect((await ctx.http.get('/v1/me/stories/archive').set(bearer(fan.token)).expect(200)).body.items).toEqual([]);
  });

  it('paginates the archive with a cursor', async () => {
    const a = await user();
    const ids = [(await story(a)).id, (await story(a)).id, (await story(a)).id];
    const p1 = await ctx.http.get('/v1/me/stories/archive?limit=2').set(bearer(a.token)).expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await ctx.http.get(`/v1/me/stories/archive?limit=2&cursor=${p1.body.nextCursor}`).set(bearer(a.token)).expect(200);
    expect(p2.body.nextCursor).toBeNull();
    expect([...p1.body.items, ...p2.body.items].map((i: { id: string }) => i.id).sort()).toEqual([...ids].sort());
    await ctx.http.get('/v1/me/stories/archive?cursor=garbage').set(bearer(a.token)).expect(400);
  });
});

describe('stories bar', () => {
  it('lists the caller first, then unseen authors before seen ones, with seen per story', async () => {
    const [me, a1, a2, a3, unfollowed] = [await user(), await user(), await user(), await user(), await user()];
    for (const a of [a1, a2, a3]) await follow(me, a);
    const mine = await story(me);
    const s1 = await story(a1);
    const s2a = await story(a2);
    const s2b = await story(a2);
    await story(a3);
    await story(unfollowed);
    // A friends story of a3 that `me` cannot see (not mutual) must not show.
    await story(a3, { visibility: 'friends' });
    await ctx.http.post(`/v1/stories/${s1.id}/view`).set(bearer(me.token)).expect(204);
    await ctx.http.post(`/v1/stories/${s2a.id}/view`).set(bearer(me.token)).expect(204);

    const bar = (await ctx.http.get('/v1/stories/feed').set(bearer(me.token)).expect(200)).body.items;
    expect(bar.map((g: { author: { userId: string } }) => g.author.userId)).toEqual([me.id, a3.id, a2.id, a1.id]);
    expect(bar[0].stories.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    expect(bar[1].stories).toHaveLength(1);
    expect(bar[1].hasUnseen).toBe(true);
    expect(bar[2].stories.map((s: { id: string; seen: boolean }) => [s.id, s.seen])).toEqual([
      [s2a.id, true],
      [s2b.id, false],
    ]);
    expect(bar[2].hasUnseen).toBe(true);
    expect(bar[3].hasUnseen).toBe(false);
    expect(bar[3].stories[0].viewCount).toBeNull();
  });

  it('puts fully seen authors after the unseen ones', async () => {
    const [me, a1, a2] = [await user(), await user(), await user()];
    await follow(me, a1);
    await follow(me, a2);
    const s1 = await story(a1);
    await story(a2);
    await ctx.http.post(`/v1/stories/${s1.id}/view`).set(bearer(me.token)).expect(204);
    const bar = (await ctx.http.get('/v1/stories/feed').set(bearer(me.token)).expect(200)).body.items;
    expect(bar.map((g: { author: { userId: string } }) => g.author.userId)).toEqual([a2.id, a1.id]);
  });
});

describe('views', () => {
  it('records each viewer once and shows them to the author only', async () => {
    const [author, v1, v2] = [await user(), await user(), await user()];
    await follow(v1, author);
    await follow(v2, author);
    const s = await story(author);
    for (let i = 0; i < 2; i += 1) await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(v1.token)).expect(204);
    await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(v2.token)).expect(204);
    await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(author.token)).expect(204);

    const all = await ctx.http.get(`/v1/stories/${s.id}/viewers`).set(bearer(author.token)).expect(200);
    expect(all.body.items.map((i: { userId: string }) => i.userId).sort()).toEqual([v1.id, v2.id].sort());
    const p1 = await ctx.http.get(`/v1/stories/${s.id}/viewers?limit=1`).set(bearer(author.token)).expect(200);
    expect(p1.body.nextCursor).not.toBeNull();
    const p2 = await ctx.http.get(`/v1/stories/${s.id}/viewers?limit=1&cursor=${p1.body.nextCursor}`).set(bearer(author.token)).expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.items[0].userId).not.toBe(p1.body.items[0].userId);
    await ctx.http.get(`/v1/stories/${s.id}/viewers`).set(bearer(v1.token)).expect(404);
    const mine = await ctx.http.get(`/v1/users/${author.id}/stories`).set(bearer(author.token)).expect(200);
    expect(mine.body.items[0].viewCount).toBe(2);
  });

  it('lets only the author delete a story', async () => {
    const [author, other] = [await user(), await user()];
    await follow(other, author);
    const s = await story(author);
    await ctx.http.delete(`/v1/stories/${s.id}`).set(bearer(other.token)).expect(404);
    await ctx.http.delete(`/v1/stories/${s.id}`).set(bearer(author.token)).expect(204);
    await ctx.http.delete(`/v1/stories/${s.id}`).set(bearer(author.token)).expect(404);
    await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(other.token)).expect(404);
  });
});

describe('story media', () => {
  it('follows the story visibility', async () => {
    const [author, fan, friend, stranger] = [await user(), await user(), await user(), await user()];
    await follow(fan, author);
    await follow(friend, author);
    await follow(author, friend);
    const pub = await story(author);
    const priv = await story(author, { visibility: 'friends' });
    const read = (m: string, v: TU) => ctx.http.get(`/v1/media/${m}/content`).set(bearer(v.token));

    await read(pub.mediaId, author).expect(200);
    await read(pub.mediaId, fan).expect(200);
    await read(pub.mediaId, stranger).expect(404);
    await ctx.http.get(`/v1/media/${pub.mediaId}`).set(bearer(stranger.token)).expect(404);
    await read(priv.mediaId, fan).expect(404);
    await read(priv.mediaId, friend).expect(200);

    await expire(pub.id);
    await read(pub.mediaId, fan).expect(404);
    await read(pub.mediaId, author).expect(200);
    await ctx.sql.query(`UPDATE stories SET hidden_at = now() WHERE id = $1`, [priv.id]);
    await read(priv.mediaId, friend).expect(404);
  });
});

describe('feature flag', () => {
  it('answers 403 feature_disabled when social.stories is off', async () => {
    const a = await user();
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'social.stories'`);
    try {
      for (const res of [
        await ctx.http.get('/v1/stories/feed').set(bearer(a.token)),
        await postStory(a),
        await ctx.http.get('/v1/me/stories/archive').set(bearer(a.token)),
      ]) {
        expect(res.status).toBe(403);
      }
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'social.stories'`);
    }
    await ctx.http.get('/v1/stories/feed').set(bearer(a.token)).expect(200);
  });
});

describe('account data rights and maintenance', () => {
  it('exports the stories and purges them (rows, views, files) with the account', async () => {
    const [author, fan] = [await user(), await user()];
    await follow(fan, author);
    const s = await story(author, { caption: 'Mon secret' });
    await ctx.http.post(`/v1/stories/${s.id}/view`).set(bearer(fan.token)).expect(204);
    const exp = await ctx.http.get('/v1/me/export').set(bearer(author.token)).expect(200);
    expect(exp.body.stories).toEqual([
      { id: s.id, caption: 'Mon secret', createdAt: expect.any(String), expiresAt: expect.any(String) },
    ]);
    expect(exp.body.reportsFiled).toEqual([]);

    await ctx.http.post('/v1/me/deletion-request').set(bearer(author.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '60 days' WHERE id = $1`, [author.id]);
    const maintenance = ctx.app.get(MaintenanceService);
    await maintenance.runOnce();
    await maintenance.runOnce();
    const { rows } = await ctx.sql.query(`SELECT (SELECT count(*) FROM stories WHERE author_id = $1)::int AS s,
      (SELECT count(*) FROM story_views WHERE story_id = $2)::int AS v,
      (SELECT count(*) FROM media_assets WHERE id = $3)::int AS m`, [author.id, s.id, s.mediaId]);
    expect(rows[0]).toEqual({ s: 0, v: 0, m: 0 });
  });

  it('drops the views of stories expired for over 30 days but keeps the story archived', async () => {
    const [author, fan] = [await user(), await user()];
    await follow(fan, author);
    const old = await story(author);
    const recent = await story(author);
    await ctx.http.post(`/v1/stories/${old.id}/view`).set(bearer(fan.token)).expect(204);
    await ctx.http.post(`/v1/stories/${recent.id}/view`).set(bearer(fan.token)).expect(204);
    await ctx.sql.query(`UPDATE stories SET created_at = now() - interval '40 days', expires_at = now() - interval '39 days' WHERE id = $1`, [old.id]);
    await ctx.sql.query(`UPDATE stories SET created_at = now() - interval '3 days', expires_at = now() - interval '2 days' WHERE id = $1`, [recent.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    const { rows } = await ctx.sql.query(`SELECT story_id FROM story_views WHERE story_id = ANY($1::uuid[])`, [[old.id, recent.id]]);
    expect(rows.map((r) => r.story_id)).toEqual([recent.id]);
    const archive = await ctx.http.get('/v1/me/stories/archive').set(bearer(author.token)).expect(200);
    expect(archive.body.items).toHaveLength(2);
  });
});

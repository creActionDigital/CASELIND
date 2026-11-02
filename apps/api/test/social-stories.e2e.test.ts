import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Integration of lots 4A and 4B with no spy: real follows, real blocks, real moderation. */
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

async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query(`UPDATE users SET roles = $1::text[] WHERE id = $2`, [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id };
}

const follow = (a: TU, b: TU) => ctx.http.put(`/v1/users/${b.id}/follow`).set(bearer(a.token)).expect(204);
const block = (a: TU, b: TU) => ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function upload(u: TU, purpose: string): Promise<string> {
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

async function story(u: TU, visibility: 'followers' | 'friends'): Promise<{ id: string; mediaId: string }> {
  const mediaId = await upload(u, 'story');
  const res = await ctx.http.post('/v1/stories').set(bearer(u.token)).send({ clientId: randomUUID(), mediaId, visibility }).expect(201);
  return res.body;
}

async function post(u: TU, visibility: string, extra: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await ctx.http
    .post('/v1/posts')
    .set(bearer(u.token))
    .send({ clientId: randomUUID(), body: 'Bonjour', visibility, ...extra })
    .expect(201);
  return res.body;
}

const barOf = async (u: TU): Promise<{ authorId: string; ids: string[] }[]> =>
  (await ctx.http.get('/v1/stories/feed').set(bearer(u.token)).expect(200)).body.items.map(
    (g: { author: { userId: string }; stories: { id: string }[] }) => ({ authorId: g.author.userId, ids: g.stories.map((s) => s.id) }),
  );
const storiesOf = async (viewer: TU, author: TU): Promise<string[]> =>
  (await ctx.http.get(`/v1/users/${author.id}/stories`).set(bearer(viewer.token)).expect(200)).body.items.map((s: { id: string }) => s.id);
const mediaStatus = async (viewer: TU, mediaId: string) => (await ctx.http.get(`/v1/media/${mediaId}/content`).set(bearer(viewer.token))).status;

describe('stories with real follows', () => {
  it('serves followers and friends stories, the bar, and drops everything when a block cuts the follow', async () => {
    const [author, follower, friend, stranger] = [await user(), await user(), await user(), await user()];
    await follow(follower, author);
    await follow(friend, author);
    await follow(author, friend);
    const sFollowers = await story(author, 'followers');
    const sFriends = await story(author, 'friends');

    expect(await storiesOf(stranger, author)).toEqual([]);
    expect(await storiesOf(follower, author)).toEqual([sFollowers.id]);
    expect(new Set(await storiesOf(friend, author))).toEqual(new Set([sFollowers.id, sFriends.id]));

    expect(await barOf(stranger)).toEqual([]);
    expect(await barOf(follower)).toEqual([{ authorId: author.id, ids: [sFollowers.id] }]);
    expect((await barOf(friend)).find((g) => g.authorId === author.id)?.ids.sort()).toEqual([sFollowers.id, sFriends.id].sort());

    // Media follows the story's audience.
    expect(await mediaStatus(follower, sFollowers.mediaId)).toBe(200);
    expect(await mediaStatus(follower, sFriends.mediaId)).toBe(404);
    expect(await mediaStatus(friend, sFriends.mediaId)).toBe(200);
    expect(await mediaStatus(stranger, sFollowers.mediaId)).toBe(404);

    await block(author, friend);
    await ctx.http.get(`/v1/users/${author.id}/stories`).set(bearer(friend.token)).expect(404);
    expect(await barOf(friend)).toEqual([]);
    expect(await mediaStatus(friend, sFriends.mediaId)).toBe(404);
    // The follow itself is gone: after unblocking, the former friend is a stranger.
    await ctx.http.delete(`/v1/blocks/${friend.id}`).set(bearer(author.token)).expect(204);
    expect(await storiesOf(friend, author)).toEqual([]);
    expect(await barOf(friend)).toEqual([]);
    expect(await mediaStatus(friend, sFollowers.mediaId)).toBe(404);
  });
});

describe('reporting and moderating a post', () => {
  it('lets a moderator hide a reported post, which leaves the feed; plain users cannot moderate', async () => {
    const [author, reader, moderator, stranger] = [await user(), await user(), await user(['moderator']), await user()];
    await follow(reader, author);
    const p = await post(author, 'followers', { body: 'contenu litigieux' });
    const feedIds = async () => (await ctx.http.get('/v1/feed').set(bearer(reader.token)).expect(200)).body.items.map((i: { id: string }) => i.id);
    expect(await feedIds()).toEqual([p.id]);

    // One cannot report what one cannot see.
    await ctx.http.post('/v1/reports').set(bearer(stranger.token)).send({ targetType: 'post', targetId: p.id, reason: 'spam' }).expect(404);
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'post', targetId: p.id, reason: 'spam' }).expect(201);

    const act = { targetType: 'post', targetId: p.id, action: 'hide' };
    await ctx.http.post('/v1/admin/moderation/actions').set(bearer(reader.token)).send(act).expect(403);
    const queue = await ctx.http.get('/v1/admin/moderation/reports').set(bearer(moderator.token)).expect(200);
    expect(queue.body.items).toEqual([expect.objectContaining({ targetType: 'post', targetId: p.id, authorId: author.id, reportCount: 1 })]);
    await ctx.http.post('/v1/admin/moderation/actions').set(bearer(moderator.token)).send(act).expect(200);

    expect(await feedIds()).toEqual([]);
    await ctx.http.get(`/v1/posts/${p.id}`).set(bearer(reader.token)).expect(404);
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'moderation.action' AND actor_user_id = $1`, [moderator.id]);
    expect(JSON.stringify(audit.rows)).not.toContain('contenu litigieux');
  });
});

describe('post media follows the post visibility', () => {
  it('is readable only through a post the viewer may see', async () => {
    const [author, follower, stranger, moderator] = [await user(), await user(), await user(), await user(['moderator'])];
    await follow(follower, author);
    const mk = async (visibility: string) => {
      const mediaId = await upload(author, 'post');
      const p = await post(author, visibility, { mediaIds: [mediaId] });
      return { mediaId, postId: p.id };
    };
    const pub = await mk('public');
    const fol = await mk('followers');
    const priv = await mk('private');
    const del = await mk('public');
    const hid = await mk('public');
    const unattached = await upload(author, 'post');

    expect(await mediaStatus(stranger, pub.mediaId)).toBe(200);
    expect(await mediaStatus(follower, fol.mediaId)).toBe(200);
    expect(await mediaStatus(stranger, fol.mediaId)).toBe(404);
    expect(await mediaStatus(follower, priv.mediaId)).toBe(404);
    expect(await mediaStatus(author, priv.mediaId)).toBe(200);
    expect(await mediaStatus(stranger, unattached)).toBe(404);
    expect(await mediaStatus(author, unattached)).toBe(200);
    await ctx.http.get(`/v1/media/${fol.mediaId}`).set(bearer(stranger.token)).expect(404);

    await ctx.http.delete(`/v1/posts/${del.postId}`).set(bearer(author.token)).expect(204);
    expect(await mediaStatus(stranger, del.mediaId)).toBe(404);
    await ctx.http.post('/v1/reports').set(bearer(follower.token)).send({ targetType: 'post', targetId: hid.postId, reason: 'spam' }).expect(201);
    await ctx.http.post('/v1/admin/moderation/actions').set(bearer(moderator.token)).send({ targetType: 'post', targetId: hid.postId, action: 'hide' }).expect(200);
    expect(await mediaStatus(stranger, hid.mediaId)).toBe(404);

    await block(author, follower);
    expect(await mediaStatus(follower, fol.mediaId)).toBe(404);
  });
});

describe('purge', () => {
  it('erases post and comment bodies, not just flags them', async () => {
    const [a, b] = [await user(), await user()];
    const mine = await post(a, 'public', { body: 'secret de a' });
    const theirs = await post(b, 'public');
    await ctx.http.post(`/v1/posts/${theirs.id}/comments`).set(bearer(a.token)).send({ body: 'commentaire de a' }).expect(201);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [a.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    const rows = await ctx.sql.query(
      `SELECT (SELECT count(*)::int FROM posts WHERE author_id = $1) AS posts,
              (SELECT count(*)::int FROM post_comments WHERE author_id = $1) AS comments`,
      [a.id],
    );
    expect(rows.rows[0]).toEqual({ posts: 0, comments: 0 });
    await ctx.http.get(`/v1/posts/${mine.id}`).set(bearer(b.token)).expect(404);
  });
});

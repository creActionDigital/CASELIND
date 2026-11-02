import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { ModerationRegistry } from '../src/moderation/moderation-registry.js';
import { RelationsService } from '../src/social/relations.service.js';
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
  identifier: string;
}

async function user(roles?: string[]): Promise<TU> {
  const { tokens, identifier } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query(`UPDATE users SET roles = $1 WHERE id = $2`, [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, identifier };
}

const follow = (a: TU, b: TU) => ctx.http.put(`/v1/users/${b.id}/follow`).set(bearer(a.token));
const unfollow = (a: TU, b: TU) => ctx.http.delete(`/v1/users/${b.id}/follow`).set(bearer(a.token));
const block = (a: TU, b: TU) => ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);

const publish = (u: TU, body: Record<string, unknown> = {}) =>
  ctx.http
    .post('/v1/posts')
    .set(bearer(u.token))
    .send({ clientId: randomUUID(), body: 'Bonjour', visibility: 'public', ...body });

async function post(u: TU, visibility: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await publish(u, { visibility, ...extra }).expect(201);
  return res.body.id;
}

const getPost = (u: TU, id: string) => ctx.http.get(`/v1/posts/${id}`).set(bearer(u.token));

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2')]);

async function upload(u: TU, purpose: string, mime: string, bytes: Buffer): Promise<string> {
  const up = await ctx.http
    .post('/v1/media/uploads')
    .set(bearer(u.token))
    .send({ purpose, mime, sizeBytes: bytes.length })
    .expect(201);
  await ctx.http
    .put(up.body.uploadUrl)
    .set(bearer(u.token))
    .set('X-Upload-Token', up.body.uploadToken)
    .set('Content-Type', 'application/octet-stream')
    .send(bytes)
    .expect(200);
  return up.body.assetId;
}
const image = (u: TU, purpose = 'post') => upload(u, purpose, 'image/png', TINY_PNG);
const video = (u: TU) => upload(u, 'post', 'video/mp4', TINY_MP4);

async function notificationsOf(u: TU, kind?: string) {
  const res = await ctx.sql.query(
    `SELECT title, body, data FROM notifications WHERE user_id = $1 AND category = 'social' ORDER BY created_at`,
    [u.id],
  );
  return res.rows.filter((r) => !kind || r.data.kind === kind);
}

describe('follows', () => {
  it('follows and unfollows idempotently, with counts, lists and one notification', async () => {
    const [a, b] = [await user(), await user()];
    await follow(a, b).expect(204);
    await follow(a, b).expect(204);
    expect((await notificationsOf(b, 'follow')).map((n) => n.title)).toEqual(['Nouvel abonné']);

    const stats = await ctx.http.get(`/v1/users/${b.id}/social`).set(bearer(a.token)).expect(200);
    expect(stats.body).toEqual({ userId: b.id, followersCount: 1, followingCount: 0, isFollowing: true, followsYou: false });
    const back = await ctx.http.get(`/v1/users/${a.id}/social`).set(bearer(b.token)).expect(200);
    expect(back.body).toMatchObject({ followersCount: 0, followingCount: 1, isFollowing: false, followsYou: true });

    const followers = await ctx.http.get(`/v1/users/${b.id}/followers`).set(bearer(b.token)).expect(200);
    expect(followers.body.items.map((u: { userId: string }) => u.userId)).toEqual([a.id]);
    const following = await ctx.http.get(`/v1/users/${a.id}/following`).set(bearer(a.token)).expect(200);
    expect(following.body.items.map((u: { userId: string }) => u.userId)).toEqual([b.id]);

    await unfollow(a, b).expect(204);
    await unfollow(a, b).expect(204);
    const after = await ctx.http.get(`/v1/users/${b.id}/social`).set(bearer(a.token)).expect(200);
    expect(after.body).toMatchObject({ followersCount: 0, isFollowing: false });
  });

  it('paginates followers with a cursor', async () => {
    const target = await user();
    const fans = [await user(), await user(), await user()];
    for (const f of fans) await follow(f, target).expect(204);
    const p1 = await ctx.http.get(`/v1/users/${target.id}/followers?limit=2`).set(bearer(target.token)).expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await ctx.http
      .get(`/v1/users/${target.id}/followers?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`)
      .set(bearer(target.token))
      .expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    const ids = [...p1.body.items, ...p2.body.items].map((u: { userId: string }) => u.userId);
    expect(new Set(ids)).toEqual(new Set(fans.map((f) => f.id)));
    await ctx.http.get(`/v1/users/${target.id}/followers?cursor=garbage`).set(bearer(target.token)).expect(400);
  });

  it('refuses self (400) and unknown, malformed, inactive or blocked targets (404)', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    await follow(a, a).expect(400);
    await ctx.http.put(`/v1/users/${randomUUID()}/follow`).set(bearer(a.token)).expect(404);
    await ctx.http.put('/v1/users/not-a-uuid/follow').set(bearer(a.token)).expect(404);
    await ctx.sql.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [c.id]);
    await follow(a, c).expect(404);
    await block(b, a);
    await follow(a, b).expect(404);
    await follow(b, a).expect(404);
  });

  it('blocking removes the follows in both directions', async () => {
    const [a, b] = [await user(), await user()];
    await follow(a, b).expect(204);
    await follow(b, a).expect(204);
    await block(a, b);
    const rel = ctx.app.get(RelationsService);
    expect(await rel.isFollowing(a.id, b.id)).toBe(false);
    expect(await rel.isFollowing(b.id, a.id)).toBe(false);
    await ctx.http.get(`/v1/users/${b.id}/social`).set(bearer(a.token)).expect(404);
  });
});

describe('RelationsService', () => {
  it('answers isFollowing, areFriends and followingIds', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const rel = ctx.app.get(RelationsService);
    await follow(a, b).expect(204);
    await follow(a, c).expect(204);
    await follow(c, a).expect(204);
    expect(await rel.isFollowing(a.id, b.id)).toBe(true);
    expect(await rel.isFollowing(b.id, a.id)).toBe(false);
    expect(await rel.areFriends(a.id, b.id)).toBe(false);
    expect(await rel.areFriends(a.id, c.id)).toBe(true);
    expect(await rel.areFriends(c.id, a.id)).toBe(true);
    expect(new Set(await rel.followingIds(a.id))).toEqual(new Set([b.id, c.id]));
    expect(await rel.followingIds(b.id)).toEqual([]);
  });
});

describe('post visibility matrix', () => {
  it('applies public / followers / friends / private to stranger, follower, friend, author and blocked', async () => {
    const author = await user();
    const stranger = await user();
    const follower = await user();
    const friend = await user();
    const blocked = await user();
    await follow(follower, author).expect(204);
    await follow(friend, author).expect(204);
    await follow(author, friend).expect(204);
    // The blocked user follows the author first, then gets blocked: the follow disappears with the block.
    await follow(blocked, author).expect(204);
    await block(author, blocked);

    const ids = {
      public: await post(author, 'public'),
      followers: await post(author, 'followers'),
      friends: await post(author, 'friends'),
      private: await post(author, 'private'),
    };
    const expected: Record<string, [number, number, number, number]> = {
      // [public, followers, friends, private]
      stranger: [200, 404, 404, 404],
      follower: [200, 200, 404, 404],
      friend: [200, 200, 200, 404],
      author: [200, 200, 200, 200],
      blocked: [404, 404, 404, 404],
    };
    const viewers: Record<string, TU> = { stranger, follower, friend, author, blocked };
    for (const [name, codes] of Object.entries(expected)) {
      const got = [];
      for (const key of ['public', 'followers', 'friends', 'private'] as const) {
        got.push((await getPost(viewers[name]!, ids[key])).status);
      }
      expect({ name, got }).toEqual({ name, got: codes });
    }

    // Same rules on the author's profile feed.
    const seen = async (v: TU) =>
      ((await ctx.http.get(`/v1/users/${author.id}/posts`).set(bearer(v.token)).expect(200)).body.items as { visibility: string }[]).map(
        (p) => p.visibility,
      );
    expect((await seen(stranger)).sort()).toEqual(['public']);
    expect((await seen(follower)).sort()).toEqual(['followers', 'public']);
    expect((await seen(friend)).sort()).toEqual(['followers', 'friends', 'public']);
    expect((await seen(author)).sort()).toEqual(['followers', 'friends', 'private', 'public']);
    await ctx.http.get(`/v1/users/${author.id}/posts`).set(bearer(blocked.token)).expect(404);
  });

  it('hides a public post when the viewer is blocked by the author or blocks them', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const id = await post(a, 'public');
    await block(b, a);
    await getPost(b, id).expect(404);
    await block(a, c);
    await getPost(c, id).expect(404);
  });
});

describe('posts', () => {
  it('creates, reads, edits and soft-deletes; only the author edits and deletes', async () => {
    const [a, b] = [await user(), await user()];
    const created = await publish(a, { body: 'Salut', visibility: 'public' }).expect(201);
    expect(created.body).toMatchObject({
      kind: 'text',
      body: 'Salut',
      visibility: 'public',
      myReaction: null,
      commentsCount: 0,
      moderation: 'visible',
      media: [],
      author: { id: a.id },
    });
    const id = created.body.id as string;
    await ctx.http.patch(`/v1/posts/${id}`).set(bearer(b.token)).send({ body: 'hack' }).expect(403);
    await ctx.http.delete(`/v1/posts/${id}`).set(bearer(b.token)).expect(403);
    const edited = await ctx.http.patch(`/v1/posts/${id}`).set(bearer(a.token)).send({ body: 'Salut tous', visibility: 'private' }).expect(200);
    expect(edited.body).toMatchObject({ body: 'Salut tous', visibility: 'private' });
    await getPost(b, id).expect(404);
    await ctx.http.patch(`/v1/posts/${id}`).set(bearer(a.token)).send({}).expect(400);
    await ctx.http.patch(`/v1/posts/${id}`).set(bearer(a.token)).send({ body: null }).expect(400); // text post needs a text
    await ctx.http.delete(`/v1/posts/${id}`).set(bearer(a.token)).expect(204);
    await getPost(a, id).expect(404);
    await ctx.http.delete(`/v1/posts/${id}`).set(bearer(a.token)).expect(404);
    await getPost(a, 'not-a-uuid').expect(404);
  });

  it('validates the body: text or media required, lengths bounded', async () => {
    const a = await user();
    await publish(a, { body: undefined }).expect(400);
    await publish(a, { body: '   ' }).expect(400);
    await publish(a, { body: 'x'.repeat(5001) }).expect(400);
    await publish(a, { visibility: 'everyone' }).expect(400);
    await publish(a, { body: 'x'.repeat(5000) }).expect(201);
  });

  it('is idempotent per clientId (201 then 200, one row)', async () => {
    const a = await user();
    const clientId = randomUUID();
    const first = await publish(a, { clientId }).expect(201);
    const again = await publish(a, { clientId, body: 'other text' }).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.body).toBe('Bonjour');
    const count = await ctx.sql.query(`SELECT count(*)::int AS n FROM posts WHERE author_id = $1`, [a.id]);
    expect(count.rows[0].n).toBe(1);
    // The same clientId from another author is a different post.
    const b = await user();
    await publish(b, { clientId }).expect(201);
  });

  it('derives the kind from media and rejects invalid media', async () => {
    const [a, b] = [await user(), await user()];
    const img1 = await image(a);
    const img2 = await image(a);
    const media = await publish(a, { body: undefined, mediaIds: [img1, img2] }).expect(201);
    expect(media.body.kind).toBe('media');
    expect(media.body.media.map((m: { id: string }) => m.id)).toEqual([img1, img2]);
    expect(media.body.media[0]).toMatchObject({ mime: 'image/png', contentUrl: `/v1/media/${img1}/content` });

    const vid = await video(a);
    const img3 = await image(a);
    const v = await publish(a, { mediaIds: [img3, vid] }).expect(201);
    expect(v.body.kind).toBe('video');

    // Invalid: foreign, wrong purpose, unknown, already used, two videos, more than 10, duplicates.
    await publish(a, { mediaIds: [await image(b)] }).expect(400);
    await publish(a, { mediaIds: [await image(a, 'message')] }).expect(400);
    await publish(a, { mediaIds: [randomUUID()] }).expect(400);
    await publish(a, { mediaIds: [img1] }).expect(400);
    await publish(a, { mediaIds: [await video(a), await video(a)] }).expect(400);
    await publish(a, { mediaIds: Array.from({ length: 11 }, () => randomUUID()) }).expect(400);
    const dup = await image(a);
    await publish(a, { mediaIds: [dup, dup] }).expect(400);
    const pending = await ctx.http
      .post('/v1/media/uploads')
      .set(bearer(a.token))
      .send({ purpose: 'post', mime: 'image/png', sizeBytes: TINY_PNG.length })
      .expect(201);
    await publish(a, { mediaIds: [pending.body.assetId] }).expect(400);
  });
});

describe('feed', () => {
  it('lists followed accounts and own posts only, newest first, with pagination', async () => {
    const [me, followed, other] = [await user(), await user(), await user()];
    await follow(me, followed).expect(204);
    const p1 = await post(followed, 'public', { body: 'one' });
    const p2 = await post(me, 'private', { body: 'two' });
    await post(other, 'public', { body: 'not followed' });
    const p3 = await post(followed, 'followers', { body: 'three' });
    await post(followed, 'private', { body: 'secret' });
    await post(followed, 'friends', { body: 'friends only' });

    const feed = await ctx.http.get('/v1/feed').set(bearer(me.token)).expect(200);
    expect(feed.body.items.map((p: { id: string }) => p.id)).toEqual([p3, p2, p1]);

    const page1 = await ctx.http.get('/v1/feed?limit=2').set(bearer(me.token)).expect(200);
    expect(page1.body.items.map((p: { id: string }) => p.id)).toEqual([p3, p2]);
    const page2 = await ctx.http
      .get(`/v1/feed?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set(bearer(me.token))
      .expect(200);
    expect(page2.body.items.map((p: { id: string }) => p.id)).toEqual([p1]);
    expect(page2.body.nextCursor).toBeNull();

    await unfollow(me, followed).expect(204);
    const after = await ctx.http.get('/v1/feed').set(bearer(me.token)).expect(200);
    expect(after.body.items.map((p: { id: string }) => p.id)).toEqual([p2]);
    await ctx.http.get('/v1/feed?cursor=nope').set(bearer(me.token)).expect(400);
  });

  it('serves public video posts chronologically in /feed/videos', async () => {
    const [a, b] = [await user(), await user()];
    const v1 = (await publish(a, { mediaIds: [await video(a)], visibility: 'public' }).expect(201)).body.id;
    await publish(a, { mediaIds: [await image(a)], visibility: 'public' }).expect(201);
    await publish(a, { mediaIds: [await video(a)], visibility: 'followers' }).expect(201);
    const v2 = (await publish(b, { mediaIds: [await video(b)], visibility: 'public' }).expect(201)).body.id;
    const res = await ctx.http.get('/v1/feed/videos').set(bearer(a.token)).expect(200);
    const ids = res.body.items.map((p: { id: string }) => p.id) as string[];
    expect(ids.slice(0, 2)).toEqual([v2, v1]);
    expect(res.body.items.every((p: { kind: string; visibility: string }) => p.kind === 'video' && p.visibility === 'public')).toBe(true);
  });
});

describe('reactions', () => {
  it('sets, changes and removes a single reaction, with counts and one notification', async () => {
    const [author, r1, r2] = [await user(), await user(), await user()];
    const id = await post(author, 'public');
    const react = (u: TU, type: string | null) => ctx.http.put(`/v1/posts/${id}/reaction`).set(bearer(u.token)).send({ type });

    let res = await react(r1, 'like').expect(200);
    expect(res.body.myReaction).toBe('like');
    expect(res.body.reactions).toMatchObject({ like: 1, love: 0 });
    res = await react(r2, 'love').expect(200);
    res = await react(r1, 'haha').expect(200);
    expect(res.body.reactions).toEqual({ like: 0, love: 1, haha: 1, wow: 0, sad: 0, angry: 0 });
    expect((await getPost(r2, id)).body.myReaction).toBe('love');
    res = await react(r1, null).expect(200);
    expect(res.body).toMatchObject({ myReaction: null, reactions: { haha: 0, love: 1 } });
    await react(r1, 'like').expect(200); // re-reacting does not notify again
    await react(r1, 'zzz').expect(400);

    expect((await notificationsOf(author, 'reaction')).filter((n) => n.data.actorId === r1.id)).toHaveLength(1);
    expect((await notificationsOf(author, 'reaction')).filter((n) => n.data.actorId === r2.id)).toHaveLength(1);
    // Reacting to your own post notifies nobody.
    await react(author, 'like').expect(200);
    expect((await notificationsOf(author, 'reaction')).filter((n) => n.data.actorId === author.id)).toHaveLength(0);
    // Invisible post: 404.
    const priv = await post(author, 'private');
    await ctx.http.put(`/v1/posts/${priv}/reaction`).set(bearer(r1.token)).send({ type: 'like' }).expect(404);
  });
});

describe('comments', () => {
  it('comments, replies one level deep, notifies, and is deletable by both authors', async () => {
    const [author, c1, c2] = [await user(), await user(), await user()];
    const id = await post(author, 'public');
    const comment = (u: TU, body: Record<string, unknown>) =>
      ctx.http.post(`/v1/posts/${id}/comments`).set(bearer(u.token)).send(body);

    const top = (await comment(c1, { body: 'Super !' }).expect(201)).body;
    expect(top).toMatchObject({ postId: id, body: 'Super !', replyToId: null, author: { id: c1.id } });
    const reply = (await comment(c2, { body: 'Merci', replyToId: top.id }).expect(201)).body;
    expect(reply.replyToId).toBe(top.id);
    await comment(c2, { body: 'deeper', replyToId: reply.id }).expect(400);
    await comment(c2, { body: 'x', replyToId: randomUUID() }).expect(400);
    await comment(c2, { body: '' }).expect(400);
    await comment(c2, { body: 'x'.repeat(2001) }).expect(400);

    const otherPost = await post(author, 'public');
    await ctx.http
      .post(`/v1/posts/${otherPost}/comments`)
      .set(bearer(c2.token))
      .send({ body: 'wrong post', replyToId: top.id })
      .expect(400);

    const list = await ctx.http.get(`/v1/posts/${id}/comments`).set(bearer(author.token)).expect(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([top.id, reply.id]);
    expect((await getPost(author, id)).body.commentsCount).toBe(2);

    expect((await notificationsOf(author, 'comment')).map((n) => n.title)).toEqual(['Nouveau commentaire', 'Nouveau commentaire']);
    expect((await notificationsOf(c1, 'comment')).map((n) => n.title)).toEqual(['Nouvelle réponse']);

    // A bystander cannot delete; the comment author and the post author can.
    const bystander = await user();
    await ctx.http.delete(`/v1/comments/${top.id}`).set(bearer(bystander.token)).expect(403);
    await ctx.http.delete(`/v1/comments/${top.id}`).set(bearer(c1.token)).expect(204);
    await ctx.http.delete(`/v1/comments/${reply.id}`).set(bearer(author.token)).expect(204);
    await ctx.http.delete(`/v1/comments/${reply.id}`).set(bearer(author.token)).expect(404);
    const after = await ctx.http.get(`/v1/posts/${id}/comments`).set(bearer(author.token)).expect(200);
    expect(after.body.items).toEqual([]);
  });

  it('is 404 on an invisible post and hides comments of users blocked with the reader', async () => {
    const [author, c1, c2, reader] = [await user(), await user(), await user(), await user()];
    const priv = await post(author, 'private');
    await ctx.http.get(`/v1/posts/${priv}/comments`).set(bearer(c1.token)).expect(404);
    await ctx.http.post(`/v1/posts/${priv}/comments`).set(bearer(c1.token)).send({ body: 'hi' }).expect(404);

    const id = await post(author, 'public');
    await ctx.http.post(`/v1/posts/${id}/comments`).set(bearer(c1.token)).send({ body: 'from c1' }).expect(201);
    await ctx.http.post(`/v1/posts/${id}/comments`).set(bearer(c2.token)).send({ body: 'from c2' }).expect(201);
    await block(reader, c1);
    const list = await ctx.http.get(`/v1/posts/${id}/comments`).set(bearer(reader.token)).expect(200);
    expect(list.body.items.map((c: { body: string }) => c.body)).toEqual(['from c2']);
    const authorView = await ctx.http.get(`/v1/posts/${id}/comments`).set(bearer(author.token)).expect(200);
    expect(authorView.body.items).toHaveLength(2);
    await ctx.http.delete(`/v1/comments/${randomUUID()}`).set(bearer(c1.token)).expect(404);
  });
});

describe('moderation hiding', () => {
  it('registers post, comment and user targets', async () => {
    const reg = ctx.app.get(ModerationRegistry);
    const [a, b] = [await user(), await user()];
    expect(reg.get('post')).toBeDefined();
    expect(reg.get('comment')).toBeDefined();
    const u = reg.get('user')!;
    expect(await u.visibleTo(a.id, b.id)).toBe(true);
    expect(await u.authorOf(b.id)).toBe(b.id);
    await u.setHidden(b.id, true);
    expect(await u.visibleTo(a.id, b.id)).toBe(true);
    await block(a, b);
    expect(await u.visibleTo(a.id, b.id)).toBe(false);
    const id = await post(b, 'public');
    const target = reg.get('post')!;
    expect(await target.authorOf(id)).toBe(b.id);
    expect(await target.visibleTo(a.id, id)).toBe(false);
  });

  it('hides a post from everyone but its author and moderators/admins', async () => {
    const [author, other] = [await user(), await user()];
    const admin = await user(['user', 'admin']);
    const moderator = await user(['user', 'moderator']);
    const id = await post(author, 'public');
    const cId = (await ctx.http.post(`/v1/posts/${id}/comments`).set(bearer(other.token)).send({ body: 'c' }).expect(201)).body.id;
    const reg = ctx.app.get(ModerationRegistry);
    await reg.get('post')!.setHidden(id, true);
    await reg.get('post')!.setHidden(id, true); // idempotent

    await getPost(other, id).expect(404);
    expect((await getPost(author, id).expect(200)).body.moderation).toBe('hidden');
    expect((await getPost(admin, id).expect(200)).body.moderation).toBe('hidden');
    await getPost(moderator, id).expect(200);
    const feed = await ctx.http.get(`/v1/users/${author.id}/posts`).set(bearer(other.token)).expect(200);
    expect(feed.body.items).toEqual([]);
    expect(await reg.get('post')!.visibleTo(other.id, id)).toBe(false);

    await reg.get('post')!.setHidden(id, false);
    expect((await getPost(other, id).expect(200)).body.moderation).toBe('visible');

    await reg.get('comment')!.setHidden(cId, true);
    const list = await ctx.http.get(`/v1/posts/${id}/comments`).set(bearer(author.token)).expect(200);
    expect(list.body.items).toEqual([]);
    const own = await ctx.http.get(`/v1/posts/${id}/comments`).set(bearer(other.token)).expect(200);
    expect(own.body.items[0]).toMatchObject({ id: cId, moderation: 'hidden' });
  });
});

describe('account export and purge', () => {
  it('exports posts, comments and following; the purge drops follows and reactions and deletes content', async () => {
    const [a, b] = [await user(), await user()];
    const bPost = await post(b, 'public');
    const aPost = await post(a, 'followers', { body: 'mine' });
    await follow(a, b).expect(204);
    await follow(b, a).expect(204);
    await ctx.http.put(`/v1/posts/${bPost}/reaction`).set(bearer(a.token)).send({ type: 'like' }).expect(200);
    await ctx.http.post(`/v1/posts/${bPost}/comments`).set(bearer(a.token)).send({ body: 'my comment' }).expect(201);

    const exp = (await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200)).body;
    expect(exp.posts).toEqual([expect.objectContaining({ id: aPost, body: 'mine', visibility: 'followers' })]);
    expect(exp.comments).toEqual([expect.objectContaining({ postId: bPost, body: 'my comment' })]);
    expect(exp.following).toEqual([expect.objectContaining({ userId: b.id })]);

    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [a.id]);
    await ctx.app.get(MaintenanceService).runOnce();

    const rel = ctx.app.get(RelationsService);
    expect(await rel.isFollowing(a.id, b.id)).toBe(false);
    expect(await rel.isFollowing(b.id, a.id)).toBe(false);
    const rows = await ctx.sql.query(
      `SELECT (SELECT count(*)::int FROM post_reactions WHERE user_id = $1) AS reactions,
              (SELECT count(*)::int FROM posts WHERE author_id = $1 AND deleted_at IS NULL) AS live_posts,
              (SELECT count(*)::int FROM post_comments WHERE author_id = $1 AND deleted_at IS NULL) AS live_comments`,
      [a.id],
    );
    expect(rows.rows[0]).toEqual({ reactions: 0, live_posts: 0, live_comments: 0 });
    await getPost(b, aPost).expect(404);
    const list = await ctx.http.get(`/v1/posts/${bPost}/comments`).set(bearer(b.token)).expect(200);
    expect(list.body.items).toEqual([]);
  });
});

describe('feature flag', () => {
  it('answers 403 feature_disabled on every social route when `social` is off', async () => {
    const admin = await user(['user', 'admin']);
    const u = await user();
    const id = await post(u, 'public');
    await ctx.http.put('/v1/admin/flags/social').set(bearer(admin.token)).send({ enabled: false }).expect(200);
    try {
      for (const res of [
        await ctx.http.get('/v1/feed').set(bearer(u.token)),
        await ctx.http.get('/v1/feed/videos').set(bearer(u.token)),
        await ctx.http.get(`/v1/posts/${id}`).set(bearer(u.token)),
        await publish(u),
        await follow(u, admin),
        await ctx.http.get(`/v1/users/${admin.id}/social`).set(bearer(u.token)),
        await ctx.http.delete(`/v1/comments/${randomUUID()}`).set(bearer(u.token)),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error?.code ?? res.body.code).toBe('feature_disabled');
      }
    } finally {
      await ctx.http.put('/v1/admin/flags/social').set(bearer(admin.token)).send({ enabled: true }).expect(200);
    }
    await getPost(u, id).expect(200);
  });
});

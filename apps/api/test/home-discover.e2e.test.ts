import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { bearer, createTestContext, type TestContext } from './helpers.js';
import { creatorKit } from './creator-helpers.js';

let ctx: TestContext;
let kit: ReturnType<typeof creatorKit>;

beforeAll(async () => {
  ctx = await createTestContext();
  kit = creatorKit(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const feed = async (token: string, scope?: string) =>
  (await ctx.http.get('/v1/feed').query(scope ? { scope } : {}).set(bearer(token)).expect(200)).body as { items: { id: string }[]; nextCursor: string | null };

describe('feed tabs', () => {
  it('following (default) shows followed accounts, forYou shows public posts of anyone, followers-only stays hidden', async () => {
    const me = await kit.user();
    const friend = await kit.user();
    const stranger = await kit.user();
    await kit.follow(me, friend);
    const fPost = await kit.post(friend, 'ami');
    const sPost = await kit.post(stranger, 'inconnu public');
    const hidden = await kit.post(stranger, 'abonnés seulement', 'followers');

    const following = (await feed(me.token)).items.map((p) => p.id);
    expect(following).toContain(fPost);
    expect(following).not.toContain(sPost);
    const forYou = (await feed(me.token, 'forYou')).items.map((p) => p.id);
    expect(forYou).toContain(sPost);
    expect(forYou).toContain(fPost);
    expect(forYou).not.toContain(hidden);
    await ctx.http.get('/v1/feed').query({ scope: 'nope' }).set(bearer(me.token)).expect(400);
  });

  it('popular ranks by reactions and comments, and pages with an offset cursor', async () => {
    const me = await kit.user();
    const author = await kit.user();
    const quiet = await kit.post(author, 'calme');
    const liked = await kit.post(author, 'aimé');
    const fan = await kit.user();
    await ctx.http.put(`/v1/posts/${liked}/reaction`).set(bearer(fan.token)).send({ type: 'like' }).expect(200);
    await ctx.http.post(`/v1/posts/${liked}/comments`).set(bearer(fan.token)).send({ clientId: randomUUID(), body: 'bravo' });

    const ids = (await feed(me.token, 'popular')).items.map((p) => p.id);
    expect(ids.indexOf(liked)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(liked)).toBeLessThan(ids.indexOf(quiet));
    const page = (await ctx.http.get('/v1/feed').query({ scope: 'popular', limit: 1 }).set(bearer(me.token)).expect(200)).body;
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('1');
    const next = (await ctx.http.get('/v1/feed').query({ scope: 'popular', limit: 1, cursor: '1' }).set(bearer(me.token)).expect(200)).body;
    expect(next.items[0].id).not.toBe(page.items[0].id);
  });
});

describe('notification category filter', () => {
  it('returns only the requested category and rejects an unknown one', async () => {
    const u = await kit.user();
    const n = ctx.app.get(NotificationsService);
    await n.notify({ userId: u.id, category: 'social', title: 's', body: 'b' });
    await n.notify({ userId: u.id, category: 'payment', title: 'p', body: 'b' });
    const res = await ctx.http.get('/v1/notifications').query({ category: 'payment' }).set(bearer(u.token)).expect(200);
    expect(res.body.items.map((x: { title: string }) => x.title)).toEqual(['p']);
    await ctx.http.get('/v1/notifications').query({ category: 'zzz' }).set(bearer(u.token)).expect(400);
  });
});

describe('recommended profiles and merchants', () => {
  it('excludes me, followed and blocked accounts, and ranks friends of friends first', async () => {
    const me = await kit.user();
    const friend = await kit.user();
    const followed = await kit.user();
    const blocked = await kit.user();
    const fof = await kit.user();
    const popular = await kit.user();
    await kit.follow(me, friend);
    await kit.follow(me, followed);
    await kit.follow(friend, fof);
    await kit.block(me, blocked);
    const fans = [await kit.user(), await kit.user()];
    for (const f of fans) await kit.follow(f, popular);

    const res = await ctx.http.get('/v1/discover/people').query({ limit: 30 }).set(bearer(me.token)).expect(200);
    const ids = res.body.items.map((p: { userId: string }) => p.userId);
    for (const x of [me, friend, followed, blocked]) expect(ids).not.toContain(x.id);
    expect(ids.indexOf(fof.id)).toBeLessThan(ids.indexOf(popular.id));
    expect(res.body.items.find((p: { userId: string }) => p.userId === fof.id)).toMatchObject({ mutualCount: 1, followersCount: 1 });
  });

  it('lists public active businesses only', async () => {
    const owner = await kit.user();
    const mk = async (suffix: string) => {
      const slug = `rec-${suffix}-${Date.now().toString(36)}`;
      const r = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: `Boutique ${suffix}`, kind: 'shop' }).expect(201);
      return r.body.id as string;
    };
    const pub = await mk('pub');
    const priv = await mk('priv');
    await ctx.sql.query(`UPDATE organizations SET visibility = 'private' WHERE id = $1`, [priv]);
    const res = await ctx.http.get('/v1/discover/merchants').query({ limit: 30 }).set(bearer(owner.token)).expect(200);
    const ids = res.body.items.map((m: { orgId: string }) => m.orgId);
    expect(ids).toContain(pub);
    expect(ids).not.toContain(priv);
  });
});

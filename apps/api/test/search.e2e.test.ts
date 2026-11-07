import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ SEARCH_RATE_LIMIT_PER_MINUTE: '10000' });
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
  handle: string;
}
let n = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${++n}`.replace(/[^a-z0-9]/gi, '');
async function user(displayName = 'Test User', identifier?: string): Promise<TU> {
  const { tokens } = await signUp(ctx, identifier, displayName);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}
async function createOrg(owner: TU, extra: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const res = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug: uniq('shop'), name: 'Boutique', kind: 'shop', ...extra })
    .expect(201);
  return { id: res.body.id, slug: res.body.slug };
}
const search = (u: TU, qs: string) => ctx.http.get(`/v1/search?${qs}`).set(bearer(u.token));
const enc = encodeURIComponent;
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const post = (u: TU, body: string, visibility = 'public') =>
  ctx.http.post('/v1/posts').set(bearer(u.token)).send({ clientId: randomUUID(), body, visibility }).expect(201);
const productFor = (owner: TU, orgId: string, title: string, status: string) =>
  ctx.http
    .post(`/v1/orgs/${orgId}/products`)
    .set(bearer(owner.token))
    .send({ title, description: 'desc', status, variants: [{ sku: uniq('sku'), options: { t: 'M' }, priceMinor: 1500, currency: 'USD', stock: 5 }] })
    .expect(201);

describe('users', () => {
  it('ranks exact, then prefix, then contains, on name and @handle; only active users, never oneself', async () => {
    const tag = uniq('kivu');
    const searcher = await user('Searcher');
    const contains = await user(`Mon ${tag}`);
    const prefix = await user(`${tag}land`);
    const exact = await user(tag);
    const gone = await user(`${tag} suspendu`);
    await ctx.sql.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [gone.id]);

    const res = await search(searcher, `q=${tag}&scope=users`).expect(200);
    expect(ids(res.body.users.items)).toEqual([exact.id, prefix.id, contains.id]);
    expect(res.body.orgs).toBeUndefined();
    const upper = await search(searcher, `q=${tag.toUpperCase()}&scope=users`).expect(200);
    expect(ids(upper.body.users.items)).toEqual([exact.id, prefix.id, contains.id]);
    // @handle searches the handle only.
    const byHandle = await search(searcher, `q=${enc('@' + exact.handle)}&scope=users`).expect(200);
    expect(byHandle.body.users.items[0]).toEqual({ id: exact.id, handle: exact.handle, displayName: tag, avatarUrl: null });
    // Oneself is not a result.
    const self = await search(exact, `q=${tag}&scope=users`).expect(200);
    expect(ids(self.body.users.items)).toEqual([prefix.id, contains.id]);
  });

  it('finds by phone or e-mail only on the exact identifier of a user who allows it', async () => {
    const phone = `+24397${String(Date.now()).slice(-7)}`;
    const searcher = await user('Searcher');
    const byPhone = await user('Phone Person', phone);
    const email = (await signUp(ctx, undefined, 'Mail Person')).identifier;
    const emailId = (await ctx.sql.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id as string;

    const found = async (q: string) => ids((await search(searcher, `q=${enc(q)}&scope=users`).expect(200)).body.users.items);
    expect(await found(phone)).toEqual([]);
    expect(await found(email)).toEqual([]);

    await ctx.http.patch('/v1/me/privacy').set(bearer(byPhone.token)).send({ discoverableByPhone: true }).expect(200);
    await ctx.sql.query('UPDATE users SET discoverable_by_email = true WHERE id = $1', [emailId]);
    expect(await found(phone)).toEqual([byPhone.id]);
    expect(await found(email)).toEqual([emailId]);
    expect(await found(email.toUpperCase())).toEqual([emailId]); // e-mail is case-insensitive
    // Never by fragment, even when discoverable.
    expect(await found(phone.slice(0, -2))).toEqual([]);
    expect(await found(email.split('@')[0]!)).toEqual([]);
    await ctx.http.patch('/v1/me/privacy').set(bearer(byPhone.token)).send({ discoverableByPhone: false }).expect(200);
    expect(await found(phone)).toEqual([]);
  });

  it('excludes blocked users in both directions', async () => {
    const tag = uniq('blk');
    const me = await user('Me');
    const iBlocked = await user(`${tag} one`);
    const blockedMe = await user(`${tag} two`);
    const free = await user(`${tag} three`);
    await ctx.http.put(`/v1/blocks/${iBlocked.id}`).set(bearer(me.token)).expect(204);
    await ctx.http.put(`/v1/blocks/${me.id}`).set(bearer(blockedMe.token)).expect(204);
    const res = await search(me, `q=${tag}&scope=users`).expect(200);
    expect(ids(res.body.users.items)).toEqual([free.id]);
  });
});

describe('organisations, products and posts', () => {
  it('shows public active organisations only', async () => {
    const tag = uniq('org');
    const owner = await user('Owner');
    const viewer = await user('Viewer');
    const pub = await createOrg(owner, { name: `${tag} Public` });
    await createOrg(owner, { name: `${tag} Prive`, visibility: 'private' });
    const susp = await createOrg(owner, { name: `${tag} Suspendue` });
    await ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [susp.id]);
    const res = await search(viewer, `q=${tag}&scope=orgs`).expect(200);
    expect(res.body.orgs.items).toEqual([
      { id: pub.id, slug: pub.slug, name: `${tag} Public`, kind: 'shop', logoUrl: null, city: null, verified: false },
    ]);
  });

  it('applies the storefront visibility to products (draft, private org, hidden, blocked seller)', async () => {
    const tag = uniq('prod');
    const owner = await user('Seller');
    const viewer = await user('Buyer');
    const org = await createOrg(owner);
    const privOrg = await createOrg(owner, { visibility: 'private' });
    const live = (await productFor(owner, org.id, `${tag} visible`, 'published')).body;
    await productFor(owner, org.id, `${tag} brouillon`, 'draft');
    await productFor(owner, privOrg.id, `${tag} orgprivee`, 'published');
    const hidden = (await productFor(owner, org.id, `${tag} masque`, 'published')).body;
    await ctx.sql.query('UPDATE products SET hidden = true WHERE id = $1', [hidden.id]);

    const res = await search(viewer, `q=${tag}&scope=products`).expect(200);
    expect(res.body.products.items).toEqual([
      { id: live.id, title: `${tag} visible`, coverUrl: null, minPriceMinor: 1500, currency: 'USD', org: { id: org.id, slug: org.slug, name: 'Boutique' } },
    ]);
    await ctx.http.put(`/v1/blocks/${owner.id}`).set(bearer(viewer.token)).expect(204);
    expect((await search(viewer, `q=${tag}&scope=products`).expect(200)).body.products.items).toEqual([]);
  });

  it('returns only the posts the caller may see', async () => {
    const tag = uniq('post');
    const author = await user('Author');
    const stranger = await user('Stranger');
    const follower = await user('Follower');
    await ctx.http.put(`/v1/users/${author.id}/follow`).set(bearer(follower.token)).expect(204);
    const pub = (await post(author, `${tag} publique`)).body;
    const fol = (await post(author, `${tag} abonnes`, 'followers')).body;
    const priv = (await post(author, `${tag} privee`, 'private')).body;

    const asStranger = await search(stranger, `q=${tag}&scope=posts`).expect(200);
    expect(ids(asStranger.body.posts.items)).toEqual([pub.id]);
    expect(asStranger.body.posts.items[0]).toMatchObject({ authorId: author.id, authorHandle: author.handle, snippet: `${tag} publique` });
    const asFollower = await search(follower, `q=${tag}&scope=posts`).expect(200);
    expect(ids(asFollower.body.posts.items).sort()).toEqual([pub.id, fol.id].sort());
    const asAuthor = await search(author, `q=${tag}&scope=posts`).expect(200);
    expect(ids(asAuthor.body.posts.items).sort()).toEqual([pub.id, fol.id, priv.id].sort());
    await ctx.http.put(`/v1/blocks/${author.id}`).set(bearer(stranger.token)).expect(204);
    expect((await search(stranger, `q=${tag}&scope=posts`).expect(200)).body.posts.items).toEqual([]);
  });
});

describe('scope and pagination', () => {
  it('gives 5 per category for scope=all and paginates a single scope without overlap', async () => {
    const tag = uniq('pg');
    const author = await user('Paginator');
    const viewer = await user('Viewer');
    const created: string[] = [];
    for (let i = 0; i < 7; i++) created.push((await post(author, `${tag} numero ${i}`)).body.id);

    const all = await search(viewer, `q=${tag}`).expect(200);
    expect(all.body.scope).toBe('all');
    expect(Object.keys(all.body).sort()).toEqual(['orgs', 'posts', 'products', 'scope', 'users']);
    expect(all.body.posts.items).toHaveLength(5);
    expect(all.body.posts.nextCursor).toEqual(expect.any(String));
    expect(all.body.users.items).toEqual([]);
    // The category cursor continues under its own scope.
    const rest = await search(viewer, `q=${tag}&scope=posts&limit=5&cursor=${all.body.posts.nextCursor}`).expect(200);
    expect(rest.body.posts.items).toHaveLength(2);
    expect([...ids(all.body.posts.items), ...ids(rest.body.posts.items)].sort()).toEqual([...created].sort());

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res = await search(viewer, `q=${tag}&scope=posts&limit=3${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      seen.push(...ids(res.body.posts.items));
      cursor = res.body.posts.nextCursor as string | null;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen[0]).toBe(created[6]); // newest first

    await search(viewer, `q=${tag}&scope=all&cursor=${all.body.posts.nextCursor}`).expect(400);
    await search(viewer, `q=${tag}&scope=posts&cursor=garbage`).expect(400);
    await search(viewer, 'q=a').expect(400);
    await search(viewer, `q=${tag}&scope=nope`).expect(400);
    await ctx.http.get(`/v1/search?q=${tag}`).expect(401);
  });
});

describe('search history', () => {
  it('records first pages, deduplicates, honours the setting, deletes entries and caps at 50', async () => {
    const u = await user('Historian');
    const other = await user('Other');
    const get = () => ctx.http.get('/v1/me/search-history').set(bearer(u.token)).expect(200);

    expect((await get()).body).toEqual({ enabled: true, items: [] });
    await search(u, 'q=alpha&scope=users').expect(200);
    await search(u, 'q=beta&scope=orgs').expect(200);
    await search(u, 'q=ALPHA&scope=users').expect(200); // same query again: one entry, moved to the top
    const h = (await get()).body;
    expect(h.items.map((i: { query: string; scope: string }) => [i.query, i.scope])).toEqual([['ALPHA', 'users'], ['beta', 'orgs']]);
    expect(h.items[0]).toEqual({ id: expect.any(String), query: 'ALPHA', scope: 'users', createdAt: expect.any(String) });
    // Never shared.
    expect((await ctx.http.get('/v1/me/search-history').set(bearer(other.token)).expect(200)).body.items).toEqual([]);
    await ctx.http.delete(`/v1/me/search-history/${h.items[0].id}`).set(bearer(other.token)).expect(404);
    await ctx.http.delete('/v1/me/search-history/not-a-uuid').set(bearer(u.token)).expect(404);

    // Pages after the first are not recorded.
    const tag = uniq('hist');
    const author = await user('Writer');
    for (let i = 0; i < 3; i++) await post(author, `${tag} ${i}`);
    const first = await search(u, `q=${tag}&scope=posts&limit=1`).expect(200);
    await search(u, `q=${tag}&scope=posts&limit=1&cursor=${first.body.posts.nextCursor}`).expect(200);
    expect((await get()).body.items.filter((i: { query: string }) => i.query === tag)).toHaveLength(1);

    // Disabling stops recording and keeps what exists.
    await ctx.http.patch('/v1/me/search-history/settings').set(bearer(u.token)).send({ enabled: false }).expect(200, { enabled: false });
    await search(u, 'q=gamma&scope=users').expect(200);
    const off = (await get()).body;
    expect(off.enabled).toBe(false);
    expect(off.items.map((i: { query: string }) => i.query)).not.toContain('gamma');
    expect(off.items.length).toBeGreaterThan(0);
    await ctx.http.patch('/v1/me/search-history/settings').set(bearer(u.token)).send({ enabled: 'yes' }).expect(400);
    await ctx.http.patch('/v1/me/search-history/settings').set(bearer(u.token)).send({ enabled: true }).expect(200, { enabled: true });

    // Delete one, then everything.
    await ctx.http.delete(`/v1/me/search-history/${h.items[1].id}`).set(bearer(u.token)).expect(204);
    await ctx.http.delete(`/v1/me/search-history/${h.items[1].id}`).set(bearer(u.token)).expect(404);
    await ctx.http.delete('/v1/me/search-history').set(bearer(u.token)).expect(204);
    expect((await get()).body.items).toEqual([]);

    // At most 50 entries, oldest dropped.
    for (let i = 0; i < 53; i++) await search(u, `q=${enc('term' + String(i).padStart(2, '0'))}&scope=users`).expect(200);
    const capped = (await get()).body.items.map((i: { query: string }) => i.query);
    expect(capped).toHaveLength(50);
    expect(capped[0]).toBe('term52');
    expect(capped).not.toContain('term00');
    await ctx.http.get('/v1/me/search-history').expect(401);
  });

  it('is part of the export and erased by the purge', async () => {
    const u = await user('Exported');
    await search(u, 'q=exportme&scope=users').expect(200);
    const exp = await ctx.http.get('/v1/me/export').set(bearer(u.token)).expect(200);
    expect(exp.body.searchHistory).toEqual([{ query: 'exportme', scope: 'users', createdAt: expect.any(String) }]);

    await ctx.http.patch('/v1/me/search-history/settings').set(bearer(u.token)).send({ enabled: false }).expect(200);
    await ctx.http.post('/v1/me/deletion-request').set(bearer(u.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [u.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    for (const t of ['search_history', 'search_settings']) {
      const r = await ctx.sql.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [u.id]);
      expect(r.rows[0].n).toBe(0);
    }
  });
});

describe('rate limit', () => {
  it('answers 429 once SEARCH_RATE_LIMIT_PER_MINUTE is exhausted, and only for the search route', async () => {
    const limited = await createTestContext({ SEARCH_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const { tokens } = await signUp(limited);
      const h = bearer(tokens.accessToken);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await limited.http.get('/v1/search?q=abc&scope=users').set(h)).status);
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      await limited.http.get('/v1/me/search-history').set(h).expect(200);
    } finally {
      await limited.close();
    }
  });
});

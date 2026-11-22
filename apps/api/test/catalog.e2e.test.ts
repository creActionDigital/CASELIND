import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogPort } from '../src/commerce/catalog.port.js';
import { DB, type Db } from '../src/db/db.module.js';
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
  handle: string;
}

async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query(`UPDATE users SET roles = $1 WHERE id = $2`, [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

let n = 0;
const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;

async function createOrg(owner: TU, extra: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const res = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug: uniq('shop'), name: 'Boutique', kind: 'shop', ...extra })
    .expect(201);
  return { id: res.body.id, slug: res.body.slug };
}

async function addMember(orgId: string, inviter: TU, invitee: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(inviter.token)).send({ handle: invitee.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(invitee.token)).expect(200);
}

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

const variant = (extra: Record<string, unknown> = {}) => ({
  sku: uniq('SKU'),
  options: { taille: 'M' },
  priceMinor: 1500,
  currency: 'USD',
  stock: 5,
  ...extra,
});

const productBody = (extra: Record<string, unknown> = {}) => ({
  title: 'T-shirt',
  description: 'Coton bio',
  variants: [variant()],
  ...extra,
});

const create = (owner: TU, orgId: string, body: Record<string, unknown> = productBody()) =>
  ctx.http.post(`/v1/orgs/${orgId}/products`).set(bearer(owner.token)).send(body);

async function publishedProduct(owner: TU, orgId: string, extra: Record<string, unknown> = {}) {
  const res = await create(owner, orgId, productBody({ status: 'published', ...extra })).expect(201);
  return res.body as { id: string; variants: { id: string; stock: number }[] };
}

const storefront = (u: TU, qs = '') => ctx.http.get(`/v1/products${qs ? `?${qs}` : ''}`).set(bearer(u.token));
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe('categories', () => {
  it('lists the 10 seeded platform categories', async () => {
    const u = await user();
    const res = await ctx.http.get('/v1/catalog/categories').set(bearer(u.token)).expect(200);
    expect(res.body.items).toHaveLength(10);
    expect(res.body.items.map((c: { slug: string }) => c.slug)).toContain('auto-moto');
    await ctx.http.get('/v1/catalog/categories').expect(401);
  });
});

describe('seller routes and roles', () => {
  it('lets owner, manager and sales manage products; refuses employee (403) and non-members (404)', async () => {
    const [owner, manager, sales, employee, stranger] = [await user(), await user(), await user(), await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org.id, owner, manager, 'manager');
    await addMember(org.id, owner, sales, 'sales');
    await addMember(org.id, owner, employee, 'employee');

    for (const u of [owner, manager, sales]) {
      const res = await create(u, org.id).expect(201);
      expect(res.body).toMatchObject({ orgId: org.id, status: 'draft', hidden: false, title: 'T-shirt' });
      expect(res.body.variants[0]).toMatchObject({ priceMinor: 1500, currency: 'USD', stock: 5, trackStock: true, active: true });
    }
    await create(employee, org.id).expect(403);
    await ctx.http.get(`/v1/orgs/${org.id}/products`).set(bearer(employee.token)).expect(403);
    await create(stranger, org.id).expect(404);
    await ctx.http.get(`/v1/orgs/${org.id}/products`).set(bearer(stranger.token)).expect(404);
    await ctx.http.get(`/v1/orgs/${org.id}/products`).expect(401);
  });

  it('audits creation, publication and archiving, without free text', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const p = (await create(owner, org.id, productBody({ title: 'Secret title' })).expect(201)).body;
    await ctx.http.patch(`/v1/orgs/${org.id}/products/${p.id}`).set(bearer(owner.token)).send({ status: 'published' }).expect(200);
    await ctx.http.delete(`/v1/orgs/${org.id}/products/${p.id}`).set(bearer(owner.token)).expect(204);
    const rows = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE metadata->>'productId' = $1 ORDER BY occurred_at`, [p.id]);
    expect(rows.rows.map((r) => r.action)).toEqual(['product.created', 'product.published', 'product.archived']);
    expect(JSON.stringify(rows.rows)).not.toContain('Secret title');
  });

  it('validates input: duplicate SKU 409, currency outside the list 400, foreign or wrong media 400, bad price/count 400', async () => {
    const [owner, other] = [await user(), await user()];
    const org = await createOrg(owner);
    const otherOrg = await createOrg(other);
    const v = variant({ sku: 'DUP-1' });
    await create(owner, org.id, productBody({ variants: [v] })).expect(201);
    const taken = await create(owner, org.id, productBody({ variants: [variant({ sku: 'DUP-1' })] })).expect(409);
    expect(taken.body.error.details).toEqual({ reason: 'sku_taken', field: 'sku', sku: 'DUP-1' });
    // Same SKU in another org is fine.
    await create(other, otherOrg.id, productBody({ variants: [variant({ sku: 'DUP-1' })] })).expect(201);
    // Duplicate inside the request.
    const twice = await create(owner, org.id, productBody({ variants: [variant({ sku: 'X' }), variant({ sku: 'X' })] })).expect(409);
    expect(twice.body.error.details).toEqual({ reason: 'duplicate_sku_in_request', field: 'sku', sku: 'X' });

    await create(owner, org.id, productBody({ variants: [variant({ currency: 'EUR' })] })).expect(400);
    await create(owner, org.id, productBody({ variants: [variant({ priceMinor: 0 })] })).expect(400);
    await create(owner, org.id, productBody({ variants: [variant({ priceMinor: 9.5 })] })).expect(400);
    await create(owner, org.id, productBody({ variants: [variant({ stock: -1 })] })).expect(400);
    await create(owner, org.id, productBody({ variants: [] })).expect(400);
    await create(owner, org.id, productBody({ title: '' })).expect(400);
    await create(owner, org.id, productBody({ description: 'x'.repeat(5001) })).expect(400);
    await create(owner, org.id, productBody({ categoryId: randomUUID() })).expect(400);

    const mine = await upload(owner, 'product');
    const foreign = await upload(other, 'product');
    const wrongPurpose = await upload(owner, 'post');
    await create(owner, org.id, productBody({ mediaIds: [foreign] })).expect(400);
    await create(owner, org.id, productBody({ mediaIds: [wrongPurpose] })).expect(400);
    await create(owner, org.id, productBody({ mediaIds: [randomUUID()] })).expect(400);
    await create(owner, org.id, productBody({ mediaIds: [mine, mine] })).expect(400);
    const ok = await create(owner, org.id, productBody({ mediaIds: [mine] })).expect(201);
    expect(ok.body.media).toHaveLength(1);
  });

  it('accepts media uploaded by another member of the org', async () => {
    const [owner, sales] = [await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org.id, owner, sales, 'sales');
    const media = await upload(sales, 'product');
    await create(owner, org.id, productBody({ mediaIds: [media] })).expect(201);
  });

  it('refuses to publish without an active variant (409) and edits variants, keeping stock', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const p = (await create(owner, org.id, productBody({ variants: [variant({ active: false })] })).expect(201)).body;
    const refused = await ctx.http.patch(`/v1/orgs/${org.id}/products/${p.id}`).set(bearer(owner.token)).send({ status: 'published' }).expect(409);
    expect(refused.body.error.details).toEqual({ reason: 'publish_without_variant' });
    const refusedCreate = await create(owner, org.id, productBody({ status: 'published', variants: [variant({ active: false })] })).expect(409);
    expect(refusedCreate.body.error.details.reason).toBe('publish_without_variant');

    const v0 = p.variants[0];
    const res = await ctx.http
      .patch(`/v1/orgs/${org.id}/products/${p.id}`)
      .set(bearer(owner.token))
      .send({
        status: 'published',
        title: 'Renamed',
        variants: [{ id: v0.id, sku: v0.sku, options: {}, priceMinor: 2000, currency: 'CDF', active: true, trackStock: true }, variant({ sku: 'NEW-1', stock: 3 })],
      })
      .expect(200);
    expect(res.body.status).toBe('published');
    expect(res.body.title).toBe('Renamed');
    expect(res.body.variants).toHaveLength(2);
    expect(res.body.variants.find((v: { id: string }) => v.id === v0.id)).toMatchObject({ priceMinor: 2000, currency: 'CDF', stock: 5 });
    await ctx.http.patch(`/v1/orgs/${org.id}/products/${p.id}`).set(bearer(owner.token)).send({}).expect(400);
    await ctx.http.get(`/v1/orgs/${org.id}/products/${randomUUID()}`).set(bearer(owner.token)).expect(404);
  });

  it('cannot reach a product of another org through its own org id', async () => {
    const [a, b] = [await user(), await user()];
    const [orgA, orgB] = [await createOrg(a), await createOrg(b)];
    const p = (await create(a, orgA.id).expect(201)).body;
    await ctx.http.get(`/v1/orgs/${orgB.id}/products/${p.id}`).set(bearer(b.token)).expect(404);
    await ctx.http.delete(`/v1/orgs/${orgB.id}/products/${p.id}`).set(bearer(b.token)).expect(404);
  });

  it('lists the org products with status filter, search and pagination', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    for (const t of ['Alpha', 'Bravo', 'Charlie']) await create(owner, org.id, productBody({ title: t })).expect(201);
    await create(owner, org.id, productBody({ title: 'Delta', status: 'published' })).expect(201);
    const p1 = await ctx.http.get(`/v1/orgs/${org.id}/products?limit=3`).set(bearer(owner.token)).expect(200);
    expect(p1.body.items.map((i: { title: string }) => i.title)).toEqual(['Delta', 'Charlie', 'Bravo']);
    const p2 = await ctx.http.get(`/v1/orgs/${org.id}/products?limit=3&cursor=${p1.body.nextCursor}`).set(bearer(owner.token)).expect(200);
    expect(p2.body.items.map((i: { title: string }) => i.title)).toEqual(['Alpha']);
    expect(p2.body.nextCursor).toBeNull();
    const pub = await ctx.http.get(`/v1/orgs/${org.id}/products?status=published`).set(bearer(owner.token)).expect(200);
    expect(pub.body.items).toHaveLength(1);
    const q = await ctx.http.get(`/v1/orgs/${org.id}/products?q=brav`).set(bearer(owner.token)).expect(200);
    expect(q.body.items.map((i: { title: string }) => i.title)).toEqual(['Bravo']);
  });
});

describe('storefront', () => {
  it('shows only published products of active public orgs, with detail and inStock', async () => {
    const [owner, buyer] = [await user(), await user()];
    const org = await createOrg(owner);
    const priv = await createOrg(owner, { visibility: 'private' });
    const susp = await createOrg(owner);

    const pub = await publishedProduct(owner, org.id, { title: 'Visible' });
    const draft = (await create(owner, org.id, productBody({ title: 'Draft' })).expect(201)).body;
    const archived = await publishedProduct(owner, org.id, { title: 'Archived' });
    await ctx.http.delete(`/v1/orgs/${org.id}/products/${archived.id}`).set(bearer(owner.token)).expect(204);
    const inPrivate = await publishedProduct(owner, priv.id, { title: 'In private org' });
    const inSuspended = await publishedProduct(owner, susp.id, { title: 'In suspended org' });
    await ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [susp.id]);

    const list = await storefront(buyer, `orgId=${org.id}`).expect(200);
    expect(ids(list)).toEqual([pub.id]);
    for (const hidden of [draft.id, archived.id, inPrivate.id, inSuspended.id]) {
      await ctx.http.get(`/v1/products/${hidden}`).set(bearer(buyer.token)).expect(404);
    }
    const all = await storefront(buyer, 'limit=100').expect(200);
    for (const hidden of [draft.id, archived.id, inPrivate.id, inSuspended.id]) expect(ids(all)).not.toContain(hidden);

    const detail = await ctx.http.get(`/v1/products/${pub.id}`).set(bearer(buyer.token)).expect(200);
    expect(detail.body).toMatchObject({ title: 'Visible', inStock: true, minPriceMinor: 1500, currency: 'USD', org: { slug: org.slug } });
    expect(detail.body.variants[0]).toMatchObject({ priceMinor: 1500, inStock: true });
    expect(detail.body.variants[0]).not.toHaveProperty('stock');
    await ctx.http.get(`/v1/products/not-a-uuid`).set(bearer(buyer.token)).expect(404);
    await ctx.http.get(`/v1/products/${pub.id}`).expect(401);
  });

  it('lists the colour options of the variants on the cards (max 4, colour keys only)', async () => {
    const [owner, buyer] = [await user(), await user()];
    const org = await createOrg(owner);
    const p = await publishedProduct(owner, org.id, {
      title: 'Colorful',
      variants: ['noir', 'Noir', 'blanc', 'rouge', 'vert', 'jaune'].map((c, i) => variant({ sku: `COL-${i}`, options: { couleur: c, taille: 'M' } })),
    });
    const list = await storefront(buyer, `orgId=${org.id}`).expect(200);
    const card = list.body.items.find((i: { id: string }) => i.id === p.id);
    expect(card.colors).toHaveLength(4);
    expect(card.colors).not.toContain('M');
    const plain = await publishedProduct(owner, org.id, { title: 'Plain' });
    const l2 = await storefront(buyer, `orgId=${org.id}`).expect(200);
    expect(l2.body.items.find((i: { id: string }) => i.id === plain.id).colors).toEqual([]);
  });

  it('filters by category, price, currency, org and search; sorts and paginates', async () => {
    const [owner, buyer] = [await user(), await user()];
    const org = await createOrg(owner);
    const other = await createOrg(owner);
    const cats = (await ctx.http.get('/v1/catalog/categories').set(bearer(buyer.token))).body.items as { id: string; slug: string }[];
    const mode = cats.find((c) => c.slug === 'mode')!.id;
    const price = (p: number, currency = 'USD') => [variant({ priceMinor: p, currency })];
    const a = await publishedProduct(owner, org.id, { title: 'Robe rouge', description: 'Elegante', categoryId: mode, variants: price(3000) });
    const b = await publishedProduct(owner, org.id, { title: 'Chaussures', variants: price(1000) });
    const c = await publishedProduct(owner, org.id, { title: 'Sac', description: 'ROUGE vif', variants: price(2000) });
    const d = await publishedProduct(owner, org.id, { title: 'Tissu', variants: price(500000, 'CDF') });
    const e = await publishedProduct(owner, other.id, { title: 'Ailleurs', variants: price(1500) });
    const scoped = (qs: string) => storefront(buyer, `orgId=${org.id}&${qs}`).expect(200);

    expect(ids(await scoped('categoryId=' + mode))).toEqual([a.id]);
    expect(ids(await scoped('minPrice=1500&maxPrice=2500&currency=USD'))).toEqual([c.id]);
    expect(ids(await scoped('currency=CDF'))).toEqual([d.id]);
    expect(new Set(ids(await scoped('q=rouge')))).toEqual(new Set([a.id, c.id]));
    expect(ids(await scoped('q=%25'))).toEqual([]);
    expect(ids(await storefront(buyer, `orgId=${other.id}`).expect(200))).toEqual([e.id]);

    expect(ids(await scoped('sort=recent'))).toEqual([d.id, c.id, b.id, a.id]);
    expect(ids(await scoped('sort=price_asc&currency=USD'))).toEqual([b.id, c.id, a.id]);
    expect(ids(await scoped('sort=price_desc&currency=USD'))).toEqual([a.id, c.id, b.id]);

    const p1 = await scoped('sort=price_asc&currency=USD&limit=2');
    expect(ids(p1)).toEqual([b.id, c.id]);
    const p2 = await scoped(`sort=price_asc&currency=USD&limit=2&cursor=${p1.body.nextCursor}`);
    expect(ids(p2)).toEqual([a.id]);
    expect(p2.body.nextCursor).toBeNull();
    const r1 = await scoped('limit=3');
    const r2 = await scoped(`limit=3&cursor=${r1.body.nextCursor}`);
    expect([...ids(r1), ...ids(r2)]).toEqual([d.id, c.id, b.id, a.id]);

    await storefront(buyer, 'sort=weird').expect(400);
    await storefront(buyer, 'cursor=garbage').expect(400);
  });

  it('hides the products of a seller blocked with the caller', async () => {
    const [owner, buyer] = [await user(), await user()];
    const org = await createOrg(owner);
    const p = await publishedProduct(owner, org.id);
    expect(ids(await storefront(buyer, `orgId=${org.id}`).expect(200))).toEqual([p.id]);
    await ctx.http.put(`/v1/blocks/${owner.id}`).set(bearer(buyer.token)).expect(204);
    expect(ids(await storefront(buyer, `orgId=${org.id}`).expect(200))).toEqual([]);
    await ctx.http.get(`/v1/products/${p.id}`).set(bearer(buyer.token)).expect(404);
  });

  it('serves the public storefront of an org without a token', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const priv = await createOrg(owner, { visibility: 'private' });
    const p = await publishedProduct(owner, org.id, { title: 'Public one' });
    await create(owner, org.id, productBody({ title: 'Brouillon' })).expect(201);
    await publishedProduct(owner, priv.id);

    const res = await ctx.http.get(`/v1/public/orgs/${org.slug}/products`).expect(200);
    expect(ids(res)).toEqual([p.id]);
    expect((await ctx.http.get(`/v1/public/orgs/${org.slug}/products?q=public`).expect(200)).body.items).toHaveLength(1);
    await ctx.http.get(`/v1/public/orgs/${priv.slug}/products`).expect(404);
    await ctx.http.get(`/v1/public/orgs/unknown-shop/products`).expect(404);
    await ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [org.id]);
    await ctx.http.get(`/v1/public/orgs/${org.slug}/products`).expect(404);
  });
});

describe('stock', () => {
  it('journals movements, keeps stock non-negative and the journal append-only', async () => {
    const [owner, stock, employee] = [await user(), await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org.id, owner, stock, 'stock');
    await addMember(org.id, owner, employee, 'employee');
    const p = await publishedProduct(owner, org.id);
    const vid = p.variants[0]!.id;
    const url = `/v1/orgs/${org.id}/variants/${vid}/stock`;

    const up = await ctx.http.post(url).set(bearer(stock.token)).send({ delta: 10, reason: 'restock' }).expect(200);
    expect(up.body.stock).toBe(15);
    expect((await ctx.http.post(url).set(bearer(owner.token)).send({ delta: -3, reason: 'damage' }).expect(200)).body.stock).toBe(12);
    const negative = await ctx.http.post(url).set(bearer(owner.token)).send({ delta: -13, reason: 'adjustment' }).expect(409);
    expect(negative.body.error.details).toEqual({ reason: 'stock_negative' });
    await ctx.http.post(url).set(bearer(owner.token)).send({ delta: 0, reason: 'adjustment' }).expect(400);
    await ctx.http.post(url).set(bearer(owner.token)).send({ delta: 1, reason: 'order_reserved' }).expect(400);
    await ctx.http.post(url).set(bearer(employee.token)).send({ delta: 1, reason: 'restock' }).expect(403);
    await ctx.http.post(`/v1/orgs/${org.id}/variants/${randomUUID()}/stock`).set(bearer(owner.token)).send({ delta: 1, reason: 'restock' }).expect(404);

    // A variant of another org is a 404.
    const other = await user();
    const otherOrg = await createOrg(other);
    await ctx.http.post(`/v1/orgs/${otherOrg.id}/variants/${vid}/stock`).set(bearer(other.token)).send({ delta: 1, reason: 'restock' }).expect(404);

    const moves = await ctx.sql.query(`SELECT delta, stock_after, reason FROM stock_movements WHERE variant_id = $1 ORDER BY created_at, id`, [vid]);
    expect(moves.rows.map((r) => [r.delta, r.stock_after, r.reason])).toEqual([
      [5, 5, 'initial'],
      [10, 15, 'restock'],
      [-3, 12, 'damage'],
    ]);
    await expect(ctx.sql.query(`UPDATE stock_movements SET delta = 99 WHERE variant_id = $1`, [vid])).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`DELETE FROM stock_movements WHERE variant_id = $1`, [vid])).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`UPDATE product_variants SET stock = -1 WHERE id = $1`, [vid])).rejects.toThrow();
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'stock.adjusted' AND metadata->>'variantId' = $1`, [vid]);
    expect(audit.rows).toHaveLength(2);
  });

  it('does not track stock when trackStock is false', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const p = await publishedProduct(owner, org.id, { variants: [variant({ trackStock: false, stock: 0 })] });
    const res = await ctx.http
      .post(`/v1/orgs/${org.id}/variants/${p.variants[0]!.id}/stock`)
      .set(bearer(owner.token))
      .send({ delta: 1, reason: 'restock' })
      .expect(409);
    expect(res.body.error.details).toEqual({ reason: 'stock_not_tracked' });
  });

  it('names the colliding SKU when an edit reuses another variant SKU', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    await create(owner, org.id, productBody({ variants: [variant({ sku: 'TAKEN-1' })] })).expect(201);
    const p = (await create(owner, org.id, productBody({ variants: [variant({ sku: 'MINE-1' })] })).expect(201)).body;
    const v0 = p.variants[0];
    const res = await ctx.http
      .patch(`/v1/orgs/${org.id}/products/${p.id}`)
      .set(bearer(owner.token))
      .send({ variants: [{ id: v0.id, sku: 'TAKEN-1', options: {}, priceMinor: 2000, currency: 'CDF', active: true, trackStock: true }] })
      .expect(409);
    expect(res.body.error.details).toEqual({ reason: 'sku_taken', field: 'sku', sku: 'TAKEN-1' });
  });

  it('lets the stock role read products and variants but not write them', async () => {
    const [owner, stock, employee, outsider] = [await user(), await user(), await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org.id, owner, stock, 'stock');
    await addMember(org.id, owner, employee, 'employee');
    const p = await publishedProduct(owner, org.id);
    const list = await ctx.http.get(`/v1/orgs/${org.id}/products`).set(bearer(stock.token)).expect(200);
    expect(list.body.items.map((i: any) => i.id)).toContain(p.id);
    const one = await ctx.http.get(`/v1/orgs/${org.id}/products/${p.id}`).set(bearer(stock.token)).expect(200);
    expect(one.body.variants[0].stock).toBe(5);
    await ctx.http.patch(`/v1/orgs/${org.id}/products/${p.id}`).set(bearer(stock.token)).send({ title: 'Nope' }).expect(403);
    await create(stock, org.id, productBody()).expect(403);
    await ctx.http.get(`/v1/orgs/${org.id}/products`).set(bearer(employee.token)).expect(403);
    await ctx.http.get(`/v1/orgs/${org.id}/products/${p.id}`).set(bearer(employee.token)).expect(403);
    await ctx.http.get(`/v1/orgs/${org.id}/products`).set(bearer(outsider.token)).expect(404);
  });
});

describe('CatalogPort', () => {
  const port = () => ctx.app.get(CatalogPort);
  const db = () => ctx.app.get<Db>(DB);
  const stockOf = async (vid: string) => (await ctx.sql.query(`SELECT stock FROM product_variants WHERE id = $1`, [vid])).rows[0].stock as number;

  it('reserve with an org filter ignores other shops and labels the movement', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const owner2 = await user();
    const other = await createOrg(owner2);
    const mine = (await publishedProduct(owner, org.id, { variants: [variant({ stock: 5 })] })).variants[0]!.id;
    const foreign = (await publishedProduct(owner2, other.id, { variants: [variant({ stock: 5 })] })).variants[0]!.id;
    const bad = await db().transaction((tx) => port().reserve(tx, [{ variantId: foreign, quantity: 999 }], undefined, { orgId: org.id }));
    expect(bad).toEqual({ ok: false, reason: 'unavailable', variantIds: [foreign] });
    expect(await stockOf(foreign)).toBe(5);
    const ok = await db().transaction((tx) => port().reserve(tx, [{ variantId: mine, quantity: 2 }], undefined, { orgId: org.id, reason: 'pos_sale' }));
    expect(ok.ok).toBe(true);
    const moves = await ctx.sql.query(`SELECT delta, reason FROM stock_movements WHERE variant_id = $1 AND delta < 0`, [mine]);
    expect(moves.rows.map((r) => [r.delta, r.reason])).toEqual([[-2, 'pos_sale']]);
    await db().transaction((tx) => port().release(tx, [{ variantId: mine, quantity: 2 }], { reason: 'pos_void' }));
    expect(await stockOf(mine)).toBe(5);
    const back = await ctx.sql.query(`SELECT delta, reason FROM stock_movements WHERE variant_id = $1 AND delta > 0 ORDER BY created_at, id`, [mine]);
    expect(back.rows.map((r) => [r.delta, r.reason])).toEqual([[5, 'initial'], [2, 'pos_void']]);
  });

  it('reserves, prices and releases with journaled movements, all or nothing', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const p1 = await publishedProduct(owner, org.id, { title: 'Un', variants: [variant({ stock: 4, options: { couleur: 'bleu' } })] });
    const p2 = await publishedProduct(owner, org.id, { title: 'Deux', variants: [variant({ stock: 1 })] });
    const untracked = await publishedProduct(owner, org.id, { variants: [variant({ trackStock: false, stock: 0 })] });
    const [v1, v2, v3] = [p1.variants[0]!.id, p2.variants[0]!.id, untracked.variants[0]!.id];

    const priced = await port().price([{ variantId: v1, quantity: 2 }, { variantId: randomUUID(), quantity: 1 }]);
    expect(priced).toHaveLength(1);
    expect(priced[0]).toMatchObject({ variantId: v1, productId: p1.id, orgId: org.id, title: 'Un', variantLabel: 'couleur: bleu', unitPriceMinor: 1500, currency: 'USD', quantity: 2 });

    const ok = await db().transaction((tx) => port().reserve(tx, [{ variantId: v2, quantity: 1 }, { variantId: v1, quantity: 3 }, { variantId: v3, quantity: 50 }]));
    expect(ok.ok).toBe(true);
    expect([await stockOf(v1), await stockOf(v2), await stockOf(v3)]).toEqual([1, 0, 0]);

    // All or nothing: v1 has 1 left, so asking 2 fails and nothing else moves.
    const ko = await db().transaction((tx) => port().reserve(tx, [{ variantId: v1, quantity: 2 }, { variantId: v3, quantity: 1 }]));
    expect(ko).toEqual({ ok: false, reason: 'insufficient_stock', variantIds: [v1] });
    const unknown = await db().transaction((tx) => port().reserve(tx, [{ variantId: v1, quantity: 1 }, { variantId: randomUUID(), quantity: 1 }]));
    expect(unknown).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(await stockOf(v1)).toBe(1);

    await db().transaction((tx) => port().release(tx, [{ variantId: v1, quantity: 3 }, { variantId: v3, quantity: 50 }]));
    expect(await stockOf(v1)).toBe(4);
    const moves = await ctx.sql.query(`SELECT delta, reason FROM stock_movements WHERE variant_id = $1 ORDER BY created_at, id`, [v1]);
    expect(moves.rows.map((r) => [r.delta, r.reason])).toEqual([[4, 'initial'], [-3, 'order_reserved'], [3, 'order_released']]);
    expect((await ctx.sql.query(`SELECT count(*)::int AS c FROM stock_movements WHERE variant_id = $1`, [v3])).rows[0].c).toBe(0);

    // A rolled back transaction leaves the stock untouched.
    await expect(
      db().transaction(async (tx) => {
        await port().reserve(tx, [{ variantId: v1, quantity: 1 }]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await stockOf(v1)).toBe(4);
  });

  it('lets only one of two concurrent reservations of the last item succeed', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const p = await publishedProduct(owner, org.id, { variants: [variant({ stock: 1 })] });
    const vid = p.variants[0]!.id;
    const attempt = () => db().transaction((tx) => port().reserve(tx, [{ variantId: vid, quantity: 1 }]));
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: 'insufficient_stock', variantIds: [vid] });
    expect(await stockOf(vid)).toBe(0);
  });

  it('refuses unavailable variants and answers productExists', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const p = await publishedProduct(owner, org.id);
    const vid = p.variants[0]!.id;
    expect(await port().productExists(p.id)).toBe(true);
    expect(await port().productExists('nope')).toBe(false);
    await ctx.http.delete(`/v1/orgs/${org.id}/products/${p.id}`).set(bearer(owner.token)).expect(204);
    expect(await port().productExists(p.id)).toBe(false);
    expect(await port().price([{ variantId: vid, quantity: 1 }])).toEqual([]);
    const res = await db().transaction((tx) => port().reserve(tx, [{ variantId: vid, quantity: 1 }]));
    expect(res).toEqual({ ok: false, reason: 'unavailable', variantIds: [vid] });
    expect(await stockOf(vid)).toBe(5);
  });
});

describe('moderation and feature flag', () => {
  it('hides a reported product from buyers and restores it', async () => {
    const [owner, buyer, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    const org = await createOrg(owner);
    const p = await publishedProduct(owner, org.id);
    await ctx.http.post('/v1/reports').set(bearer(buyer.token)).send({ targetType: 'product', targetId: p.id, reason: 'scam' }).expect(201);
    await ctx.http
      .post('/v1/admin/moderation/actions')
      .set(bearer(mod.token))
      .send({ targetType: 'product', targetId: p.id, action: 'hide' })
      .expect(200);
    await ctx.http.get(`/v1/products/${p.id}`).set(bearer(buyer.token)).expect(404);
    expect(ids(await storefront(buyer, `orgId=${org.id}`).expect(200))).toEqual([]);
    expect((await ctx.http.get(`/v1/public/orgs/${org.slug}/products`).expect(200)).body.items).toEqual([]);
    expect((await ctx.http.get(`/v1/orgs/${org.id}/products/${p.id}`).set(bearer(owner.token)).expect(200)).body.hidden).toBe(true);
    await ctx.http.post('/v1/reports').set(bearer(buyer.token)).send({ targetType: 'product', targetId: p.id, reason: 'spam' }).expect(404);

    await ctx.http
      .post('/v1/admin/moderation/actions')
      .set(bearer(mod.token))
      .send({ targetType: 'product', targetId: p.id, action: 'restore' })
      .expect(200);
    await ctx.http.get(`/v1/products/${p.id}`).set(bearer(buyer.token)).expect(200);
  });

  it('answers 403 feature_disabled on connected routes when the commerce flag is off, but keeps the public storefront', async () => {
    const [owner, buyer] = [await user(), await user()];
    const org = await createOrg(owner);
    const p = await publishedProduct(owner, org.id);
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'commerce'`);
    try {
      await storefront(buyer).expect(403);
      await ctx.http.get(`/v1/products/${p.id}`).set(bearer(buyer.token)).expect(403);
      await create(owner, org.id).expect(403);
      await ctx.http.get('/v1/catalog/categories').set(bearer(buyer.token)).expect(403);
      await ctx.http.get(`/v1/public/orgs/${org.slug}/products`).expect(200);
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'commerce'`);
    }
  });
});

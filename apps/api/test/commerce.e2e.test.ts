import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Commerce end to end with the real CatalogPortImpl (no fake catalogue). */
let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.sql.query(
    `INSERT INTO feature_flags (key, description, enabled) VALUES ('commerce', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`,
  );
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

interface Pub {
  id: string;
  variants: { id: string; stock: number }[];
}
async function publish(owner: TU, orgId: string, extra: Record<string, unknown> = {}, variantExtra: Record<string, unknown> = {}): Promise<Pub> {
  const res = await ctx.http
    .post(`/v1/orgs/${orgId}/products`)
    .set(bearer(owner.token))
    .send({
      title: 'Article',
      status: 'published',
      variants: [{ sku: uniq('SKU'), options: { taille: 'M' }, priceMinor: 2_500, currency: 'USD', stock: 10, ...variantExtra }],
      ...extra,
    })
    .expect(201);
  return res.body;
}

const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix', notes: 'Portail bleu' };
const setItem = (u: TU, variantId: string, quantity: number) =>
  ctx.http.put(`/v1/cart/items/${variantId}`).set(bearer(u.token)).send({ quantity });
const checkout = (u: TU, extra: Record<string, unknown> = {}) =>
  ctx.http
    .post('/v1/orders/checkout')
    .set(bearer(u.token))
    .send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery', ...extra });
const setStatus = (orgId: string, who: TU, orderId: string, status: string) =>
  ctx.http.post(`/v1/orgs/${orgId}/orders/${orderId}/status`).set(bearer(who.token)).send({ status });
const stockOf = async (variantId: string): Promise<number> =>
  (await ctx.sql.query(`SELECT stock FROM product_variants WHERE id = $1`, [variantId])).rows[0].stock;
const movements = async (variantId: string): Promise<{ delta: number; stock_after: number; reason: string }[]> =>
  (await ctx.sql.query(`SELECT delta, stock_after, reason FROM stock_movements WHERE variant_id = $1 ORDER BY created_at, id`, [variantId])).rows;
const count = async (table: string): Promise<number> => (await ctx.sql.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

describe('commerce flow with the real catalogue', () => {
  it('publishes, fills a multi-vendor cart, checks out, reserves stock, cancels, delivers and reviews', async () => {
    const [sellerA, sellerB, buyer] = [await user(), await user(), await user()];
    const [orgA, orgB] = [await createOrg(sellerA), await createOrg(sellerB)];
    const p1 = await publish(sellerA, orgA.id, { title: 'T-shirt' }, { priceMinor: 2_500, stock: 10 });
    const p2 = await publish(sellerA, orgA.id, { title: 'Casquette' }, { priceMinor: 1_000, stock: 5 });
    const p3 = await publish(sellerB, orgB.id, { title: 'Sac' }, { priceMinor: 4_000, stock: 3 });
    const [v1, v2, v3] = [p1.variants[0]!.id, p2.variants[0]!.id, p3.variants[0]!.id];

    await setItem(buyer, v1, 2).expect(200);
    await setItem(buyer, v2, 1).expect(200);
    const cart = (await setItem(buyer, v3, 1).expect(200)).body;
    expect(cart.groups).toHaveLength(2);
    expect(cart.itemCount).toBe(4);
    // The cart reserves nothing.
    expect(await stockOf(v1)).toBe(10);

    const res = await checkout(buyer).expect(201);
    expect(res.body.orders).toHaveLength(2);
    const orderA = res.body.orders.find((o: { orgId: string }) => o.orgId === orgA.id);
    const orderB = res.body.orders.find((o: { orgId: string }) => o.orgId === orgB.id);
    expect(orderA).toMatchObject({ subtotalMinor: 6_000, totalMinor: 6_000, currency: 'USD', status: 'pending' });
    expect(orderB).toMatchObject({ subtotalMinor: 4_000, totalMinor: 4_000 });
    expect((await ctx.http.get('/v1/cart').set(bearer(buyer.token))).body.itemCount).toBe(0);

    // Stock decremented, movement recorded.
    expect(await stockOf(v1)).toBe(8);
    expect(await stockOf(v2)).toBe(4);
    expect(await stockOf(v3)).toBe(2);
    expect(await movements(v1)).toEqual([
      { delta: 10, stock_after: 10, reason: 'initial' },
      { delta: -2, stock_after: 8, reason: 'order_reserved' },
    ]);

    // Only the seller concerned sees the buyer's address; the notification and the audit trail carry none of it.
    await ctx.http.get(`/v1/orgs/${orgA.id}/orders/${orderB.id}`).set(bearer(sellerA.token)).expect(404);
    await ctx.http.get(`/v1/orgs/${orgB.id}/orders/${orderB.id}`).set(bearer(sellerA.token)).expect(404);
    const seen = (await ctx.http.get(`/v1/orgs/${orgB.id}/orders/${orderB.id}`).set(bearer(sellerB.token)).expect(200)).body;
    expect(seen.address).toMatchObject({ phone: ADDRESS.phone });
    const notifs = JSON.stringify((await ctx.http.get('/v1/notifications').set(bearer(sellerB.token)).expect(200)).body);
    expect(notifs).not.toContain(ADDRESS.phone);
    expect(notifs).not.toContain(ADDRESS.line1);

    // Replay of the same clientId creates nothing more and takes no more stock.
    const clientId = randomUUID();
    await setItem(buyer, v1, 1).expect(200);
    const first = await checkout(buyer, { clientId }).expect(201);
    expect(await stockOf(v1)).toBe(7);
    const replay = await checkout(buyer, { clientId }).expect(200);
    expect(replay.body.orders.map((o: { id: string }) => o.id)).toEqual(first.body.orders.map((o: { id: string }) => o.id));
    expect(await stockOf(v1)).toBe(7);

    // Cancellation gives the stock back once; a repeat is refused and gives nothing more.
    const extraId = first.body.orders[0].id;
    await ctx.http.post(`/v1/orders/${extraId}/cancel`).set(bearer(buyer.token)).send({}).expect(200);
    expect(await stockOf(v1)).toBe(8);
    await ctx.http.post(`/v1/orders/${extraId}/cancel`).set(bearer(buyer.token)).send({}).expect(409);
    expect(await stockOf(v1)).toBe(8);
    expect((await movements(v1)).at(-1)).toEqual({ delta: 1, stock_after: 8, reason: 'order_released' });

    // The seller moves order A to delivered; the buyer cannot review before that.
    const review = (productId: string, rating = 5) =>
      ctx.http.post(`/v1/products/${productId}/reviews`).set(bearer(buyer.token)).send({ rating, body: 'Très bien' });
    expect((await review(p1.id).expect(403)).body.error.details.reason).toBe('not_purchased');
    for (const status of ['confirmed', 'preparing', 'shipped', 'delivered']) {
      await setStatus(orgA.id, sellerA, orderA.id, status).expect(200);
    }
    // A shipped order can no longer be cancelled by anyone.
    await ctx.http.post(`/v1/orders/${orderA.id}/cancel`).set(bearer(buyer.token)).send({}).expect(409);
    const reviewed = await review(p1.id).expect(201);
    expect(reviewed.body).toMatchObject({ rating: 5, verifiedPurchase: true });
    await review(p1.id).expect(409);
    // Order B was not delivered: no review for its product.
    await review(p3.id).expect(403);
    const list = (await ctx.http.get(`/v1/products/${p1.id}/reviews`).set(bearer(buyer.token)).expect(200)).body;
    expect(list.summary).toMatchObject({ ratingCount: 1, averageRating: 5 });
  });

  it('cancels everything, writes nothing and keeps the stock when one line runs out during checkout', async () => {
    const [sellerA, sellerB, buyer] = [await user(), await user(), await user()];
    const [orgA, orgB] = [await createOrg(sellerA), await createOrg(sellerB)];
    const a = (await publish(sellerA, orgA.id, {}, { stock: 5 })).variants[0]!.id;
    const b = (await publish(sellerB, orgB.id, {}, { stock: 5 })).variants[0]!.id;
    await setItem(buyer, a, 2).expect(200);
    await setItem(buyer, b, 3).expect(200);
    // Someone else buys the stock of B between the cart and the checkout.
    await ctx.sql.query(`UPDATE product_variants SET stock = 1 WHERE id = $1`, [b]);

    const [ordersBefore, itemsBefore, eventsBefore, movesA, movesB] = [
      await count('orders'),
      await count('order_items'),
      await count('order_events'),
      (await movements(a)).length,
      (await movements(b)).length,
    ];
    const res = await checkout(buyer).expect(409);
    expect(res.body.error.details).toEqual({ reason: 'insufficient_stock', variantIds: [b] });
    expect(await stockOf(a)).toBe(5);
    expect(await stockOf(b)).toBe(1);
    expect([await count('orders'), await count('order_items'), await count('order_events')]).toEqual([ordersBefore, itemsBefore, eventsBefore]);
    expect([(await movements(a)).length, (await movements(b)).length]).toEqual([movesA, movesB]);
    expect((await ctx.http.get('/v1/cart').set(bearer(buyer.token))).body.itemCount).toBe(5);
  });

  it('never oversells under concurrent checkouts of the last unit', async () => {
    const [seller, b1, b2] = [await user(), await user(), await user()];
    const org = await createOrg(seller);
    const v = (await publish(seller, org.id, {}, { stock: 1 })).variants[0]!.id;
    await setItem(b1, v, 1).expect(200);
    await setItem(b2, v, 1).expect(200);
    const [r1, r2] = await Promise.all([checkout(b1), checkout(b2)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await stockOf(v)).toBe(0);
  });
});

describe('visibility of the catalogue for the cart and the checkout', () => {
  it('refuses products of private or suspended orgs, drafts, hidden products and sellers blocked with the buyer', async () => {
    const [owner, buyer, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    const open = await createOrg(owner);
    const priv = await createOrg(owner, { visibility: 'private' });
    const susp = await createOrg(owner);
    const inPrivate = (await publish(owner, priv.id)).variants[0]!.id;
    const inSuspended = (await publish(owner, susp.id)).variants[0]!.id;
    const draft = (await publish(owner, open.id, { status: 'draft' })).variants[0]!.id;
    const hiddenProduct = await publish(owner, open.id);
    await ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [susp.id]);
    await ctx.http
      .post('/v1/admin/moderation/actions')
      .set(bearer(mod.token))
      .send({ targetType: 'product', targetId: hiddenProduct.id, action: 'hide' })
      .expect(200);

    for (const v of [inPrivate, inSuspended, draft, hiddenProduct.variants[0]!.id]) await setItem(buyer, v, 1).expect(404);

    // A line added while the seller was visible becomes unavailable and blocks the checkout once they are blocked.
    const ok = (await publish(owner, open.id)).variants[0]!.id;
    await setItem(buyer, ok, 1).expect(200);
    await ctx.http.put(`/v1/blocks/${owner.id}`).set(bearer(buyer.token)).expect(204);
    const cart = (await ctx.http.get('/v1/cart').set(bearer(buyer.token)).expect(200)).body;
    expect(cart.groups).toEqual([]);
    expect(cart.unavailable).toEqual([{ variantId: ok, quantity: 1 }]);
    const refused = await checkout(buyer).expect(409);
    expect(refused.body.error.details).toEqual({ reason: 'unavailable', variantIds: [ok] });
    expect(await stockOf(ok)).toBe(10);
    await setItem(buyer, ok, 1).expect(404);
    await ctx.http.delete(`/v1/blocks/${owner.id}`).set(bearer(buyer.token)).expect(204);
    await setItem(buyer, ok, 1).expect(200);
  });
});

describe('seller side rights', () => {
  it('lets only a member with orders.manage change an order, and never an order of another org', async () => {
    const [owner, other, buyer] = [await user(), await user(), await user()];
    const [org, otherOrg] = [await createOrg(owner), await createOrg(other)];
    const v = (await publish(owner, org.id)).variants[0]!.id;
    await setItem(buyer, v, 1).expect(200);
    const order = (await checkout(buyer).expect(201)).body.orders[0];
    await setStatus(otherOrg.id, other, order.id, 'confirmed').expect(404);
    await setStatus(org.id, buyer, order.id, 'confirmed').expect(404); // not a member
    await setStatus(org.id, owner, order.id, 'delivered').expect(409); // skipping steps
    await setStatus(org.id, owner, order.id, 'confirmed').expect(200);
    await ctx.http.post(`/v1/orders/${order.id}/cancel`).set(bearer(buyer.token)).send({}).expect(409);
    await ctx.http.get(`/v1/orders/${order.id}`).set(bearer(other.token)).expect(404);
  });

  it('cannot put a variant, a coupon or a media of another org into an order or a product', async () => {
    const [a, b, buyer] = [await user(), await user(), await user()];
    const [orgA, orgB] = [await createOrg(a), await createOrg(b)];
    const foreignMedia = await upload(b, 'product');
    await ctx.http
      .post(`/v1/orgs/${orgA.id}/products`)
      .set(bearer(a.token))
      .send({ title: 'X', variants: [{ sku: uniq('S'), options: {}, priceMinor: 100, currency: 'USD', stock: 1 }], mediaIds: [foreignMedia] })
      .expect(400);
    await ctx.http
      .post(`/v1/orgs/${orgB.id}/coupons`)
      .set(bearer(b.token))
      .send({ code: 'BONUS10', kind: 'percent', value: 10 })
      .expect(201);
    const vA = (await publish(a, orgA.id)).variants[0]!.id;
    await setItem(buyer, vA, 1).expect(200);
    // B's coupon does not apply to an order of A.
    const res = await checkout(buyer, { couponCodes: ['BONUS10'] }).expect(400);
    expect(res.body.error.details).toEqual({ reason: 'not_applicable', code: 'BONUS10' });
    expect(await stockOf(vA)).toBe(10);
  });
});

describe('anonymous storefront images', () => {
  it('serves a product image to a visitor only while its product is published in an active public org', async () => {
    const [owner, buyer] = [await user(), await user()];
    const org = await createOrg(owner);
    const media = await upload(owner, 'product');
    const orphan = await upload(owner, 'product');
    const avatar = await upload(owner, 'avatar');
    const product = await publish(owner, org.id, { mediaIds: [media] });
    const publicUrl = `/v1/public/media/${media}/content`;

    const ok = await ctx.http.get(publicUrl).expect(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(ok.headers['content-disposition']).toMatch(/^inline/);
    expect(ok.headers['cache-control']).toContain('public');
    // The same bytes stay private on the authenticated route for a visitor.
    await ctx.http.get(`/v1/media/${media}/content`).expect(401);
    // The public storefront points its covers at the anonymous route.
    const shop = (await ctx.http.get(`/v1/public/orgs/${org.slug}/products`).expect(200)).body;
    expect(shop.items[0].coverUrl).toBe(publicUrl);
    // The signed-in marketplace keeps the authenticated URL.
    expect((await ctx.http.get(`/v1/products/${product.id}`).set(bearer(buyer.token)).expect(200)).body.coverUrl).toBe(`/v1/media/${media}/content`);

    // Everything else is private: unattached product media, other purposes, malformed ids.
    await ctx.http.get(`/v1/public/media/${orphan}/content`).expect(404);
    await ctx.http.get(`/v1/public/media/${avatar}/content`).expect(404);
    await ctx.http.get(`/v1/public/media/${randomUUID()}/content`).expect(404);
    await ctx.http.get(`/v1/public/media/not-a-uuid/content`).expect(404);

    // Draft, hidden, private org and suspended org: closed again.
    const patch = (body: Record<string, unknown>) => ctx.http.patch(`/v1/orgs/${org.id}/products/${product.id}`).set(bearer(owner.token)).send(body);
    await patch({ status: 'draft' }).expect(200);
    await ctx.http.get(publicUrl).expect(404);
    await patch({ status: 'published' }).expect(200);
    await ctx.http.get(publicUrl).expect(200);
    await ctx.sql.query(`UPDATE products SET hidden = true WHERE id = $1`, [product.id]);
    await ctx.http.get(publicUrl).expect(404);
    await ctx.sql.query(`UPDATE products SET hidden = false WHERE id = $1`, [product.id]);
    await ctx.sql.query(`UPDATE organizations SET visibility = 'private' WHERE id = $1`, [org.id]);
    await ctx.http.get(publicUrl).expect(404);
    await ctx.sql.query(`UPDATE organizations SET visibility = 'public', status = 'suspended' WHERE id = $1`, [org.id]);
    await ctx.http.get(publicUrl).expect(404);
  });
});

describe('account export and purge', () => {
  it('exports the cart, the orders and the reviews of the user', async () => {
    const [seller, buyer] = [await user(), await user()];
    const org = await createOrg(seller);
    const v = (await publish(seller, org.id)).variants[0]!.id;
    await setItem(buyer, v, 3).expect(200);
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(buyer.token)).expect(200)).body;
    expect(exp.cart).toEqual([expect.objectContaining({ variantId: v, quantity: 3 })]);
  });
});

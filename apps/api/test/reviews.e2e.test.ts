import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeCatalog, installFakeCatalog } from './fake-catalog.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
const fake = new FakeCatalog();

beforeAll(async () => {
  ctx = await createTestContext();
  installFakeCatalog(ctx, fake);
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

let slugCounter = 0;
async function shop() {
  const owner = await user();
  slugCounter += 1;
  const org = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug: `rev-${Date.now().toString(36)}-${slugCounter}`, name: 'Boutique Avis', kind: 'shop' })
    .expect(201);
  const orgId: string = org.body.id;
  const variant = fake.add({ orgId, currency: 'CDF', price: 5_000, stock: 100 });
  const productId = fake.variants.get(variant)!.productId;
  return { owner, orgId, variant, productId };
}

const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix' };

/** Buys the variant and walks the order up to `until`. */
async function buy(s: Awaited<ReturnType<typeof shop>>, buyer: TU, until: 'pending' | 'delivered' = 'delivered'): Promise<string> {
  await ctx.http.put(`/v1/cart/items/${s.variant}`).set(bearer(buyer.token)).send({ quantity: 1 }).expect(200);
  const res = await ctx.http
    .post('/v1/orders/checkout')
    .set(bearer(buyer.token))
    .send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery' })
    .expect(201);
  const orderId: string = res.body.orders[0].id;
  if (until === 'delivered') {
    for (const status of ['confirmed', 'preparing', 'shipped', 'delivered']) {
      await ctx.http.post(`/v1/orgs/${s.orgId}/orders/${orderId}/status`).set(bearer(s.owner.token)).send({ status }).expect(200);
    }
  }
  return orderId;
}

const review = (u: TU, productId: string, body: Record<string, unknown> = { rating: 5 }) =>
  ctx.http.post(`/v1/products/${productId}/reviews`).set(bearer(u.token)).send(body);
const reviewsOf = (u: TU, productId: string, qs = '') => ctx.http.get(`/v1/products/${productId}/reviews${qs}`).set(bearer(u.token));

describe('verified reviews', () => {
  it('refuses a review without a delivered order, accepts it once delivered', async () => {
    const s = await shop();
    const buyer = await user();
    const stranger = await user();

    const none = await review(buyer, s.productId);
    expect(none.status).toBe(403);
    expect(none.body.error.details.reason).toBe('not_purchased');
    await buy(s, buyer, 'pending');
    await review(buyer, s.productId).expect(403); // ordered, not delivered yet
    const orderId = (await ctx.sql.query(`SELECT id FROM orders WHERE buyer_id = $1`, [buyer.id])).rows[0].id;
    for (const status of ['confirmed', 'preparing', 'shipped']) {
      await ctx.http.post(`/v1/orgs/${s.orgId}/orders/${orderId}/status`).set(bearer(s.owner.token)).send({ status }).expect(200);
    }
    await review(buyer, s.productId).expect(403); // shipped is not delivered
    await ctx.http.post(`/v1/orgs/${s.orgId}/orders/${orderId}/status`).set(bearer(s.owner.token)).send({ status: 'delivered' }).expect(200);

    const created = await review(buyer, s.productId, { rating: 4, body: '  Très bien  ' }).expect(201);
    expect(created.body).toMatchObject({ productId: s.productId, rating: 4, body: 'Très bien', verifiedPurchase: true, reply: null, author: { userId: buyer.id } });
    await review(stranger, s.productId).expect(403);
  });

  it('refuses a cancelled order and validates the input and the product', async () => {
    const s = await shop();
    const buyer = await user();
    const orderId = await buy(s, buyer, 'pending');
    await ctx.http.post(`/v1/orders/${orderId}/cancel`).set(bearer(buyer.token)).send({}).expect(200);
    await review(buyer, s.productId).expect(403);

    await review(buyer, randomUUID()).expect(404);
    await review(buyer, 'nope').expect(404);
    await review(buyer, s.productId, { rating: 0 }).expect(400);
    await review(buyer, s.productId, { rating: 6 }).expect(400);
    await review(buyer, s.productId, { rating: 3.5 }).expect(400);
    await review(buyer, s.productId, { rating: 5, body: 'x'.repeat(2001) }).expect(400);
    await ctx.http.post(`/v1/products/${s.productId}/reviews`).send({ rating: 5 }).expect(401);
  });

  it('allows one review per user and product, editable and deletable by its author only', async () => {
    const s = await shop();
    const buyer = await user();
    const other = await user();
    await buy(s, buyer);
    await buy(s, other);
    const created = await review(buyer, s.productId, { rating: 2, body: 'Moyen' }).expect(201);
    const dup = await review(buyer, s.productId, { rating: 5 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.reason).toBe('already_reviewed');

    const id = created.body.id;
    const edited = await ctx.http.patch(`/v1/reviews/${id}`).set(bearer(buyer.token)).send({ rating: 5, body: 'Finalement super' }).expect(200);
    expect(edited.body).toMatchObject({ rating: 5, body: 'Finalement super' });
    const cleared = await ctx.http.patch(`/v1/reviews/${id}`).set(bearer(buyer.token)).send({ body: null }).expect(200);
    expect(cleared.body).toMatchObject({ rating: 5, body: null });
    await ctx.http.patch(`/v1/reviews/${id}`).set(bearer(buyer.token)).send({}).expect(400);
    await ctx.http.patch(`/v1/reviews/${id}`).set(bearer(other.token)).send({ rating: 1 }).expect(403);
    await ctx.http.delete(`/v1/reviews/${id}`).set(bearer(other.token)).expect(403);
    await ctx.http.patch(`/v1/reviews/${randomUUID()}`).set(bearer(buyer.token)).send({ rating: 1 }).expect(404);

    await ctx.http.delete(`/v1/reviews/${id}`).set(bearer(buyer.token)).expect(204);
    expect((await reviewsOf(buyer, s.productId)).body.items).toHaveLength(0);
    await review(buyer, s.productId, { rating: 3 }).expect(201); // can review again after deleting
  });

  it('lists newest first with the average and the distribution, paginated', async () => {
    const s = await shop();
    const empty = await reviewsOf(await user(), s.productId).expect(200);
    expect(empty.body.summary).toEqual({ ratingCount: 0, averageRating: null, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } });

    const ratings = [5, 4, 4, 1];
    const ids: string[] = [];
    for (const rating of ratings) {
      const b = await user();
      await buy(s, b);
      ids.push((await review(b, s.productId, { rating, body: `note ${rating}` }).expect(201)).body.id);
    }
    const viewer = await user();
    const all = await reviewsOf(viewer, s.productId).expect(200);
    expect(all.body.items.map((r: any) => r.id)).toEqual([...ids].reverse());
    expect(all.body.summary).toEqual({ ratingCount: 4, averageRating: 3.5, distribution: { '1': 1, '2': 0, '3': 0, '4': 2, '5': 1 } });

    const p1 = await reviewsOf(viewer, s.productId, '?limit=3').expect(200);
    expect(p1.body.items).toHaveLength(3);
    const p2 = await reviewsOf(viewer, s.productId, `?limit=3&cursor=${encodeURIComponent(p1.body.nextCursor)}`).expect(200);
    expect(p2.body.items.map((r: any) => r.id)).toEqual([ids[0]]);
    expect(p2.body.nextCursor).toBeNull();
    await reviewsOf(viewer, s.productId, '?cursor=garbage').expect(400);
    await reviewsOf(viewer, randomUUID()).expect(404);
  });

  it('lets the seller reply (orders.manage of the owning org only)', async () => {
    const s = await shop();
    const other = await shop();
    const buyer = await user();
    const employee = await user();
    await buy(s, buyer);
    const created = await review(buyer, s.productId, { rating: 3, body: 'Livraison lente' }).expect(201);
    const url = (orgId: string) => `/v1/orgs/${orgId}/reviews/${created.body.id}/reply`;

    await ctx.http.post(url(s.orgId)).set(bearer(buyer.token)).send({ body: 'moi' }).expect(404); // not a member
    await ctx.http.post(`/v1/orgs/${s.orgId}/invitations`).set(bearer(s.owner.token)).send({ handle: employee.handle, role: 'employee' }).expect(201);
    await ctx.http.post(`/v1/me/org-invitations/${s.orgId}/accept`).set(bearer(employee.token)).expect(200);
    await ctx.http.post(url(s.orgId)).set(bearer(employee.token)).send({ body: 'Merci' }).expect(403);
    await ctx.http.post(url(other.orgId)).set(bearer(other.owner.token)).send({ body: 'Merci' }).expect(404); // not their product
    await ctx.http.post(url(s.orgId)).set(bearer(s.owner.token)).send({ body: '' }).expect(400);

    const replied = await ctx.http.post(url(s.orgId)).set(bearer(s.owner.token)).send({ body: 'Désolé, nous allons nous améliorer' }).expect(200);
    expect(replied.body.reply).toMatchObject({ body: 'Désolé, nous allons nous améliorer' });
    const listed = await reviewsOf(buyer, s.productId).expect(200);
    expect(listed.body.items[0].reply.body).toBe('Désolé, nous allons nous améliorer');
    const notes = await ctx.http.get('/v1/notifications').set(bearer(buyer.token)).expect(200);
    expect(notes.body.items.some((n: any) => n.category === 'commerce' && n.data.reviewId === created.body.id)).toBe(true);
    await ctx.http.post(url(s.orgId)).set(bearer(s.owner.token)).send({ body: 'Mise à jour' }).expect(200);
    expect((await reviewsOf(buyer, s.productId)).body.items[0].reply.body).toBe('Mise à jour');
  });

  it('lists the reviews of the whole organisation with the product, filtered by reply status', async () => {
    const s = await shop();
    const other = await shop();
    const [b1, b2, outsider, employee, support] = [await user(), await user(), await user(), await user(), await user()];
    for (const [u, role] of [[employee, 'employee'], [support, 'support']] as const) {
      await ctx.http.post(`/v1/orgs/${s.orgId}/invitations`).set(bearer(s.owner.token)).send({ handle: u.handle, role }).expect(201);
      await ctx.http.post(`/v1/me/org-invitations/${s.orgId}/accept`).set(bearer(u.token)).expect(200);
    }
    await buy(s, b1);
    await buy(s, b2);
    await buy(other, b1);
    const r1 = (await review(b1, s.productId, { rating: 4, body: 'Bien' }).expect(201)).body;
    const r2 = (await review(b2, s.productId, { rating: 2 }).expect(201)).body;
    await review(b1, other.productId, { rating: 5 }).expect(201);

    const url = `/v1/orgs/${s.orgId}/reviews`;
    const all = await ctx.http.get(url).set(bearer(s.owner.token)).expect(200);
    expect(all.body.items.map((r: any) => r.id)).toEqual([r2.id, r1.id]);
    expect(all.body.items[0].product).toMatchObject({ id: s.productId, imageAssetId: null });
    expect(typeof all.body.items[0].product.title).toBe('string');
    expect(all.body.items[0].author.userId).toBe(b2.id);

    await ctx.http.post(`${url}/${r2.id}/reply`).set(bearer(s.owner.token)).send({ body: 'Merci' }).expect(200);
    const open = await ctx.http.get(`${url}?status=unanswered`).set(bearer(s.owner.token)).expect(200);
    expect(open.body.items.map((r: any) => r.id)).toEqual([r1.id]);
    const page = await ctx.http.get(`${url}?limit=1`).set(bearer(s.owner.token)).expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.nextCursor).toEqual(expect.any(String));
    const next = await ctx.http.get(`${url}?limit=1&cursor=${page.body.nextCursor}`).set(bearer(s.owner.token)).expect(200);
    expect(next.body.items[0].id).toBe(r1.id);
    expect(next.body.nextCursor).toBeNull();

    await ctx.http.get(`${url}?status=nope`).set(bearer(s.owner.token)).expect(400);
    await ctx.http.get(url).set(bearer(support.token)).expect(200); // orders.view
    await ctx.http.get(url).set(bearer(employee.token)).expect(403);
    await ctx.http.get(url).set(bearer(outsider.token)).expect(404);
  });

  it('hides a review through moderation for everyone but its author, excluding it from the average', async () => {
    const s = await shop();
    const author = await user();
    const reader = await user();
    const moderator = await user(['moderator']);
    await buy(s, author);
    const created = await review(author, s.productId, { rating: 1, body: 'Contenu abusif' }).expect(201);
    const id = created.body.id;

    const filed = await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'review', targetId: id, reason: 'harassment' });
    expect(filed.status).toBe(201);
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'review', targetId: randomUUID(), reason: 'spam' }).expect(404);
    await ctx.http
      .post('/v1/admin/moderation/actions')
      .set(bearer(moderator.token))
      .send({ targetType: 'review', targetId: id, action: 'hide' })
      .expect(200);

    const asReader = (await reviewsOf(reader, s.productId).expect(200)).body;
    expect(asReader.items).toHaveLength(0);
    expect(asReader.summary.ratingCount).toBe(0);
    const asAuthor = (await reviewsOf(author, s.productId).expect(200)).body;
    expect(asAuthor.items).toHaveLength(1);
    expect(asAuthor.summary.ratingCount).toBe(0);
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'review', targetId: id, reason: 'spam' }).expect(404);
    // The seller cannot answer (nor notify the author about) a review hidden by moderation.
    await ctx.http
      .post(`/v1/orgs/${s.orgId}/reviews/${id}/reply`)
      .set(bearer(s.owner.token))
      .send({ body: 'Merci de votre retour' })
      .expect(404);

    await ctx.http
      .post('/v1/admin/moderation/actions')
      .set(bearer(moderator.token))
      .send({ targetType: 'review', targetId: id, action: 'restore' })
      .expect(200);
    const back = (await reviewsOf(reader, s.productId).expect(200)).body;
    expect(back.items).toHaveLength(1);
    expect(back.summary).toMatchObject({ ratingCount: 1, averageRating: 1 });
  });
});

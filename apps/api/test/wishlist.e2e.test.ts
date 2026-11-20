import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, bearer, createTestContext, signUp, type TestContext } from './helpers.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';

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
}
async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query(`UPDATE users SET roles = $1 WHERE id = $2`, [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id };
}

let n = 0;
const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;
async function createOrg(owner: TU): Promise<string> {
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: uniq('shop'), name: 'Boutique', kind: 'shop' }).expect(201);
  return res.body.id;
}
async function publish(owner: TU, orgId: string, title = 'Article'): Promise<{ id: string; variants: { id: string }[] }> {
  const res = await ctx.http
    .post(`/v1/orgs/${orgId}/products`)
    .set(bearer(owner.token))
    .send({ title, status: 'published', variants: [{ sku: uniq('SKU'), options: {}, priceMinor: 10_000, currency: 'USD', stock: 5 }] })
    .expect(201);
  return res.body;
}
const wish = (u: TU, productId: string) => ctx.http.put(`/v1/me/wishlist/${productId}`).set(bearer(u.token));
const unwish = (u: TU, productId: string) => ctx.http.delete(`/v1/me/wishlist/${productId}`).set(bearer(u.token));
const list = async (u: TU, query = '') => (await ctx.http.get(`/v1/me/wishlist${query}`).set(bearer(u.token)).expect(200)).body;
const count = async (userId: string): Promise<number> => (await ctx.sql.query(`SELECT count(*)::int AS n FROM wishlist_items WHERE user_id = $1`, [userId])).rows[0].n;

describe('wishlist', () => {
  it('adds and removes idempotently, lists newest first with the effective price and the wished flag', async () => {
    const [owner, buyer] = [await user(), await user()];
    const orgId = await createOrg(owner);
    const [a, b] = [await publish(owner, orgId, 'A'), await publish(owner, orgId, 'B')];
    await wish(buyer, a.id).expect(204);
    await wish(buyer, a.id).expect(204);
    await wish(buyer, b.id).expect(204);
    expect(await count(buyer.id)).toBe(2);
    expect((await ctx.http.get(`/v1/products/${a.id}`).set(bearer(buyer.token)).expect(200)).body.wished).toBe(true);
    expect((await ctx.http.get(`/v1/products/${a.id}`).set(bearer(owner.token)).expect(200)).body.wished).toBe(false);

    await ctx.http
      .post(`/v1/orgs/${orgId}/promotions`)
      .set(bearer(owner.token))
      .send({ productId: a.id, kind: 'percent', value: 25, label: 'Soldes', endsAt: new Date(Date.now() + 86_400_000).toISOString() })
      .expect(201);
    const page = await list(buyer);
    expect(page.items.map((i: { productId: string }) => i.productId)).toEqual([b.id, a.id]);
    expect(page.items[1]).toMatchObject({ available: true, product: { title: 'A', minPriceMinor: 7_500, compareAtPriceMinor: 10_000, promotion: { label: 'Soldes' } } });

    // Cursor pagination.
    const first = await list(buyer, '?limit=1');
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await list(buyer, `?limit=1&cursor=${first.nextCursor}`);
    expect(second.items[0].productId).toBe(a.id);
    expect(second.nextCursor).toBeNull();

    await unwish(buyer, a.id).expect(204);
    await unwish(buyer, a.id).expect(204);
    expect((await list(buyer)).items.map((i: { productId: string }) => i.productId)).toEqual([b.id]);
    // Wishlists are private.
    expect((await list(owner)).items).toEqual([]);
  });

  it('refuses a product the user cannot see (404) and keeps a product that became invisible, without its details', async () => {
    const [owner, buyer, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    const orgId = await createOrg(owner);
    const draft = await publish(owner, orgId);
    await ctx.sql.query(`UPDATE products SET status = 'draft' WHERE id = $1`, [draft.id]);
    await wish(buyer, draft.id).expect(404);
    await wish(buyer, '00000000-0000-4000-8000-000000000000').expect(404);
    await wish(buyer, 'not-a-uuid').expect(404);
    expect(await count(buyer.id)).toBe(0);

    const p = await publish(owner, orgId, 'Secret');
    await wish(buyer, p.id).expect(204);
    await ctx.http.post('/v1/admin/moderation/actions').set(bearer(mod.token)).send({ targetType: 'product', targetId: p.id, action: 'hide' }).expect(200);
    const page = await list(buyer);
    expect(page.items).toEqual([{ productId: p.id, addedAt: expect.any(String), available: false, product: null }]);
    await wish(buyer, p.id).expect(404); // no longer visible: cannot be (re)added
    await unwish(buyer, p.id).expect(204);
    expect(await count(buyer.id)).toBe(0);
  });

  it('caps the wishlist at 200 products', async () => {
    const [owner, buyer] = [await user(), await user()];
    const orgId = await createOrg(owner);
    const extra = await publish(owner, orgId, 'Surplus');
    // 200 rows straight in SQL (200 published products would be slow); the 201st goes through the API.
    await ctx.sql.query(
      `INSERT INTO products (org_id, title, status)
       SELECT $1, 'P' || g, 'published' FROM generate_series(1, 200) g`,
      [orgId],
    );
    await ctx.sql.query(
      `INSERT INTO wishlist_items (user_id, product_id) SELECT $1, id FROM products WHERE org_id = $2 AND title <> 'Surplus'`,
      [buyer.id, orgId],
    );
    expect(await count(buyer.id)).toBe(200);
    const res = await wish(buyer, extra.id).expect(409);
    expect(res.body.error.details).toMatchObject({ reason: 'wishlist_full' });
    // Re-adding one already there is still fine, and room reappears after a removal.
    const there = (await ctx.sql.query(`SELECT product_id FROM wishlist_items WHERE user_id = $1 LIMIT 1`, [buyer.id])).rows[0].product_id;
    await ctx.sql.query(`UPDATE products SET status = 'published' WHERE id = $1`, [there]);
    await wish(buyer, there).expect(204);
    await unwish(buyer, there).expect(204);
    await wish(buyer, extra.id).expect(204);
    expect(await count(buyer.id)).toBe(200);
  });

  it('is part of the account export and purged with the account', async () => {
    const [owner, buyer] = [await user(), await user()];
    const orgId = await createOrg(owner);
    const p = await publish(owner, orgId);
    await wish(buyer, p.id).expect(204);
    const exported = (await ctx.http.get('/v1/me/export').set(bearer(buyer.token)).expect(200)).body;
    expect(exported.wishlist).toEqual([{ productId: p.id, addedAt: expect.any(String) }]);

    await ctx.http.post('/v1/me/deletion-request').set(bearer(buyer.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [buyer.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect(await count(buyer.id)).toBe(0);
  });
});

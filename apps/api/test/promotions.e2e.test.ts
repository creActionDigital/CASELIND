import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Promotions, flash sales and effective prices with the real catalogue (no fake). */
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
const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

async function createOrg(owner: TU): Promise<string> {
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: uniq('shop'), name: 'Boutique', kind: 'shop' }).expect(201);
  return res.body.id;
}

interface Pub {
  id: string;
  variants: { id: string }[];
}
async function publish(owner: TU, orgId: string, extra: Record<string, unknown> = {}, priceMinor = 10_000): Promise<Pub> {
  const res = await ctx.http
    .post(`/v1/orgs/${orgId}/products`)
    .set(bearer(owner.token))
    .send({ title: 'Article', status: 'published', variants: [{ sku: uniq('SKU'), options: { taille: 'M' }, priceMinor, currency: 'USD', stock: 50 }], ...extra })
    .expect(201);
  return res.body;
}

const promote = (orgId: string, who: TU, body: Record<string, unknown>) => ctx.http.post(`/v1/orgs/${orgId}/promotions`).set(bearer(who.token)).send(body);
const detail = async (who: TU, productId: string) => (await ctx.http.get(`/v1/products/${productId}`).set(bearer(who.token)).expect(200)).body;
const setItem = (u: TU, variantId: string, quantity: number, extra: Record<string, unknown> = {}) =>
  ctx.http.put(`/v1/cart/items/${variantId}`).set(bearer(u.token)).send({ quantity, ...extra });
const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix', notes: 'Portail bleu' };
const checkout = (u: TU, extra: Record<string, unknown> = {}) =>
  ctx.http.post('/v1/orders/checkout').set(bearer(u.token)).send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery', ...extra });
const soldOf = async (id: string): Promise<number> => (await ctx.sql.query(`SELECT sold_count FROM product_promotions WHERE id = $1`, [id])).rows[0].sold_count;
/** Ages a promotion by SQL: it started and ended in the past. */
const expire = (id: string) =>
  ctx.sql.query(`UPDATE product_promotions SET starts_at = now() - interval '3 days', ends_at = now() - interval '1 day' WHERE id = $1`, [id]);

describe('effective price', () => {
  it('applies a percent promotion: card, detail, cart, order and sold counter, coupon after the promotion', async () => {
    const [owner, buyer] = [await user(), await user()];
    const orgId = await createOrg(owner);
    const p = await publish(owner, orgId);
    const v = p.variants[0]!.id;
    const promo = (await promote(orgId, owner, { productId: p.id, kind: 'percent', value: 20, label: 'Soldes', endsAt: inHours(48) }).expect(201)).body;
    expect(promo).toMatchObject({ kind: 'percent', value: 20, label: 'Soldes', status: 'active', soldCount: 0, variantId: null });

    const d = await detail(buyer, p.id);
    expect(d).toMatchObject({ minPriceMinor: 8_000, compareAtPriceMinor: 10_000, promotion: { label: 'Soldes', kind: 'percent' } });
    expect(d.variants[0]).toMatchObject({ priceMinor: 8_000, compareAtPriceMinor: 10_000 });
    const search = (await ctx.http.get(`/v1/products?orgId=${orgId}`).set(bearer(buyer.token)).expect(200)).body;
    expect(search.items[0]).toMatchObject({ minPriceMinor: 8_000, compareAtPriceMinor: 10_000 });
    // The price filter works on the effective price.
    expect((await ctx.http.get(`/v1/products?orgId=${orgId}&maxPrice=8000`).set(bearer(buyer.token)).expect(200)).body.items).toHaveLength(1);
    expect((await ctx.http.get(`/v1/products?orgId=${orgId}&minPrice=9000`).set(bearer(buyer.token)).expect(200)).body.items).toHaveLength(0);

    // The client never imposes a price: an extra field is ignored (or refused), the cart is priced by the server.
    const res = await setItem(buyer, v, 2, { unitPriceMinor: 1, priceMinor: 1 });
    if (res.status === 200) {
      expect(res.body.groups[0].lines[0]).toMatchObject({ unitPriceMinor: 8_000, compareAtPriceMinor: 10_000, lineTotalMinor: 16_000 });
    } else {
      expect(res.status).toBe(400);
      await setItem(buyer, v, 2).expect(200);
    }
    await ctx.http.post(`/v1/orgs/${orgId}/coupons`).set(bearer(owner.token)).send({ code: 'EXTRA10', kind: 'percent', value: 10 }).expect(201);
    const order = (await checkout(buyer, { couponCodes: ['EXTRA10'] }).expect(201)).body.orders[0];
    // 2 x 8000 = 16000, the 10% coupon applies to the promotional subtotal: 1600.
    expect(order).toMatchObject({ subtotalMinor: 16_000, discountMinor: 1_600, totalMinor: 14_400 });
    expect(order.items[0]).toMatchObject({ unitPriceMinor: 8_000, lineTotalMinor: 16_000 });
    expect(await soldOf(promo.id)).toBe(2);

    // The price is frozen in the order: ending the promotion afterwards changes nothing.
    await ctx.http.delete(`/v1/orgs/${orgId}/promotions/${promo.id}`).set(bearer(owner.token)).expect(204);
    const seen = (await ctx.http.get(`/v1/orders/${order.id}`).set(bearer(buyer.token)).expect(200)).body;
    expect(seen.items[0].unitPriceMinor).toBe(8_000);
    expect((await detail(buyer, p.id)).minPriceMinor).toBe(10_000);
  });

  it('applies a fixed price to one variant only and refuses a fixed price not below the current price', async () => {
    const [owner, buyer] = [await user(), await user()];
    const orgId = await createOrg(owner);
    const p = await publish(owner, orgId);
    const v = p.variants[0]!.id;
    await promote(orgId, owner, { productId: p.id, variantId: v, kind: 'fixed_price', value: 10_000, label: 'X', endsAt: inHours(5) }).expect(400);
    await promote(orgId, owner, { productId: p.id, variantId: v, kind: 'fixed_price', value: 12_000, label: 'X', endsAt: inHours(5) }).expect(400);
    await promote(orgId, owner, { productId: p.id, variantId: v, kind: 'fixed_price', value: 7_500, label: 'Vente flash', endsAt: inHours(5) }).expect(201);
    const d = await detail(buyer, p.id);
    expect(d.variants[0]).toMatchObject({ priceMinor: 7_500, compareAtPriceMinor: 10_000, promotion: { label: 'Vente flash', kind: 'fixed_price' } });
    expect((await setItem(buyer, v, 1).expect(200)).body.groups[0].lines[0].unitPriceMinor).toBe(7_500);
  });

  it('never applies an expired, stopped or scheduled promotion', async () => {
    const [owner, buyer] = [await user(), await user()];
    const orgId = await createOrg(owner);
    const p = await publish(owner, orgId);
    const v = p.variants[0]!.id;
    const promo = (await promote(orgId, owner, { productId: p.id, kind: 'percent', value: 50, label: 'Moitié', endsAt: inHours(2) }).expect(201)).body;
    await setItem(buyer, v, 1).expect(200);
    expect((await detail(buyer, p.id)).minPriceMinor).toBe(5_000);

    await expire(promo.id);
    expect((await detail(buyer, p.id)).minPriceMinor).toBe(10_000);
    expect((await ctx.http.get('/v1/cart').set(bearer(buyer.token))).body.groups[0].lines[0].unitPriceMinor).toBe(10_000);
    expect((await checkout(buyer).expect(201)).body.orders[0].subtotalMinor).toBe(10_000);
    const listed = (await ctx.http.get(`/v1/orgs/${orgId}/promotions?status=ended`).set(bearer(owner.token)).expect(200)).body;
    expect(listed.items.map((i: { id: string }) => i.id)).toEqual([promo.id]);
    await ctx.http.patch(`/v1/orgs/${orgId}/promotions/${promo.id}`).set(bearer(owner.token)).send({ label: 'Encore' }).expect(200);

    // Scheduled (starts tomorrow): not applied yet. Stopped: not applied, cannot be edited any more.
    const later = (await promote(orgId, owner, { productId: p.id, kind: 'percent', value: 30, label: 'Demain', startsAt: inHours(24), endsAt: inHours(48) }).expect(201)).body;
    expect(later.status).toBe('scheduled');
    expect((await detail(buyer, p.id)).minPriceMinor).toBe(10_000);
    await ctx.http.delete(`/v1/orgs/${orgId}/promotions/${later.id}`).set(bearer(owner.token)).expect(204);
    const now = (await promote(orgId, owner, { productId: p.id, kind: 'percent', value: 30, label: 'Maintenant', endsAt: inHours(3) }).expect(201)).body;
    expect((await detail(buyer, p.id)).minPriceMinor).toBe(7_000);
    const stopped = (await ctx.http.patch(`/v1/orgs/${orgId}/promotions/${now.id}`).set(bearer(owner.token)).send({ active: false }).expect(200)).body;
    expect(stopped).toMatchObject({ active: false, status: 'stopped' });
    expect((await detail(buyer, p.id)).minPriceMinor).toBe(10_000);
    const again = await ctx.http.patch(`/v1/orgs/${orgId}/promotions/${now.id}`).set(bearer(owner.token)).send({ label: 'Reviens' }).expect(409);
    expect(again.body.error.details).toMatchObject({ reason: 'promotion_stopped' });
  });

  it('respects the stock cap: beyond it the base price applies, never an error', async () => {
    const [owner, b1, b2, b3] = [await user(), await user(), await user(), await user()];
    const orgId = await createOrg(owner);
    const p = await publish(owner, orgId);
    const v = p.variants[0]!.id;
    const promo = (await promote(orgId, owner, { productId: p.id, kind: 'percent', value: 10, label: 'Flash', endsAt: inHours(10), stockCap: 3 }).expect(201)).body;

    await setItem(b1, v, 2).expect(200);
    expect((await checkout(b1).expect(201)).body.orders[0].subtotalMinor).toBe(18_000);
    expect(await soldOf(promo.id)).toBe(2);

    // 2 more units would pass the cap of 3: the whole line is at the base price, the counter stays.
    await setItem(b2, v, 2).expect(200);
    expect((await ctx.http.get('/v1/cart').set(bearer(b2.token))).body.groups[0].lines[0]).toMatchObject({ unitPriceMinor: 10_000, compareAtPriceMinor: null });
    expect((await checkout(b2).expect(201)).body.orders[0].subtotalMinor).toBe(20_000);
    expect(await soldOf(promo.id)).toBe(2);

    // The last unit still gets the promotional price, then the promotion is exhausted.
    await setItem(b3, v, 1).expect(200);
    expect((await checkout(b3).expect(201)).body.orders[0].subtotalMinor).toBe(9_000);
    expect(await soldOf(promo.id)).toBe(3);
    expect((await detail(b3, p.id)).minPriceMinor).toBe(10_000);
    const listed = (await ctx.http.get(`/v1/orgs/${orgId}/promotions`).set(bearer(owner.token)).expect(200)).body;
    expect(listed.items[0]).toMatchObject({ status: 'exhausted', soldCount: 3, stockCap: 3 });
  });

  it('gives the promotional units back when the order is cancelled (cap reopened, never below 0)', async () => {
    const [owner, buyer] = [await user(), await user()];
    const orgId = await createOrg(owner);
    const p = await publish(owner, orgId);
    const v = p.variants[0]!.id;
    const promo = (await promote(orgId, owner, { productId: p.id, kind: 'percent', value: 10, label: 'Flash', endsAt: inHours(10), stockCap: 2 }).expect(201)).body;
    await setItem(buyer, v, 2).expect(200);
    const order = (await checkout(buyer).expect(201)).body.orders[0];
    expect(await soldOf(promo.id)).toBe(2);
    expect((await ctx.sql.query(`SELECT promotion_id, promo_units FROM order_items WHERE order_id = $1`, [order.id])).rows[0]).toMatchObject({ promotion_id: promo.id, promo_units: 2 });
    await ctx.http.post(`/v1/orders/${order.id}/cancel`).set(bearer(buyer.token)).send({}).expect(200);
    expect(await soldOf(promo.id)).toBe(0);
    await ctx.http.post(`/v1/orders/${order.id}/cancel`).set(bearer(buyer.token)).send({}).expect(409);
    expect(await soldOf(promo.id)).toBe(0);
    // The cap is open again: the same quantity gets the promotional price once more.
    await setItem(buyer, v, 2).expect(200);
    expect((await checkout(buyer).expect(201)).body.orders[0].subtotalMinor).toBe(18_000);
  });

  it('counts concurrent checkouts atomically under the cap', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const p = await publish(owner, orgId);
    const v = p.variants[0]!.id;
    const promo = (await promote(orgId, owner, { productId: p.id, kind: 'percent', value: 10, label: 'Flash', endsAt: inHours(10), stockCap: 2 }).expect(201)).body;
    const buyers = [await user(), await user(), await user(), await user()];
    for (const b of buyers) await setItem(b, v, 1).expect(200);
    const results = await Promise.all(buyers.map((b) => checkout(b)));
    const subtotals = results.map((r) => r.body.orders[0].subtotalMinor as number).sort((a, b) => a - b);
    expect(subtotals).toEqual([9_000, 9_000, 10_000, 10_000]);
    expect(await soldOf(promo.id)).toBe(2);
  });
});

describe('seller routes', () => {
  it('allows one promotion at a time per variant', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const p = await publish(owner, orgId);
    const v = p.variants[0]!.id;
    const first = (await promote(orgId, owner, { productId: p.id, variantId: v, kind: 'percent', value: 10, label: 'A', endsAt: inHours(10) }).expect(201)).body;
    const clash = await promote(orgId, owner, { productId: p.id, kind: 'percent', value: 20, label: 'B', endsAt: inHours(5) }).expect(409);
    expect(clash.body.error.details).toMatchObject({ reason: 'promotion_overlap' });
    await promote(orgId, owner, { productId: p.id, variantId: v, kind: 'percent', value: 20, label: 'B', endsAt: inHours(20) }).expect(409);
    // Another period is fine, and so is the same period once the first one is stopped.
    await promote(orgId, owner, { productId: p.id, variantId: v, kind: 'percent', value: 20, label: 'B', startsAt: inHours(11), endsAt: inHours(20) }).expect(201);
    await ctx.http.patch(`/v1/orgs/${orgId}/promotions/${first.id}`).set(bearer(owner.token)).send({ endsAt: inHours(15) }).expect(409);
    await ctx.http.patch(`/v1/orgs/${orgId}/promotions/${first.id}`).set(bearer(owner.token)).send({ active: false }).expect(200);
    await promote(orgId, owner, { productId: p.id, variantId: v, kind: 'percent', value: 25, label: 'C', endsAt: inHours(9) }).expect(201);
  });

  it('validates the request and checks rights and ownership', async () => {
    const [owner, other, stock, outsider] = [await user(), await user(), await user(), await user()];
    const orgId = await createOrg(owner);
    const otherOrg = await createOrg(other);
    await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(owner.token)).send({ handle: stock.handle, role: 'stock' }).expect(201);
    await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(stock.token)).expect(200);
    const p = await publish(owner, orgId);
    const foreign = await publish(other, otherOrg);
    const ok = { productId: p.id, kind: 'percent', value: 10, label: 'Soldes', endsAt: inHours(10) };

    for (const bad of [
      { ...ok, value: 95 },
      { ...ok, value: 0 },
      { ...ok, label: 'x'.repeat(41) },
      { ...ok, label: '' },
      { ...ok, endsAt: inHours(24 * 31) },
      { ...ok, endsAt: inHours(-1) },
      { ...ok, endsAt: undefined },
      { ...ok, startsAt: inHours(20) },
      { ...ok, stockCap: 0 },
    ]) {
      await promote(orgId, owner, bad).expect(400);
    }
    await promote(orgId, owner, { ...ok, productId: randomUUID() }).expect(404);
    await promote(orgId, owner, { ...ok, variantId: foreign.variants[0]!.id }).expect(404);
    await promote(orgId, owner, { ...ok, productId: foreign.id }).expect(404);

    await promote(orgId, stock, ok).expect(403);
    await ctx.http.get(`/v1/orgs/${orgId}/promotions`).set(bearer(stock.token)).expect(403);
    await promote(orgId, outsider, ok).expect(404);
    await ctx.http.get(`/v1/orgs/${orgId}/promotions`).set(bearer(outsider.token)).expect(404);

    const created = (await promote(orgId, owner, ok).expect(201)).body;
    // Another organisation cannot touch it.
    await ctx.http.patch(`/v1/orgs/${otherOrg}/promotions/${created.id}`).set(bearer(other.token)).send({ label: 'Mien' }).expect(404);
    await ctx.http.delete(`/v1/orgs/${otherOrg}/promotions/${created.id}`).set(bearer(other.token)).expect(404);
    await ctx.http.patch(`/v1/orgs/${orgId}/promotions/${created.id}`).set(bearer(owner.token)).send({}).expect(400);
    const edited = (await ctx.http.patch(`/v1/orgs/${orgId}/promotions/${created.id}`).set(bearer(owner.token)).send({ label: 'Nouveau', stockCap: 5 }).expect(200)).body;
    expect(edited).toMatchObject({ label: 'Nouveau', stockCap: 5 });

    // The audit trail has ids, kind and value, never the label.
    const audit = (await ctx.sql.query(`SELECT metadata::text AS m FROM audit_events WHERE action = 'commerce.promotion_created' AND metadata->>'promotionId' = $1`, [created.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].m).not.toContain('Soldes');
  });
});

describe('flash sales', () => {
  it('lists running flash promotions of visible products only', async () => {
    const [owner, buyer, other, mod] = [await user(), await user(), await user(), await user(['user', 'moderator'])];
    const orgId = await createOrg(owner);
    const otherOrg = await createOrg(other);
    const flash = await publish(owner, orgId, { title: 'Flash' });
    const longSale = await publish(owner, orgId, { title: 'Soldes longues' });
    const noPromo = await publish(owner, orgId, { title: 'Sans promo' });
    const hidden = await publish(owner, orgId, { title: 'Cachée' });
    const blockedSeller = await publish(other, otherOrg, { title: 'Bloqué' });
    const future = await publish(owner, orgId, { title: 'Bientôt' });
    await promote(orgId, owner, { productId: flash.id, kind: 'percent', value: 40, label: 'Vente flash', endsAt: inHours(6) }).expect(201);
    await promote(orgId, owner, { productId: longSale.id, kind: 'percent', value: 10, label: 'Soldes', endsAt: inHours(24 * 10) }).expect(201);
    await promote(orgId, owner, { productId: hidden.id, kind: 'percent', value: 10, label: 'Flash', endsAt: inHours(6) }).expect(201);
    await promote(otherOrg, other, { productId: blockedSeller.id, kind: 'percent', value: 10, label: 'Flash', endsAt: inHours(6) }).expect(201);
    await promote(orgId, owner, { productId: future.id, kind: 'percent', value: 10, label: 'Flash', startsAt: inHours(3), endsAt: inHours(6) }).expect(201);
    await ctx.http.post('/v1/admin/moderation/actions').set(bearer(mod.token)).send({ targetType: 'product', targetId: hidden.id, action: 'hide' }).expect(200);
    await ctx.http.put(`/v1/blocks/${other.id}`).set(bearer(buyer.token)).expect(204);

    const res = (await ctx.http.get('/v1/promotions/flash?limit=50').set(bearer(buyer.token)).expect(200)).body;
    const ids = res.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(flash.id);
    for (const id of [longSale.id, noPromo.id, hidden.id, blockedSeller.id, future.id]) expect(ids).not.toContain(id);
    expect(res.items.find((i: { id: string }) => i.id === flash.id)).toMatchObject({ minPriceMinor: 6_000, compareAtPriceMinor: 10_000, promotion: { label: 'Vente flash' } });

    // Once the sale is over it leaves the list.
    const row = (await ctx.sql.query(`SELECT id FROM product_promotions WHERE product_id = $1`, [flash.id])).rows[0];
    await expire(row.id);
    const after = (await ctx.http.get('/v1/promotions/flash?limit=50').set(bearer(buyer.token)).expect(200)).body;
    expect(after.items.map((i: { id: string }) => i.id)).not.toContain(flash.id);
    await ctx.http.get('/v1/promotions/flash').expect(401);
  });
});

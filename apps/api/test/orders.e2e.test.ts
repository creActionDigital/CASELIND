import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { FakeCatalog, installFakeCatalog } from './fake-catalog.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

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
  identifier: string;
}

async function user(): Promise<TU> {
  const { tokens, identifier } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle, identifier };
}

let slugCounter = 0;
async function createOrg(owner: TU): Promise<string> {
  slugCounter += 1;
  const res = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug: `shop-${Date.now().toString(36)}-${slugCounter}`, name: 'Boutique Test', kind: 'shop' })
    .expect(201);
  return res.body.id;
}

async function addMember(orgId: string, inviter: TU, invitee: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(inviter.token)).send({ handle: invitee.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(invitee.token)).expect(200);
}

const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix', notes: 'Portail bleu' };

const setItem = (u: TU, variantId: string, quantity: number) =>
  ctx.http.put(`/v1/cart/items/${variantId}`).set(bearer(u.token)).send({ quantity });

const checkout = (u: TU, extra: Record<string, unknown> = {}) =>
  ctx.http
    .post('/v1/orders/checkout')
    .set(bearer(u.token))
    .send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery', ...extra });

const setStatus = (orgId: string, who: TU, orderId: string, status: string, note?: string) =>
  ctx.http.post(`/v1/orgs/${orgId}/orders/${orderId}/status`).set(bearer(who.token)).send({ status, note });

const createCoupon = (orgId: string, who: TU, body: Record<string, unknown>) =>
  ctx.http.post(`/v1/orgs/${orgId}/coupons`).set(bearer(who.token)).send(body);

/** A seller (owner) with an org and a few variants. */
async function seller(currency = 'CDF') {
  const owner = await user();
  const orgId = await createOrg(owner);
  const a = fake.add({ orgId, currency, price: 10_000, stock: 50 });
  const b = fake.add({ orgId, currency, price: 2_500, stock: 50 });
  return { owner, orgId, a, b };
}

const notificationsOf = async (u: TU) => (await ctx.http.get('/v1/notifications').set(bearer(u.token)).expect(200)).body.items;

describe('cart', () => {
  it('groups lines by organisation and currency with live prices, and flags unavailable lines', async () => {
    const s1 = await seller('CDF');
    const s2 = await seller('USD');
    const buyer = await user();
    await setItem(buyer, s1.a, 2).expect(200);
    await setItem(buyer, s1.b, 1).expect(200);
    const res = await setItem(buyer, s2.a, 3).expect(200);
    expect(res.body.itemCount).toBe(6);
    expect(res.body.groups).toHaveLength(2);
    const g1 = res.body.groups.find((g: any) => g.orgId === s1.orgId);
    expect(g1).toMatchObject({ currency: 'CDF', subtotalMinor: 22_500, orgName: 'Boutique Test' });
    expect(g1.lines).toHaveLength(2);

    fake.variants.get(s1.b)!.price = 3_000; // live price
    fake.variants.get(s2.a)!.published = false;
    const cart = (await ctx.http.get('/v1/cart').set(bearer(buyer.token)).expect(200)).body;
    expect(cart.groups).toHaveLength(1);
    expect(cart.groups[0].subtotalMinor).toBe(23_000);
    expect(cart.unavailable).toEqual([{ variantId: s2.a, quantity: 3 }]);
    fake.variants.get(s2.a)!.published = true;
  });

  it('sets, updates, removes, and enforces the quantity and line limits', async () => {
    const s = await seller();
    const buyer = await user();
    await setItem(buyer, s.a, 5).expect(200);
    await setItem(buyer, s.a, 7).expect(200);
    expect((await ctx.http.get('/v1/cart').set(bearer(buyer.token))).body.groups[0].lines[0].quantity).toBe(7);
    await setItem(buyer, s.a, 100).expect(400);
    await setItem(buyer, s.a, -1).expect(400);
    await setItem(buyer, randomUUID(), 1).expect(404);
    await setItem(buyer, 'not-a-uuid', 1).expect(404);
    const empty = await setItem(buyer, s.a, 0).expect(200);
    expect(empty.body).toEqual({ groups: [], unavailable: [], itemCount: 0 });

    // 100 lines max.
    const ids = Array.from({ length: 100 }, () => fake.add({ orgId: s.orgId, currency: 'CDF', price: 100, stock: 5 }));
    for (const id of ids) await setItem(buyer, id, 1).expect(200);
    const full = await setItem(buyer, s.a, 1);
    expect(full.status).toBe(409);
    expect(full.body.error.details.reason).toBe('cart_full');
    await setItem(buyer, ids[0]!, 3).expect(200); // an existing line can still change
    await ctx.http.delete('/v1/cart').set(bearer(buyer.token)).expect(204);
    expect((await ctx.http.get('/v1/cart').set(bearer(buyer.token))).body.itemCount).toBe(0);
  });

  it('needs authentication and the commerce flag', async () => {
    await ctx.http.get('/v1/cart').expect(401);
    const u = await user();
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'commerce'`);
    try {
      const res = await ctx.http.get('/v1/cart').set(bearer(u.token)).expect(403);
      expect(res.body.error.code).toBe('feature_disabled');
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'commerce'`);
    }
  });
});

describe('checkout', () => {
  it('splits the cart into one order per organisation, in one go, and empties the cart', async () => {
    const s1 = await seller();
    const s2 = await seller();
    const buyer = await user();
    await setItem(buyer, s1.a, 2).expect(200);
    await setItem(buyer, s1.b, 1).expect(200);
    await setItem(buyer, s2.a, 4).expect(200);

    const clientId = randomUUID();
    const res = await checkout(buyer, { clientId }).expect(201);
    expect(res.body.orders).toHaveLength(2);
    const o1 = res.body.orders.find((o: any) => o.orgId === s1.orgId);
    const o2 = res.body.orders.find((o: any) => o.orgId === s2.orgId);
    expect(o1).toMatchObject({ status: 'pending', currency: 'CDF', subtotalMinor: 22_500, discountMinor: 0, totalMinor: 22_500, paymentMethod: 'cash_on_delivery', buyerId: buyer.id });
    expect(o1.number).toMatch(/^CL-[A-HJ-NP-Z2-9]{8}$/);
    expect(o1.number).not.toBe(o2.number);
    expect(o1.items).toHaveLength(2);
    expect(o1.address).toMatchObject({ name: 'Awa Diallo', city: 'Kinshasa' });
    expect(o2.totalMinor).toBe(40_000);
    expect(fake.variants.get(s1.a)!.stock).toBe(48);

    expect((await ctx.http.get('/v1/cart').set(bearer(buyer.token))).body.itemCount).toBe(0);
    // Frozen copies: a price change later does not touch the order.
    fake.variants.get(s1.a)!.price = 99_999;
    const detail = await ctx.http.get(`/v1/orders/${o1.id}`).set(bearer(buyer.token)).expect(200);
    expect(detail.body.totalMinor).toBe(22_500);
    expect(detail.body.events).toEqual([expect.objectContaining({ status: 'pending', fromStatus: null, actorKind: 'buyer', actorUserId: buyer.id })]);
    fake.variants.get(s1.a)!.price = 10_000;

    const list = await ctx.http.get('/v1/orders').set(bearer(buyer.token)).expect(200);
    expect(list.body.items).toHaveLength(2);
    const nosy = await user();
    await ctx.http.get(`/v1/orders/${o1.id}`).set(bearer(nosy.token)).expect(404);
  });

  it('splits by currency too', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const cdf = fake.add({ orgId, currency: 'CDF', price: 1000, stock: 5 });
    const usd = fake.add({ orgId, currency: 'USD', price: 300, stock: 5 });
    const buyer = await user();
    await setItem(buyer, cdf, 1);
    await setItem(buyer, usd, 2);
    const res = await checkout(buyer).expect(201);
    expect(res.body.orders.map((o: any) => [o.currency, o.totalMinor]).sort()).toEqual([['CDF', 1000], ['USD', 600]]);
  });

  it('is idempotent per clientId: a replay returns the same orders and creates nothing', async () => {
    const s = await seller();
    const buyer = await user();
    await setItem(buyer, s.a, 1);
    const clientId = randomUUID();
    const first = await checkout(buyer, { clientId }).expect(201);
    const stock = fake.variants.get(s.a)!.stock;
    await setItem(buyer, s.a, 1); // cart refilled meanwhile: the replay must not consume it
    const replay = await checkout(buyer, { clientId }).expect(200);
    expect(replay.body.orders.map((o: any) => o.id)).toEqual(first.body.orders.map((o: any) => o.id));
    expect(fake.variants.get(s.a)!.stock).toBe(stock);
    expect((await ctx.http.get('/v1/cart').set(bearer(buyer.token))).body.itemCount).toBe(1);
    const count = await ctx.sql.query(`SELECT count(*)::int AS n FROM orders WHERE buyer_id = $1`, [buyer.id]);
    expect(count.rows[0].n).toBe(1);
  });

  it('concurrent checkouts with the same clientId create the orders once', async () => {
    const s = await seller();
    const buyer = await user();
    await setItem(buyer, s.a, 2);
    const clientId = randomUUID();
    const [r1, r2] = await Promise.all([checkout(buyer, { clientId }), checkout(buyer, { clientId })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.body.orders[0].id).toBe(r2.body.orders[0].id);
    expect(fake.variants.get(s.a)!.stock).toBe(48);
  });

  it('refuses all or nothing when the reservation fails, writing nothing', async () => {
    const s = await seller();
    const other = await seller();
    const buyer = await user();
    await setItem(buyer, s.a, 2);
    await setItem(buyer, other.a, 3);
    fake.variants.get(other.a)!.stock = 1;
    const res = await checkout(buyer);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: 'insufficient_stock', variantIds: [other.a] });
    expect(fake.variants.get(s.a)!.stock).toBe(50);
    const rows = await ctx.sql.query(`SELECT count(*)::int AS n FROM orders WHERE buyer_id = $1`, [buyer.id]);
    expect(rows.rows[0].n).toBe(0);
    expect((await ctx.http.get('/v1/cart').set(bearer(buyer.token))).body.itemCount).toBe(5);

    fake.variants.get(other.a)!.published = false;
    const gone = await checkout(buyer);
    expect(gone.status).toBe(409);
    expect(gone.body.error.details.reason).toBe('unavailable');
  });

  it('validates the request: empty cart, payment method, address', async () => {
    const buyer = await user();
    const empty = await checkout(buyer);
    expect(empty.status).toBe(409);
    expect(empty.body.error.details.reason).toBe('empty_cart');
    await checkout(buyer, { paymentMethod: 'card' }).expect(400);
    await checkout(buyer, { address: { ...ADDRESS, phone: '0810000000' } }).expect(400);
    const methods = await ctx.http.get('/v1/payment-methods').set(bearer(buyer.token)).expect(200);
    expect(methods.body).toEqual({ methods: ['cash_on_delivery'] });
  });
});

describe('coupons', () => {
  async function buyerWithCart(s: { a: string }, qty = 2): Promise<TU> {
    const buyer = await user();
    await setItem(buyer, s.a, qty).expect(200);
    return buyer;
  }

  it('applies a percentage and a fixed amount, case-insensitively, only to the issuing org', async () => {
    const s = await seller();
    const other = await seller();
    const pct = await createCoupon(s.orgId, s.owner, { code: 'promo10', kind: 'percent', value: 10 });
    expect(pct.status).toBe(201);
    expect(pct.body).toMatchObject({ code: 'PROMO10', kind: 'percent', value: 10, currency: null, usesCount: 0, active: true });
    await createCoupon(s.orgId, s.owner, { code: 'Promo10', kind: 'percent', value: 5 }).expect(409);
    await createCoupon(other.orgId, other.owner, { code: 'MOINS1000', kind: 'fixed', value: 1000, currency: 'CDF' }).expect(201);

    const buyer = await user();
    await setItem(buyer, s.a, 2); // 20 000
    await setItem(buyer, other.a, 1); // 10 000
    const res = await checkout(buyer, { couponCodes: ['pRoMo10', 'moins1000'] }).expect(201);
    const o1 = res.body.orders.find((o: any) => o.orgId === s.orgId);
    const o2 = res.body.orders.find((o: any) => o.orgId === other.orgId);
    expect(o1).toMatchObject({ subtotalMinor: 20_000, discountMinor: 2_000, totalMinor: 18_000, couponCode: 'PROMO10' });
    expect(o2).toMatchObject({ subtotalMinor: 10_000, discountMinor: 1_000, totalMinor: 9_000 });
    const coupons = await ctx.http.get(`/v1/orgs/${s.orgId}/coupons`).set(bearer(s.owner.token)).expect(200);
    expect(coupons.body.items[0].usesCount).toBe(1);
  });

  it('caps a fixed amount at the subtotal and validates creation', async () => {
    const s = await seller();
    await createCoupon(s.orgId, s.owner, { code: 'GROS', kind: 'fixed', value: 999_999, currency: 'CDF' }).expect(201);
    const buyer = await buyerWithCart(s, 1);
    const res = await checkout(buyer, { couponCodes: ['GROS'] }).expect(201);
    expect(res.body.orders[0]).toMatchObject({ discountMinor: 10_000, totalMinor: 0 });
    await createCoupon(s.orgId, s.owner, { code: 'X', kind: 'percent', value: 10 }).expect(400);
    await createCoupon(s.orgId, s.owner, { code: 'BAD1', kind: 'percent', value: 91 }).expect(400);
    await createCoupon(s.orgId, s.owner, { code: 'BAD2', kind: 'fixed', value: 10 }).expect(400);
    await createCoupon(s.orgId, s.owner, { code: 'BAD3', kind: 'percent', value: 10, startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' }).expect(400);
  });

  it('rejects unusable coupons with details.reason', async () => {
    const s = await seller();
    await createCoupon(s.orgId, s.owner, { code: 'MIN', kind: 'percent', value: 10, minOrderMinor: 50_000 }).expect(201);
    await createCoupon(s.orgId, s.owner, { code: 'OLD', kind: 'percent', value: 10, startsAt: '2020-01-01T00:00:00Z', endsAt: '2020-02-01T00:00:00Z' }).expect(201);
    await createCoupon(s.orgId, s.owner, { code: 'LATER', kind: 'percent', value: 10, startsAt: '2099-01-01T00:00:00Z' }).expect(201);
    const off = (await createCoupon(s.orgId, s.owner, { code: 'OFF', kind: 'percent', value: 10 }).expect(201)).body;
    const usd = await createCoupon(s.orgId, s.owner, { code: 'USDONLY', kind: 'fixed', value: 10, currency: 'USD' }).expect(201);
    expect(usd.status).toBe(201);
    await ctx.http.patch(`/v1/orgs/${s.orgId}/coupons/${off.id}`).set(bearer(s.owner.token)).send({ active: false }).expect(200);

    const buyer = await buyerWithCart(s);
    const reasonOf = async (code: string) => {
      const res = await checkout(buyer, { couponCodes: [code] });
      expect(res.status).toBe(400);
      return res.body.error.details.reason;
    };
    expect(await reasonOf('MIN')).toBe('min_not_reached');
    expect(await reasonOf('OLD')).toBe('expired');
    expect(await reasonOf('LATER')).toBe('expired');
    expect(await reasonOf('OFF')).toBe('not_applicable');
    expect(await reasonOf('USDONLY')).toBe('not_applicable');
    expect(await reasonOf('NOSUCH')).toBe('not_applicable');
    // Nothing was consumed by the refusals (the fake catalogue is not transactional: check the database side).
    expect((await ctx.sql.query('SELECT count(*)::int AS n FROM orders WHERE buyer_id = $1', [buyer.id])).rows[0].n).toBe(0);
    expect((await ctx.http.get('/v1/cart').set(bearer(buyer.token))).body.itemCount).toBe(2);
  });

  it('enforces the total and per-user limits, and a cancellation gives the use back', async () => {
    const s = await seller();
    await createCoupon(s.orgId, s.owner, { code: 'ONCE', kind: 'percent', value: 20, maxUses: 1 }).expect(201);
    await createCoupon(s.orgId, s.owner, { code: 'PERUSER', kind: 'percent', value: 20, maxUsesPerUser: 1 }).expect(201);

    const b1 = await buyerWithCart(s);
    const order = (await checkout(b1, { couponCodes: ['ONCE'] }).expect(201)).body.orders[0];
    const b2 = await buyerWithCart(s);
    const exhausted = await checkout(b2, { couponCodes: ['ONCE'] });
    expect(exhausted.status).toBe(400);
    expect(exhausted.body.error.details.reason).toBe('exhausted');

    await ctx.http.post(`/v1/orders/${order.id}/cancel`).set(bearer(b1.token)).send({}).expect(200);
    await checkout(b2, { couponCodes: ['ONCE'] }).expect(201); // the use was released

    const b3 = await buyerWithCart(s);
    await checkout(b3, { couponCodes: ['PERUSER'] }).expect(201);
    await setItem(b3, s.a, 1);
    const again = await checkout(b3, { couponCodes: ['PERUSER'] });
    expect(again.status).toBe(400);
    expect(again.body.error.details.reason).toBe('exhausted');
    await checkout(b3, { couponCodes: ['PERUSER'.toLowerCase()] }).expect(400);
    await checkout(b3).expect(201); // without the coupon it goes through
  });

  it('serialises a race on the last use: exactly one checkout wins', async () => {
    const s = await seller();
    await createCoupon(s.orgId, s.owner, { code: 'LAST', kind: 'percent', value: 50, maxUses: 1 }).expect(201);
    const buyers = await Promise.all([1, 2, 3].map(() => user()));
    for (const b of buyers) await setItem(b, s.a, 1).expect(200);
    const results = await Promise.all(buyers.map((b) => checkout(b, { couponCodes: ['LAST'] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400 && r.body.error.details.reason === 'exhausted')).toHaveLength(2);
    const row = await ctx.sql.query(`SELECT uses_count FROM coupons WHERE org_id = $1 AND code = 'LAST'`, [s.orgId]);
    expect(row.rows[0].uses_count).toBe(1);
    expect((await ctx.sql.query('SELECT count(*)::int AS n FROM orders WHERE org_id = $1', [s.orgId])).rows[0].n).toBe(1);
  });

  it('is manageable by orders.manage roles only, and audited', async () => {
    const s = await seller();
    const manager = await user();
    const employee = await user();
    await addMember(s.orgId, s.owner, manager, 'manager');
    await addMember(s.orgId, s.owner, employee, 'employee');
    await createCoupon(s.orgId, employee, { code: 'NOPE', kind: 'percent', value: 10 }).expect(403);
    await ctx.http.get(`/v1/orgs/${s.orgId}/coupons`).set(bearer(employee.token)).expect(403);
    const made = await createCoupon(s.orgId, manager, { code: 'MGR', kind: 'percent', value: 10 }).expect(201);
    await ctx.http.patch(`/v1/orgs/${s.orgId}/coupons/${made.body.id}`).set(bearer(manager.token)).send({ active: true }).expect(400);
    const off = await ctx.http.patch(`/v1/orgs/${s.orgId}/coupons/${made.body.id}`).set(bearer(manager.token)).send({ active: false }).expect(200);
    expect(off.body.active).toBe(false);
    await ctx.http.patch(`/v1/orgs/${s.orgId}/coupons/${randomUUID()}`).set(bearer(manager.token)).send({ active: false }).expect(404);
    // Another org cannot reach it.
    const stranger = await seller();
    await ctx.http.patch(`/v1/orgs/${stranger.orgId}/coupons/${made.body.id}`).set(bearer(stranger.owner.token)).send({ active: false }).expect(404);
    const audit = await ctx.sql.query(`SELECT action FROM audit_events WHERE metadata->>'orgId' = $1 AND action LIKE 'commerce.coupon%' ORDER BY id`, [s.orgId]);
    expect(audit.rows.map((r) => r.action)).toEqual(['commerce.coupon_created', 'commerce.coupon_deactivated']);
    const page1 = await ctx.http.get(`/v1/orgs/${s.orgId}/coupons?limit=1`).set(bearer(s.owner.token)).expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).toBeNull();
  });
});

describe('order lifecycle', () => {
  async function pendingOrder() {
    const s = await seller();
    const buyer = await user();
    await setItem(buyer, s.a, 2);
    const order = (await checkout(buyer).expect(201)).body.orders[0];
    return { ...s, buyer, order };
  }

  it('walks pending to delivered with a timestamped, attributed event log', async () => {
    const t = await pendingOrder();
    for (const status of ['confirmed', 'preparing', 'shipped', 'delivered']) {
      const res = await setStatus(t.orgId, t.owner, t.order.id, status, `note ${status}`).expect(200);
      expect(res.body.status).toBe(status);
    }
    const detail = await ctx.http.get(`/v1/orders/${t.order.id}`).set(bearer(t.buyer.token)).expect(200);
    expect(detail.body.events.map((e: any) => e.status)).toEqual(['pending', 'confirmed', 'preparing', 'shipped', 'delivered']);
    expect(detail.body.events[2]).toMatchObject({ fromStatus: 'confirmed', actorKind: 'org', actorUserId: t.owner.id, note: 'note preparing' });
    expect(Date.parse(detail.body.events[4].createdAt)).not.toBeNaN();
    // Final states are final.
    await setStatus(t.orgId, t.owner, t.order.id, 'cancelled').expect(409);
    await ctx.http.post(`/v1/orders/${t.order.id}/cancel`).set(bearer(t.buyer.token)).send({}).expect(409);
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'commerce.order_status_changed' AND metadata->>'orderId' = $1`, [t.order.id]);
    expect(audit.rows).toHaveLength(4);
    expect(JSON.stringify(audit.rows)).not.toContain('Awa Diallo');
  });

  it('refuses forbidden transitions with 409 invalid_transition', async () => {
    const t = await pendingOrder();
    for (const status of ['preparing', 'shipped', 'delivered', 'pending']) {
      const res = await setStatus(t.orgId, t.owner, t.order.id, status);
      expect(res.status).toBe(409);
      expect(res.body.error.details).toMatchObject({ reason: 'invalid_transition', from: 'pending', to: status });
    }
    await setStatus(t.orgId, t.owner, t.order.id, 'confirmed').expect(200);
    await setStatus(t.orgId, t.owner, t.order.id, 'confirmed').expect(409);
    await setStatus(t.orgId, t.owner, t.order.id, 'delivered').expect(409);
    await setStatus(t.orgId, t.owner, t.order.id, 'bogus').expect(400);
  });

  it('lets the buyer cancel only while pending, and the org until preparing; stock is released in both cases', async () => {
    const t = await pendingOrder();
    expect(fake.variants.get(t.a)!.stock).toBe(48);
    const cancelled = await ctx.http.post(`/v1/orders/${t.order.id}/cancel`).set(bearer(t.buyer.token)).send({ note: 'changed my mind' }).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.events.at(-1)).toMatchObject({ actorKind: 'buyer', note: 'changed my mind' });
    expect(fake.variants.get(t.a)!.stock).toBe(50);
    expect(fake.released.at(-1)).toEqual([{ variantId: t.a, quantity: 2 }]);

    const t2 = await pendingOrder();
    await setStatus(t2.orgId, t2.owner, t2.order.id, 'confirmed').expect(200);
    const refused = await ctx.http.post(`/v1/orders/${t2.order.id}/cancel`).set(bearer(t2.buyer.token)).send({});
    expect(refused.status).toBe(409);
    expect(fake.variants.get(t2.a)!.stock).toBe(48);
    await setStatus(t2.orgId, t2.owner, t2.order.id, 'preparing').expect(200);
    await setStatus(t2.orgId, t2.owner, t2.order.id, 'cancelled', 'out of stock').expect(200);
    expect(fake.variants.get(t2.a)!.stock).toBe(50);

    const t3 = await pendingOrder();
    for (const status of ['confirmed', 'preparing', 'shipped']) await setStatus(t3.orgId, t3.owner, t3.order.id, status).expect(200);
    await setStatus(t3.orgId, t3.owner, t3.order.id, 'cancelled').expect(409);
    expect(fake.variants.get(t3.a)!.stock).toBe(48);
  });

  it('serialises concurrent transitions on the order row', async () => {
    const t = await pendingOrder();
    const results = await Promise.all([
      setStatus(t.orgId, t.owner, t.order.id, 'confirmed'),
      setStatus(t.orgId, t.owner, t.order.id, 'confirmed'),
      ctx.http.post(`/v1/orders/${t.order.id}/cancel`).set(bearer(t.buyer.token)).send({}),
    ]);
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1); // buyer cancel xor confirm, never both, never twice
    const events = await ctx.sql.query(`SELECT count(*)::int AS n FROM order_events WHERE order_id = $1`, [t.order.id]);
    expect(events.rows[0].n).toBe(2);
  });

  it('keeps order_events append-only', async () => {
    const t = await pendingOrder();
    await expect(ctx.sql.query(`UPDATE order_events SET note = 'x' WHERE order_id = $1`, [t.order.id])).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`DELETE FROM order_events WHERE order_id = $1`, [t.order.id])).rejects.toThrow(/append-only/);
  });

  it('enforces seller rights by role and org scope', async () => {
    const t = await pendingOrder();
    const sales = await user();
    const support = await user();
    const employee = await user();
    await addMember(t.orgId, t.owner, sales, 'sales');
    await addMember(t.orgId, t.owner, support, 'support');
    await addMember(t.orgId, t.owner, employee, 'employee');

    // Listing and reading: orders.view.
    for (const who of [t.owner, sales, support]) {
      await ctx.http.get(`/v1/orgs/${t.orgId}/orders/${t.order.id}`).set(bearer(who.token)).expect(200);
    }
    await ctx.http.get(`/v1/orgs/${t.orgId}/orders`).set(bearer(employee.token)).expect(403);
    await ctx.http.get(`/v1/orgs/${t.orgId}/orders/${t.order.id}`).set(bearer(employee.token)).expect(403);
    // Changing: orders.manage (support only views).
    await setStatus(t.orgId, employee, t.order.id, 'confirmed').expect(403);
    await setStatus(t.orgId, support, t.order.id, 'confirmed').expect(403);
    await setStatus(t.orgId, t.buyer, t.order.id, 'confirmed').expect(404); // buyer is no member
    await setStatus(t.orgId, sales, t.order.id, 'confirmed').expect(200);
    // An order of another org is invisible.
    const stranger = await seller();
    await ctx.http.get(`/v1/orgs/${stranger.orgId}/orders/${t.order.id}`).set(bearer(stranger.owner.token)).expect(404);
    await setStatus(stranger.orgId, stranger.owner, t.order.id, 'preparing').expect(404);
    // Another buyer cannot cancel it.
    const nosy = await user();
    await ctx.http.post(`/v1/orders/${t.order.id}/cancel`).set(bearer(nosy.token)).send({}).expect(404);
  });

  it('lists the seller orders with a status filter and cursor pagination', async () => {
    const s = await seller();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const buyer = await user();
      await setItem(buyer, s.a, 1);
      ids.push((await checkout(buyer).expect(201)).body.orders[0].id);
    }
    await setStatus(s.orgId, s.owner, ids[0]!, 'confirmed').expect(200);
    const page1 = await ctx.http.get(`/v1/orgs/${s.orgId}/orders?limit=2`).set(bearer(s.owner.token)).expect(200);
    expect(page1.body.items.map((o: any) => o.id)).toEqual([ids[2], ids[1]]);
    const page2 = await ctx.http.get(`/v1/orgs/${s.orgId}/orders?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`).set(bearer(s.owner.token)).expect(200);
    expect(page2.body.items.map((o: any) => o.id)).toEqual([ids[0]]);
    expect(page2.body.nextCursor).toBeNull();
    const confirmed = await ctx.http.get(`/v1/orgs/${s.orgId}/orders?status=confirmed`).set(bearer(s.owner.token)).expect(200);
    expect(confirmed.body.items.map((o: any) => o.id)).toEqual([ids[0]]);
    await ctx.http.get(`/v1/orgs/${s.orgId}/orders?cursor=garbage`).set(bearer(s.owner.token)).expect(400);
  });
});

describe('notifications', () => {
  it('notifies the order managers of a new order and the buyer of each seller status change, without personal data', async () => {
    const s = await seller();
    const manager = await user();
    const employee = await user();
    await addMember(s.orgId, s.owner, manager, 'manager');
    await addMember(s.orgId, s.owner, employee, 'employee');
    const buyer = await user();
    await setItem(buyer, s.a, 1);
    const order = (await checkout(buyer).expect(201)).body.orders[0];

    for (const who of [s.owner, manager]) {
      const items = (await notificationsOf(who)).filter((n: any) => n.category === 'commerce');
      expect(items).toHaveLength(1);
      expect(items[0].body).toContain(order.number);
      expect(items[0].body).toContain('10000');
      expect(JSON.stringify(items[0])).not.toMatch(/Awa|Diallo|Kinshasa|0810000000/);
    }
    expect((await notificationsOf(employee)).filter((n: any) => n.category === 'commerce')).toHaveLength(0);
    expect((await notificationsOf(buyer)).filter((n: any) => n.category === 'commerce')).toHaveLength(0);

    await setStatus(s.orgId, s.owner, order.id, 'confirmed').expect(200);
    await setStatus(s.orgId, s.owner, order.id, 'preparing').expect(200);
    const mine = (await notificationsOf(buyer)).filter((n: any) => n.category === 'commerce');
    expect(mine).toHaveLength(2);
    expect(mine.every((n: any) => n.title.includes(order.number) && n.data.orderId === order.id)).toBe(true);

    // The buyer cancelling is told to the managers, not to themselves.
    const t = await seller();
    const b2 = await user();
    await setItem(b2, t.a, 1);
    const o2 = (await checkout(b2).expect(201)).body.orders[0];
    await ctx.http.post(`/v1/orders/${o2.id}/cancel`).set(bearer(b2.token)).send({}).expect(200);
    expect((await notificationsOf(t.owner)).filter((n: any) => n.category === 'commerce')).toHaveLength(2);
    expect((await notificationsOf(b2)).filter((n: any) => n.category === 'commerce')).toHaveLength(0);
  });
});

describe('account export and purge', () => {
  it('exports orders and reviews, then the purge erases the address, the cart and the reviews but keeps the orders', async () => {
    const s = await seller();
    const buyer = await user();
    await setItem(buyer, s.a, 2);
    const order = (await checkout(buyer).expect(201)).body.orders[0];
    await setItem(buyer, s.b, 1); // stays in the cart
    await ctx.sql.query(
      `INSERT INTO reviews (product_id, org_id, user_id, rating, body) VALUES ($1, $2, $3, 4, 'Bien')`,
      [fake.variants.get(s.a)!.productId, s.orgId, buyer.id],
    );

    const exp = await ctx.http.get('/v1/me/export').set(bearer(buyer.token)).expect(200);
    expect(exp.body.orders).toHaveLength(1);
    expect(exp.body.orders[0]).toMatchObject({
      number: order.number,
      status: 'pending',
      totalMinor: 20_000,
      currency: 'CDF',
      address: { name: 'Awa Diallo' },
      items: [{ title: 'Article', quantity: 2, unitPriceMinor: 10_000 }],
    });
    expect(exp.body.reviews).toEqual([expect.objectContaining({ rating: 4, body: 'Bien' })]);
    expect(JSON.stringify(exp.body.orders)).not.toContain(s.owner.id);

    await ctx.http.post('/v1/me/deletion-request').set(bearer(buyer.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [buyer.id]);
    await ctx.app.get(MaintenanceService).runOnce();

    const row = await ctx.sql.query(`SELECT status, address, address_anonymized_at, total_minor FROM orders WHERE id = $1`, [order.id]);
    expect(row.rows[0]).toMatchObject({ status: 'pending', address: null, total_minor: '20000' });
    expect(row.rows[0].address_anonymized_at).not.toBeNull();
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM cart_items WHERE user_id = $1`, [buyer.id])).rows[0].n).toBe(0);
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM reviews WHERE user_id = $1`, [buyer.id])).rows[0].n).toBe(0);
    // The seller still sees the order, without an address.
    const seen = await ctx.http.get(`/v1/orgs/${s.orgId}/orders/${order.id}`).set(bearer(s.owner.token)).expect(200);
    expect(seen.body.address).toBeNull();
    expect(seen.body.items).toHaveLength(1);
  });
});

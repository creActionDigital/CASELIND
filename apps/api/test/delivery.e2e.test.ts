import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealtimeService } from '../src/realtime/realtime.service.js';
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

async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

let slugCounter = 0;
async function createOrg(owner: TU): Promise<string> {
  slugCounter += 1;
  const res = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug: `deliv-${Date.now().toString(36)}-${slugCounter}`, name: 'Boutique Livraison', kind: 'shop' })
    .expect(201);
  return res.body.id;
}

async function addMember(orgId: string, inviter: TU, invitee: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(inviter.token)).send({ handle: invitee.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(invitee.token)).expect(200);
}

const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix', line2: 'Gombe' };

const setItem = (u: TU, variantId: string, quantity: number) =>
  ctx.http.put(`/v1/cart/items/${variantId}`).set(bearer(u.token)).send({ quantity });

const checkout = (u: TU, extra: Record<string, unknown> = {}) =>
  ctx.http
    .post('/v1/orders/checkout')
    .set(bearer(u.token))
    .send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery', ...extra });

const setStatus = (orgId: string, who: TU, orderId: string, status: string) =>
  ctx.http.post(`/v1/orgs/${orgId}/orders/${orderId}/status`).set(bearer(who.token)).send({ status });

const createZone = (orgId: string, who: TU, body: Record<string, unknown> = {}) =>
  ctx.http
    .post(`/v1/orgs/${orgId}/delivery-zones`)
    .set(bearer(who.token))
    .send({ name: 'Kinshasa centre', areas: ['Kinshasa', 'Gombe'], fees: { CDF: 5_000, USD: 300 }, etaMinutes: 90, ...body });

const assign = (orgId: string, who: TU, deliveryId: string, courierUserId: string) =>
  ctx.http.post(`/v1/orgs/${orgId}/deliveries/${deliveryId}/assign`).set(bearer(who.token)).send({ courierUserId });

const courierStatus = (who: TU, deliveryId: string, body: Record<string, unknown>) =>
  ctx.http.post(`/v1/me/deliveries/${deliveryId}/status`).set(bearer(who.token)).send(body);

interface Setup {
  owner: TU;
  courier: TU;
  buyer: TU;
  orgId: string;
  variant: string;
}

/** An organisation with an owner, a delivery member, and a buyer. */
async function setup(opts: { zone?: boolean } = {}): Promise<Setup> {
  const owner = await user();
  const courier = await user();
  const buyer = await user();
  const orgId = await createOrg(owner);
  await addMember(orgId, owner, courier, 'delivery');
  const variant = fake.add({ orgId, currency: 'CDF', price: 10_000, stock: 100 });
  if (opts.zone) await createZone(orgId, owner).expect(201);
  return { owner, courier, buyer, orgId, variant };
}

/** Places a delivery order and returns it with its delivery id. */
async function placeOrder(s: Setup, extra: Record<string, unknown> = {}) {
  await setItem(s.buyer, s.variant, 2).expect(200);
  const zones = (await ctx.http.get(`/v1/delivery/orgs/${s.orgId}/zones`).set(bearer(s.buyer.token)).expect(200)).body.items;
  const body = zones.length > 0 ? { zones: [{ orgId: s.orgId, zoneId: zones[0].id }], ...extra } : extra;
  const res = await checkout(s.buyer, body).expect(201);
  const order = res.body.orders[0];
  const detail = (await ctx.http.get(`/v1/orders/${order.id}`).set(bearer(s.buyer.token)).expect(200)).body;
  return { order, detail, deliveryId: detail.delivery.id as string, proofCode: detail.delivery.proofCode as string };
}

const prepare = async (s: Setup, orderId: string) => {
  await setStatus(s.orgId, s.owner, orderId, 'confirmed').expect(200);
  await setStatus(s.orgId, s.owner, orderId, 'preparing').expect(200);
};

const orderStatus = async (s: Setup, orderId: string) =>
  (await ctx.http.get(`/v1/orders/${orderId}`).set(bearer(s.buyer.token)).expect(200)).body.status as string;

const notificationsOf = async (u: TU) => (await ctx.http.get('/v1/notifications').set(bearer(u.token)).expect(200)).body.items;

describe('delivery zones', () => {
  it('are managed with orders.manage only, normalised, listed to buyers when active', async () => {
    const s = await setup();
    await createZone(s.orgId, s.courier).expect(403);
    await createZone(s.orgId, s.buyer).expect(404);
    const bad = await createZone(s.orgId, s.owner, { fees: { cdf: 5 } });
    expect(bad.status).toBe(400);
    await createZone(s.orgId, s.owner, { areas: [] }).expect(400);

    const zone = (await createZone(s.orgId, s.owner, { areas: ['  KINSHASÁ ', 'Gombe'] }).expect(201)).body;
    expect(zone).toMatchObject({ orgId: s.orgId, areas: ['kinshasa', 'gombe'], fees: { CDF: 5_000, USD: 300 }, etaMinutes: 90, active: true });
    await ctx.http.get(`/v1/orgs/${s.orgId}/delivery-zones`).set(bearer(s.courier.token)).expect(403);
    expect((await ctx.http.get(`/v1/orgs/${s.orgId}/delivery-zones`).set(bearer(s.owner.token)).expect(200)).body.items).toHaveLength(1);

    const other = (await createZone(s.orgId, s.owner, { name: 'Lubumbashi', areas: ['Lubumbashi'], active: false }).expect(201)).body;
    const visible = (await ctx.http.get(`/v1/delivery/orgs/${s.orgId}/zones`).set(bearer(s.buyer.token)).expect(200)).body.items;
    expect(visible.map((z: any) => z.id)).toEqual([zone.id]);

    await ctx.http.patch(`/v1/orgs/${s.orgId}/delivery-zones/${zone.id}`).set(bearer(s.courier.token)).send({ etaMinutes: 30 }).expect(403);
    const patched = await ctx.http.patch(`/v1/orgs/${s.orgId}/delivery-zones/${zone.id}`).set(bearer(s.owner.token)).send({ etaMinutes: 30 }).expect(200);
    expect(patched.body.etaMinutes).toBe(30);
    await ctx.http.patch(`/v1/orgs/${s.orgId}/delivery-zones/${zone.id}`).set(bearer(s.owner.token)).send({}).expect(400);
    await ctx.http.delete(`/v1/orgs/${s.orgId}/delivery-zones/${other.id}`).set(bearer(s.owner.token)).expect(204);
    await ctx.http.delete(`/v1/orgs/${s.orgId}/delivery-zones/${other.id}`).set(bearer(s.owner.token)).expect(404);
    await ctx.http.delete(`/v1/orgs/${s.orgId}/delivery-zones/not-a-uuid`).set(bearer(s.owner.token)).expect(404);
  });
});

describe('checkout with delivery', () => {
  it('adds the zone fee to the total, keeps it frozen, and pick-up is free without address or delivery', async () => {
    const s = await setup({ zone: true });
    await setItem(s.buyer, s.variant, 2).expect(200);
    const zoneId = (await ctx.http.get(`/v1/delivery/orgs/${s.orgId}/zones`).set(bearer(s.buyer.token))).body.items[0].id;

    // Zone required, unknown zone, address outside the zone, currency without a fee.
    const missing = await checkout(s.buyer).expect(400);
    expect(missing.body.error.details[0].reason).toBe('zone_required');
    const unknown = await checkout(s.buyer, { zones: [{ orgId: s.orgId, zoneId: randomUUID() }] }).expect(400);
    expect(unknown.body.error.details[0].reason).toBe('zone_not_found');
    const far = await checkout(s.buyer, { zones: [{ orgId: s.orgId, zoneId }], address: { ...ADDRESS, city: 'Goma', line2: undefined } }).expect(400);
    expect(far.body.error.details[0].reason).toBe('zone_not_covered');
    await ctx.http.patch(`/v1/orgs/${s.orgId}/delivery-zones/${zoneId}`).set(bearer(s.owner.token)).send({ fees: { USD: 300 } }).expect(200);
    const noFee = await checkout(s.buyer, { zones: [{ orgId: s.orgId, zoneId }] }).expect(400);
    expect(noFee.body.error.details[0].reason).toBe('zone_currency_unsupported');
    await ctx.http.patch(`/v1/orgs/${s.orgId}/delivery-zones/${zoneId}`).set(bearer(s.owner.token)).send({ fees: { CDF: 5_000 } }).expect(200);
    // The cart was untouched by the refusals; a delivery needs an address.
    await checkout(s.buyer, { address: undefined, zones: [{ orgId: s.orgId, zoneId }] }).expect(400);

    const ok = await checkout(s.buyer, { zones: [{ orgId: s.orgId, zoneId }] }).expect(201);
    expect(ok.body.orders[0]).toMatchObject({ subtotalMinor: 20_000, deliveryFeeMinor: 5_000, totalMinor: 25_000, fulfillment: 'delivery' });
    const detail = (await ctx.http.get(`/v1/orders/${ok.body.orders[0].id}`).set(bearer(s.buyer.token)).expect(200)).body;
    expect(detail.delivery).toMatchObject({ status: 'pending', courier: null, estimatedMinutes: 90, proofLocked: false });
    await ctx.http.patch(`/v1/orgs/${s.orgId}/delivery-zones/${zoneId}`).set(bearer(s.owner.token)).send({ fees: { CDF: 9_999 } }).expect(200);
    expect((await ctx.http.get(`/v1/orders/${ok.body.orders[0].id}`).set(bearer(s.buyer.token))).body.totalMinor).toBe(25_000);

    // Pick-up: free, no address needed, no delivery record.
    await setItem(s.buyer, s.variant, 1).expect(200);
    const pickup = await checkout(s.buyer, { fulfillment: 'pickup', address: undefined }).expect(201);
    expect(pickup.body.orders[0]).toMatchObject({ fulfillment: 'pickup', deliveryFeeMinor: 0, totalMinor: 10_000, address: null });
    const pdetail = (await ctx.http.get(`/v1/orders/${pickup.body.orders[0].id}`).set(bearer(s.buyer.token))).body;
    expect(pdetail.delivery).toBeNull();
    const { rows } = await ctx.sql.query('SELECT count(*)::int AS n FROM deliveries WHERE order_id = $1', [pickup.body.orders[0].id]);
    expect(rows[0].n).toBe(0);
  });

  it('delivers for free when the seller defined no zone', async () => {
    const s = await setup();
    const { order, detail } = await placeOrder(s);
    expect(order).toMatchObject({ deliveryFeeMinor: 0, totalMinor: 20_000 });
    expect(detail.delivery.estimatedMinutes).toBeNull();
    await setItem(s.buyer, s.variant, 1).expect(200);
    const stray = await checkout(s.buyer, { zones: [{ orgId: s.orgId, zoneId: randomUUID() }] }).expect(400);
    expect(stray.body.error.details[0].reason).toBe('zone_not_found');
  });
});

describe('delivery lifecycle', () => {
  it('assigns, picks up, delivers with the code, and synchronises the order', async () => {
    const s = await setup({ zone: true });
    const manager = await user();
    await addMember(s.orgId, s.owner, manager, 'manager');
    const other = await user();
    const { order, deliveryId, proofCode, detail } = await placeOrder(s);

    // Code: 6 digits for the buyer only, stored hashed.
    expect(proofCode).toMatch(/^\d{6}$/);
    const seller = (await ctx.http.get(`/v1/orgs/${s.orgId}/orders/${order.id}`).set(bearer(s.owner.token)).expect(200)).body;
    expect(seller.delivery).toMatchObject({ id: deliveryId, proofCode: null, location: null });
    expect(JSON.stringify(seller)).not.toContain(proofCode);
    const { rows } = await ctx.sql.query('SELECT proof_hash, proof_nonce FROM deliveries WHERE id = $1', [deliveryId]);
    expect(rows[0].proof_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain(proofCode);
    expect(detail.delivery.orderNumber).toBe(order.number);

    // Rights: delivery role and buyers cannot dispatch; outsiders see nothing.
    await assign(s.orgId, s.courier, deliveryId, s.courier.id).expect(403);
    await assign(s.orgId, s.buyer, deliveryId, s.courier.id).expect(404);
    await ctx.http.get(`/v1/orgs/${s.orgId}/deliveries`).set(bearer(s.courier.token)).expect(403);
    await ctx.http.get(`/v1/orgs/${s.orgId}/deliveries`).set(bearer(other.token)).expect(404);
    const listed = (await ctx.http.get(`/v1/orgs/${s.orgId}/deliveries?status=pending`).set(bearer(manager.token)).expect(200)).body;
    expect(listed.items.map((d: any) => d.id)).toContain(deliveryId);
    expect(listed.items.every((d: any) => d.proofCode === null)).toBe(true);

    // Eligibility: a plain member (manager) cannot be assigned by someone else, the delivery member can, a stranger cannot.
    await assign(s.orgId, s.owner, deliveryId, manager.id).expect(400);
    await assign(s.orgId, s.owner, deliveryId, other.id).expect(400);
    await assign(s.orgId, s.owner, 'nope', s.courier.id).expect(404);

    // The courier has nothing before assignment.
    await ctx.http.get(`/v1/me/deliveries/${deliveryId}`).set(bearer(s.courier.token)).expect(404);
    // Self-assign by the seller, then reassign to the courier.
    const self = (await assign(s.orgId, s.owner, deliveryId, s.owner.id).expect(200)).body;
    expect(self).toMatchObject({ status: 'assigned', courier: { userId: s.owner.id } });
    const re = (await assign(s.orgId, s.owner, deliveryId, s.courier.id).expect(200)).body;
    expect(re.courier.userId).toBe(s.courier.id);
    expect(re.events.map((e: any) => [e.kind, e.status])).toEqual([['status', 'pending'], ['assignment', 'assigned'], ['assignment', 'assigned']]);
    // Idempotent for the same courier.
    expect((await assign(s.orgId, s.owner, deliveryId, s.courier.id).expect(200)).body.events).toHaveLength(3);
    await ctx.http.get(`/v1/me/deliveries/${deliveryId}`).set(bearer(s.owner.token)).expect(404);

    // Courier task: address and amount to collect, no code.
    const mine = (await ctx.http.get('/v1/me/deliveries').set(bearer(s.courier.token)).expect(200)).body;
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ id: deliveryId, status: 'assigned', totalMinor: 25_000, address: { city: 'Kinshasa' } });
    expect(JSON.stringify(mine)).not.toContain(proofCode);
    expect((await ctx.http.get('/v1/me/deliveries').set(bearer(other.token)).expect(200)).body.items).toHaveLength(0);
    await courierStatus(other, deliveryId, { status: 'picked_up' }).expect(404);

    // The order must be prepared before the pick-up.
    const notReady = await courierStatus(s.courier, deliveryId, { status: 'picked_up' }).expect(409);
    expect(notReady.body.error.details.reason).toBe('order_not_ready');
    await prepare(s, order.id);
    // Skipping steps is refused.
    await courierStatus(s.courier, deliveryId, { status: 'in_transit' }).expect(409);
    await courierStatus(s.courier, deliveryId, { status: 'delivered', code: proofCode }).expect(409);

    const picked = (await courierStatus(s.courier, deliveryId, { status: 'picked_up' }).expect(200)).body;
    expect(picked.status).toBe('picked_up');
    expect(await orderStatus(s, order.id)).toBe('shipped');
    // No reassignment once picked up.
    await assign(s.orgId, s.owner, deliveryId, s.owner.id).expect(409);

    await courierStatus(s.courier, deliveryId, { status: 'in_transit' }).expect(200);
    await courierStatus(s.courier, deliveryId, { status: 'delivered' }).expect(400); // code required
    const done = (await courierStatus(s.courier, deliveryId, { status: 'delivered', code: proofCode }).expect(200)).body;
    expect(done.status).toBe('delivered');
    expect(await orderStatus(s, order.id)).toBe('delivered');
    const after = (await ctx.http.get(`/v1/orders/${order.id}`).set(bearer(s.buyer.token)).expect(200)).body;
    expect(after.delivery).toMatchObject({ status: 'delivered', proofCode: null });
    expect(after.events.map((e: any) => e.status)).toEqual(['pending', 'confirmed', 'preparing', 'shipped', 'delivered']);
    await courierStatus(s.courier, deliveryId, { status: 'failed', reason: 'late' }).expect(409);

    // Rating: buyer only, once, 1 to 5.
    const rate = (who: TU, rating: number) =>
      ctx.http.post(`/v1/orders/${order.id}/delivery/rating`).set(bearer(who.token)).send({ rating, comment: 'Rapide' });
    await rate(other, 5).expect(404);
    await rate(s.buyer, 6).expect(400);
    const rated = (await rate(s.buyer, 5).expect(200)).body;
    expect(rated.rating).toBe(5);
    const again = await rate(s.buyer, 4).expect(409);
    expect(again.body.error.details.reason).toBe('already_rated');

    // Notifications: right people, category delivery, no address nor phone nor code.
    const buyerNotifs = (await notificationsOf(s.buyer)).filter((n: any) => n.category === 'delivery');
    expect(buyerNotifs.length).toBeGreaterThanOrEqual(3);
    const courierNotifs = (await notificationsOf(s.courier)).filter((n: any) => n.category === 'delivery');
    expect(courierNotifs.length).toBeGreaterThanOrEqual(2);
    const ownerNotifs = (await notificationsOf(s.owner)).filter((n: any) => n.category === 'delivery');
    expect(ownerNotifs.some((n: any) => n.body.includes('livrée'))).toBe(true);
    for (const n of [...buyerNotifs, ...courierNotifs, ...ownerNotifs]) {
      const text = `${n.title} ${n.body} ${JSON.stringify(n.data)}`;
      expect(text).not.toMatch(/avenue|\+243|Gombe|Awa/);
      expect(text).not.toContain(proofCode);
    }
    expect((await notificationsOf(other)).filter((n: any) => n.category === 'delivery')).toHaveLength(0);
  });

  it('locks the code after 5 wrong attempts until the seller resets it', async () => {
    const s = await setup();
    const { order, deliveryId, proofCode } = await placeOrder(s);
    await prepare(s, order.id);
    await assign(s.orgId, s.owner, deliveryId, s.courier.id).expect(200);
    await courierStatus(s.courier, deliveryId, { status: 'picked_up' }).expect(200);
    await courierStatus(s.courier, deliveryId, { status: 'in_transit' }).expect(200);

    const wrong = proofCode === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 1; left -= 1) {
      const res = await courierStatus(s.courier, deliveryId, { status: 'delivered', code: wrong }).expect(403);
      expect(res.body.error.details).toEqual({ reason: 'invalid_proof_code', remainingAttempts: left });
    }
    const fifth = await courierStatus(s.courier, deliveryId, { status: 'delivered', code: wrong }).expect(429);
    expect(fifth.body.error.details.reason).toBe('proof_locked');
    // Locked: even the right code is refused.
    const locked = await courierStatus(s.courier, deliveryId, { status: 'delivered', code: proofCode }).expect(429);
    expect(locked.body.error.details.reason).toBe('proof_locked');
    expect(await orderStatus(s, order.id)).toBe('shipped');
    const view = (await ctx.http.get(`/v1/orders/${order.id}`).set(bearer(s.buyer.token)).expect(200)).body.delivery;
    expect(view.proofLocked).toBe(true);
    expect((await notificationsOf(s.owner)).some((n: any) => n.category === 'delivery' && n.body.includes('verrouillé'))).toBe(true);

    // Only orders.manage resets; the buyer then reads a new code.
    await ctx.http.post(`/v1/orgs/${s.orgId}/deliveries/${deliveryId}/proof-reset`).set(bearer(s.courier.token)).expect(403);
    await ctx.http.post(`/v1/orgs/${s.orgId}/deliveries/${deliveryId}/proof-reset`).set(bearer(s.owner.token)).expect(200);
    const fresh = (await ctx.http.get(`/v1/orders/${order.id}`).set(bearer(s.buyer.token)).expect(200)).body.delivery;
    expect(fresh).toMatchObject({ proofLocked: false });
    expect(fresh.proofCode).toMatch(/^\d{6}$/);
    expect(fresh.proofCode).not.toBe(proofCode);
    // The old code is now wrong, the new one works.
    await courierStatus(s.courier, deliveryId, { status: 'delivered', code: proofCode }).expect(403);
    await courierStatus(s.courier, deliveryId, { status: 'delivered', code: fresh.proofCode }).expect(200);
    expect(await orderStatus(s, order.id)).toBe('delivered');

    const detail = (await ctx.http.get(`/v1/orgs/${s.orgId}/deliveries/${deliveryId}`).set(bearer(s.owner.token)).expect(200)).body;
    expect(detail.events.filter((e: any) => e.kind === 'proof').map((e: any) => e.note)).toContain('proof_locked');
    // Events are append-only at the database level.
    await expect(ctx.sql.query(`UPDATE delivery_events SET note = 'x' WHERE delivery_id = $1`, [deliveryId])).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`DELETE FROM delivery_events WHERE delivery_id = $1`, [deliveryId])).rejects.toThrow(/append-only/);
  });

  it('handles incidents, failures, returns, and a cancelled order', async () => {
    const s = await setup();
    const a = await placeOrder(s);
    await prepare(s, a.order.id);
    await assign(s.orgId, s.owner, a.deliveryId, s.courier.id).expect(200);
    await courierStatus(s.courier, a.deliveryId, { status: 'picked_up' }).expect(200);

    const inc = await ctx.http.post(`/v1/me/deliveries/${a.deliveryId}/incident`).set(bearer(s.courier.token)).send({ reason: 'Client injoignable' }).expect(200);
    expect(inc.body.status).toBe('picked_up');
    await ctx.http.post(`/v1/me/deliveries/${a.deliveryId}/incident`).set(bearer(s.buyer.token)).send({ reason: 'x' }).expect(404);
    expect((await notificationsOf(s.owner)).some((n: any) => n.category === 'delivery' && n.body.includes('incident'))).toBe(true);

    await courierStatus(s.courier, a.deliveryId, { status: 'failed' }).expect(400); // reason required
    const failed = (await courierStatus(s.courier, a.deliveryId, { status: 'failed', reason: 'Client injoignable' }).expect(200)).body;
    expect(failed).toMatchObject({ status: 'failed', failureReason: 'Client injoignable' });
    // No rating on a failed delivery; the courier cannot re-deliver; the seller records the return.
    await ctx.http.post(`/v1/orders/${a.order.id}/delivery/rating`).set(bearer(s.buyer.token)).send({ rating: 3 }).expect(409);
    await courierStatus(s.courier, a.deliveryId, { status: 'in_transit' }).expect(409);
    await ctx.http.post(`/v1/orgs/${s.orgId}/deliveries/${a.deliveryId}/status`).set(bearer(s.courier.token)).send({ status: 'returned', reason: 'ok' }).expect(403);
    const returned = (await ctx.http.post(`/v1/orgs/${s.orgId}/deliveries/${a.deliveryId}/status`).set(bearer(s.owner.token)).send({ status: 'returned', reason: 'Colis rendu' }).expect(200)).body;
    expect(returned.status).toBe('returned');
    expect((await notificationsOf(s.buyer)).some((n: any) => n.category === 'delivery' && n.body.includes('échoué'))).toBe(true);

    // A cancelled order ends its pending delivery and tells the courier.
    const b = await placeOrder(s);
    await assign(s.orgId, s.owner, b.deliveryId, s.courier.id).expect(200);
    await setStatus(s.orgId, s.owner, b.order.id, 'cancelled').expect(200);
    const gone = (await ctx.http.get(`/v1/orgs/${s.orgId}/deliveries/${b.deliveryId}`).set(bearer(s.owner.token)).expect(200)).body;
    expect(gone).toMatchObject({ status: 'failed', failureReason: 'order_cancelled' });
    await assign(s.orgId, s.owner, b.deliveryId, s.courier.id).expect(409);
    expect((await notificationsOf(s.courier)).some((n: any) => n.category === 'delivery' && n.body.includes('annulée'))).toBe(true);

    // Seller gives up on an unassigned delivery.
    const c = await placeOrder(s);
    await ctx.http.post(`/v1/orgs/${s.orgId}/deliveries/${c.deliveryId}/status`).set(bearer(s.owner.token)).send({ status: 'returned', reason: 'x' }).expect(409);
    await ctx.http.post(`/v1/orgs/${s.orgId}/deliveries/${c.deliveryId}/status`).set(bearer(s.owner.token)).send({ status: 'failed', reason: 'Hors zone' }).expect(200);
  });

  it('refuses a courier who left the organisation', async () => {
    const s = await setup();
    const { order, deliveryId } = await placeOrder(s);
    await prepare(s, order.id);
    await assign(s.orgId, s.owner, deliveryId, s.courier.id).expect(200);
    await ctx.sql.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [s.orgId, s.courier.id]);
    await courierStatus(s.courier, deliveryId, { status: 'picked_up' }).expect(403);
  });
});

describe('courier position', () => {
  it('needs consent and the in_transit status, reaches the buyer only, keeps the last point, and is erased at the end', async () => {
    const s = await setup();
    const { order, deliveryId, proofCode } = await placeOrder(s);
    await prepare(s, order.id);
    await assign(s.orgId, s.owner, deliveryId, s.courier.id).expect(200);
    const post = (who: TU, lat: number, lng: number) =>
      ctx.http.post(`/v1/me/deliveries/${deliveryId}/location`).set(bearer(who.token)).send({ lat, lng });

    const realtime = ctx.app.get(RealtimeService);
    const emitOrder = vi.spyOn(realtime, 'emitToOrder');
    const joinOrder = vi.spyOn(realtime, 'addToOrder');

    // Not in transit yet.
    const early = await post(s.courier, 1, 1).expect(409);
    expect(early.body.error.details.reason).toBe('not_in_transit');
    await courierStatus(s.courier, deliveryId, { status: 'picked_up' }).expect(200);
    await courierStatus(s.courier, deliveryId, { status: 'in_transit' }).expect(200);
    // No consent.
    const noConsent = await post(s.courier, -4.3, 15.3).expect(403);
    expect(noConsent.body.error.details.reason).toBe('location_consent_required');
    // Only the courier of the delivery can consent or post.
    await ctx.http.put(`/v1/me/deliveries/${deliveryId}/location-consent`).set(bearer(s.buyer.token)).send({ granted: true }).expect(404);
    await post(s.buyer, 1, 1).expect(404);
    await post(s.courier, 91, 0).expect(400);
    await ctx.http.put(`/v1/me/deliveries/${deliveryId}/location-consent`).set(bearer(s.courier.token)).send({ granted: true }).expect(200);

    await post(s.courier, -4.3, 15.3).expect(204);
    await post(s.courier, -4.31, 15.32).expect(204);
    // Pushed to the room of the order, which only the buyer joins.
    expect(joinOrder).toHaveBeenCalledWith([s.buyer.id], order.id);
    expect(emitOrder).toHaveBeenLastCalledWith(order.id, 'delivery.location', expect.objectContaining({ orderId: order.id, deliveryId, lat: -4.31, lng: 15.32 }));
    expect(emitOrder.mock.calls.every(([id]) => id === order.id)).toBe(true);

    // Last point only: the buyer reads it, nobody else does.
    const buyerView = (await ctx.http.get(`/v1/orders/${order.id}`).set(bearer(s.buyer.token)).expect(200)).body.delivery;
    expect(buyerView.location).toMatchObject({ lat: -4.31, lng: 15.32 });
    const sellerView = (await ctx.http.get(`/v1/orgs/${s.orgId}/orders/${order.id}`).set(bearer(s.owner.token)).expect(200)).body.delivery;
    expect(sellerView.location).toBeNull();
    const orgDelivery = (await ctx.http.get(`/v1/orgs/${s.orgId}/deliveries/${deliveryId}`).set(bearer(s.owner.token)).expect(200)).body;
    expect(orgDelivery.location).toBeNull();
    expect(JSON.stringify(orgDelivery.events)).not.toContain('15.3');
    const courierView = (await ctx.http.get(`/v1/me/deliveries/${deliveryId}`).set(bearer(s.courier.token)).expect(200)).body;
    expect(courierView).not.toHaveProperty('location');
    const rows = await ctx.sql.query('SELECT count(*)::int AS n FROM deliveries WHERE id = $1 AND last_lat = -4.31', [deliveryId]);
    expect(rows.rows[0].n).toBe(1);

    // Withdrawing the consent erases the point; posting again is refused.
    await ctx.http.put(`/v1/me/deliveries/${deliveryId}/location-consent`).set(bearer(s.courier.token)).send({ granted: false }).expect(200);
    expect((await ctx.http.get(`/v1/orders/${order.id}`).set(bearer(s.buyer.token))).body.delivery.location).toBeNull();
    await post(s.courier, 1, 1).expect(403);
    await ctx.http.put(`/v1/me/deliveries/${deliveryId}/location-consent`).set(bearer(s.courier.token)).send({ granted: true }).expect(200);
    await post(s.courier, -4.32, 15.33).expect(204);

    // Erased at the end of the delivery.
    const removeOrder = vi.spyOn(realtime, 'removeFromOrder');
    await courierStatus(s.courier, deliveryId, { status: 'delivered', code: proofCode }).expect(200);
    const gone = await ctx.sql.query('SELECT last_lat, last_lng, last_location_at FROM deliveries WHERE id = $1', [deliveryId]);
    expect(gone.rows[0]).toEqual({ last_lat: null, last_lng: null, last_location_at: null });
    expect(removeOrder).toHaveBeenCalledWith([s.buyer.id], order.id);
    expect((await ctx.http.get(`/v1/orders/${order.id}`).set(bearer(s.buyer.token))).body.delivery.location).toBeNull();
    await post(s.courier, 1, 1).expect(409);
  });
});

describe('export', () => {
  it('lists deliveries as buyer and as courier, without code nor position', async () => {
    const s = await setup();
    const { order, deliveryId, proofCode } = await placeOrder(s);
    await prepare(s, order.id);
    await assign(s.orgId, s.owner, deliveryId, s.courier.id).expect(200);
    await courierStatus(s.courier, deliveryId, { status: 'picked_up' }).expect(200);
    await courierStatus(s.courier, deliveryId, { status: 'in_transit' }).expect(200);
    await courierStatus(s.courier, deliveryId, { status: 'delivered', code: proofCode }).expect(200);
    await ctx.http.post(`/v1/orders/${order.id}/delivery/rating`).set(bearer(s.buyer.token)).send({ rating: 4, comment: 'Bien' }).expect(200);

    const buyerExport = (await ctx.http.get('/v1/me/export').set(bearer(s.buyer.token)).expect(200)).body;
    expect(buyerExport.deliveries).toEqual([
      expect.objectContaining({ orderNumber: order.number, role: 'buyer', status: 'delivered', rating: 4, ratingComment: 'Bien' }),
    ]);
    const courierExport = (await ctx.http.get('/v1/me/export').set(bearer(s.courier.token)).expect(200)).body;
    expect(courierExport.deliveries).toEqual([expect.objectContaining({ orderNumber: order.number, role: 'courier', rating: 4 })]);
    expect(JSON.stringify(buyerExport.deliveries)).not.toContain(proofCode);
  });
});

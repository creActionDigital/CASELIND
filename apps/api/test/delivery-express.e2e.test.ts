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
    .send({ slug: `express-${Date.now().toString(36)}-${slugCounter}`, name: 'Boutique Express', kind: 'shop' })
    .expect(201);
  return res.body.id;
}

async function addMember(orgId: string, inviter: TU, invitee: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(inviter.token)).send({ handle: invitee.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(invitee.token)).expect(200);
}

const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix', line2: 'Gombe' };
const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

const createZone = (orgId: string, who: TU, body: Record<string, unknown> = {}) =>
  ctx.http
    .post(`/v1/orgs/${orgId}/delivery-zones`)
    .set(bearer(who.token))
    .send({ name: 'Kinshasa centre', areas: ['Kinshasa', 'Gombe'], fees: { CDF: 5_000 }, expressFees: { CDF: 2_000 }, etaMinutes: 90, ...body });

interface Setup {
  owner: TU;
  courier: TU;
  buyer: TU;
  orgId: string;
  variant: string;
  zoneId: string | null;
}

async function setup(zone: Record<string, unknown> | false = {}): Promise<Setup> {
  const owner = await user();
  const courier = await user();
  const buyer = await user();
  const orgId = await createOrg(owner);
  await addMember(orgId, owner, courier, 'delivery');
  const variant = fake.add({ orgId, currency: 'CDF', price: 10_000, stock: 100 });
  const zoneId = zone === false ? null : ((await createZone(orgId, owner, zone).expect(201)).body.id as string);
  return { owner, courier, buyer, orgId, variant, zoneId };
}

/** One order of 2 items (20 000 CDF) with the options given. */
async function order(s: Setup, extra: Record<string, unknown> = {}) {
  await ctx.http.put(`/v1/cart/items/${s.variant}`).set(bearer(s.buyer.token)).send({ quantity: 2 }).expect(200);
  return ctx.http
    .post('/v1/orders/checkout')
    .set(bearer(s.buyer.token))
    .send({
      clientId: randomUUID(),
      address: ADDRESS,
      paymentMethod: 'cash_on_delivery',
      ...(s.zoneId ? { zones: [{ orgId: s.orgId, zoneId: s.zoneId }] } : {}),
      ...extra,
    });
}

const placed = async (s: Setup, extra: Record<string, unknown> = {}) => {
  const r = await order(s, extra);
  expect(r.status).toBe(201);
  return r.body.orders[0] as { id: string; deliveryFeeMinor: number; totalMinor: number };
};

const deliveryOf = async (s: Setup, orderId: string) =>
  (await ctx.http.get(`/v1/orders/${orderId}`).set(bearer(s.buyer.token)).expect(200)).body.delivery;

describe('express supplement', () => {
  it('is stored per zone, added by the server to the frozen fee, and ignores anything the client sends', async () => {
    const s = await setup();
    const zones = (await ctx.http.get(`/v1/delivery/orgs/${s.orgId}/zones`).set(bearer(s.buyer.token)).expect(200)).body.items;
    expect(zones[0].expressFees).toEqual({ CDF: 2_000 });

    const standard = await placed(s);
    expect(standard.deliveryFeeMinor).toBe(5_000);
    expect(standard.totalMinor).toBe(25_000);
    expect(await deliveryOf(s, standard.id)).toMatchObject({ speed: 'standard', scheduledFor: null });

    const express = await placed(s, { speed: 'express', deliveryFeeMinor: 1, expressFeeMinor: 1 });
    expect(express.deliveryFeeMinor).toBe(7_000);
    expect(express.totalMinor).toBe(27_000);
    expect(await deliveryOf(s, express.id)).toMatchObject({ speed: 'express' });

    // A later change of the zone does not touch the frozen order.
    await ctx.http.patch(`/v1/orgs/${s.orgId}/delivery-zones/${s.zoneId}`).set(bearer(s.owner.token)).send({ expressFees: { CDF: 9_000 } }).expect(200);
    const again = (await ctx.http.get(`/v1/orders/${express.id}`).set(bearer(s.buyer.token)).expect(200)).body;
    expect(again.deliveryFeeMinor).toBe(7_000);
  });

  it('is refused (409) when the zone offers none, the seller has no zone, or the currency has no supplement', async () => {
    const noExpress = await setup({ expressFees: null });
    const r1 = await order(noExpress, { speed: 'express' });
    expect(r1.status).toBe(409);
    expect(r1.body.error.details.reason).toBe('express_unavailable');
    // The same cart still checks out as standard: nothing was kept by the refusal.
    await placed(noExpress);

    const noZone = await setup(false);
    const r2 = await order(noZone, { speed: 'express' });
    expect(r2.status).toBe(409);
    expect(r2.body.error.details.reason).toBe('express_unavailable');

    const otherCurrency = await setup({ expressFees: { USD: 100 } });
    expect((await order(otherCurrency, { speed: 'express' })).status).toBe(409);
  });

  it('can be removed from a zone with null, and only the seller manages it', async () => {
    const s = await setup();
    await ctx.http.patch(`/v1/orgs/${s.orgId}/delivery-zones/${s.zoneId}`).set(bearer(s.courier.token)).send({ expressFees: null }).expect(403);
    const patched = await ctx.http.patch(`/v1/orgs/${s.orgId}/delivery-zones/${s.zoneId}`).set(bearer(s.owner.token)).send({ expressFees: null }).expect(200);
    expect(patched.body.expressFees).toBeNull();
    await createZone(s.orgId, s.owner, { expressFees: { cdf: 5 } }).expect(400);
  });
});

describe('scheduled slot', () => {
  it('must be between 2 hours and 7 days ahead, and is refused for a pick-up', async () => {
    const s = await setup();
    for (const bad of [inHours(1), inHours(-3), inHours(24 * 7 + 1)]) {
      const r = await order(s, { scheduledFor: bad });
      expect(r.status).toBe(400);
      expect(r.body.error.details[0]).toMatchObject({ path: 'scheduledFor', reason: 'schedule_out_of_range' });
    }
    expect((await order(s, { scheduledFor: 'tomorrow' })).status).toBe(400);
    const slot = inHours(5);
    const ok = await placed(s, { scheduledFor: slot });
    const delivery = await deliveryOf(s, ok.id);
    expect(new Date(delivery.scheduledFor).getTime()).toBe(new Date(slot).getTime());

    const pickup = await order(s, { fulfillment: 'pickup', address: undefined, zones: undefined, scheduledFor: slot });
    expect(pickup.status).toBe(400);
    const pickupExpress = await order(s, { fulfillment: 'pickup', address: undefined, zones: undefined, speed: 'express' });
    expect(pickupExpress.status).toBe(400);
  });
});

describe('courier task list', () => {
  it('shows a scheduled delivery 60 minutes before its slot only, and express first', async () => {
    const s = await setup();
    const standard = await placed(s);
    const scheduled = await placed(s, { scheduledFor: inHours(5) });
    const express = await placed(s, { speed: 'express' });
    const ids: Record<string, string> = {};
    for (const [name, o] of Object.entries({ standard, scheduled, express })) ids[name] = (await deliveryOf(s, o.id)).id;
    for (const id of Object.values(ids)) {
      await ctx.http.post(`/v1/orgs/${s.orgId}/deliveries/${id}/assign`).set(bearer(s.owner.token)).send({ courierUserId: s.courier.id }).expect(200);
    }
    const mine = async () =>
      (await ctx.http.get('/v1/me/deliveries?scope=active').set(bearer(s.courier.token)).expect(200)).body.items as { id: string; speed: string; scheduledFor: string | null }[];

    let list = await mine();
    expect(list.map((d) => d.id)).toEqual([ids.express, ids.standard]);
    expect(list[0]).toMatchObject({ speed: 'express', scheduledFor: null });
    // Direct access still works (the courier can open it by id).
    await ctx.http.get(`/v1/me/deliveries/${ids.scheduled}`).set(bearer(s.courier.token)).expect(200);

    // 90 minutes before the slot: still hidden; 50 minutes before: visible, after the express one.
    await ctx.sql.query(`UPDATE deliveries SET scheduled_for = now() + interval '90 minutes' WHERE id = $1`, [ids.scheduled]);
    expect((await mine()).map((d) => d.id)).not.toContain(ids.scheduled);
    await ctx.sql.query(`UPDATE deliveries SET scheduled_for = now() + interval '50 minutes' WHERE id = $1`, [ids.scheduled]);
    list = await mine();
    expect(list.map((d) => d.id)).toEqual([ids.express, ids.scheduled, ids.standard]);
    expect(list[1]!.scheduledFor).not.toBeNull();
  });
});

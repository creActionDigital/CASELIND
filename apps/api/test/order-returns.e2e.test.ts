import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CatalogPort } from '../src/commerce/catalog.port.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { WebhookService } from '../src/webhooks/webhooks.service.js';
import { FakeCatalog, installFakeCatalog } from './fake-catalog.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
const fake = new FakeCatalog();
let emit: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  ctx = await createTestContext();
  installFakeCatalog(ctx, fake);
  emit = vi.spyOn(ctx.app.get(WebhookService), 'emit');
  await ctx.sql.query(`INSERT INTO feature_flags (key, description, enabled) VALUES ('commerce', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`);
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
  if (roles) await ctx.sql.query(`UPDATE users SET roles = $1::text[] WHERE id = $2`, [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

let slug = 0;
async function createOrg(owner: TU): Promise<string> {
  slug += 1;
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `ret-${Date.now().toString(36)}-${slug}`, name: 'Boutique Retours', kind: 'shop' }).expect(201);
  return res.body.id;
}

async function addMember(orgId: string, inviter: TU, invitee: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(inviter.token)).send({ handle: invitee.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(invitee.token)).expect(200);
}

const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix' };
const SECRET_TEXT = 'SECRETTEXT-zebra';

interface Setup {
  owner: TU;
  orgId: string;
  buyer: TU;
  a: string;
  b: string;
  order: any;
  itemA: any;
  itemB: any;
}

/** A seller, a buyer, and an order of 2 x a (10 000) + 2 x b (2 500), optionally walked to `delivered`. */
async function setup(opts: { deliver?: boolean; coupon?: boolean } = {}): Promise<Setup> {
  const owner = await user();
  const orgId = await createOrg(owner);
  const a = fake.add({ orgId, currency: 'CDF', price: 10_000, stock: 50 });
  const b = fake.add({ orgId, currency: 'CDF', price: 2_500, stock: 50 });
  const buyer = await user();
  await ctx.http.put(`/v1/cart/items/${a}`).set(bearer(buyer.token)).send({ quantity: 2 }).expect(200);
  await ctx.http.put(`/v1/cart/items/${b}`).set(bearer(buyer.token)).send({ quantity: 2 }).expect(200);
  const extra: Record<string, unknown> = {};
  if (opts.coupon) {
    await ctx.http.post(`/v1/orgs/${orgId}/coupons`).set(bearer(owner.token)).send({ code: 'MOINS10', kind: 'percent', value: 10 }).expect(201);
    extra.couponCodes = ['MOINS10'];
  }
  const order = (await ctx.http.post('/v1/orders/checkout').set(bearer(buyer.token)).send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery', ...extra }).expect(201)).body.orders[0];
  if (opts.deliver !== false) {
    for (const status of ['confirmed', 'preparing', 'shipped', 'delivered']) await ctx.http.post(`/v1/orgs/${orgId}/orders/${order.id}/status`).set(bearer(owner.token)).send({ status }).expect(200);
  }
  const itemA = order.items.find((i: any) => i.variantId === a);
  const itemB = order.items.find((i: any) => i.variantId === b);
  return { owner, orgId, buyer, a, b, order, itemA, itemB };
}

const ask = (s: Setup, body: Record<string, unknown> = {}, who: TU = s.buyer) =>
  ctx.http.post(`/v1/orders/${s.order.id}/returns`).set(bearer(who.token)).send({ reason: 'defective', details: SECRET_TEXT, items: [{ orderItemId: s.itemA.id, quantity: 1 }], ...body });

const orgStep = (s: Setup, id: string, step: string, body: Record<string, unknown> = {}, who: TU = s.owner) =>
  ctx.http.post(`/v1/orgs/${s.orgId}/returns/${id}/${step}`).set(bearer(who.token)).send(body);

const buyerStep = (s: Setup, id: string, step: string, body: Record<string, unknown> = {}, who: TU = s.buyer) =>
  ctx.http.post(`/v1/returns/${id}/${step}`).set(bearer(who.token)).send(body);

const notificationsOf = async (u: TU) => (await ctx.http.get('/v1/notifications').set(bearer(u.token)).expect(200)).body.items;

/** order_events is append-only: the trigger is lifted for the time of the fixture. */
async function ageDelivery(orderId: string, days: number): Promise<void> {
  await ctx.sql.query('ALTER TABLE order_events DISABLE TRIGGER order_events_no_update');
  try {
    await ctx.sql.query(`UPDATE order_events SET created_at = now() - ($2 || ' days')::interval WHERE order_id = $1 AND status = 'delivered'`, [orderId, String(days)]);
  } finally {
    await ctx.sql.query('ALTER TABLE order_events ENABLE TRIGGER order_events_no_update');
  }
}

describe('request', () => {
  it('needs a delivered order, computes the refund on the server and allows one live request', async () => {
    const s = await setup({ deliver: false });
    const early = await ask(s).expect(409);
    expect(early.body.error.details.reason).toBe('not_delivered');
    for (const status of ['confirmed', 'preparing', 'shipped', 'delivered']) await ctx.http.post(`/v1/orgs/${s.orgId}/orders/${s.order.id}/status`).set(bearer(s.owner.token)).send({ status }).expect(200);

    // The client cannot set the amount (unknown keys are ignored) and cannot return more than it bought.
    const res = await ask(s, { refundMinor: 1, items: [{ orderItemId: s.itemA.id, quantity: 1 }, { orderItemId: s.itemB.id, quantity: 2 }] }).expect(201);
    expect(res.body).toMatchObject({ status: 'requested', reason: 'defective', refundMinor: 15_000, currency: 'CDF', orderNumber: s.order.number, requestedBy: s.buyer.id, restock: false, resolution: null });
    expect(res.body.items).toEqual([
      expect.objectContaining({ orderItemId: s.itemA.id, variantId: s.a, quantity: 1, unitPriceMinor: 10_000 }),
      expect.objectContaining({ orderItemId: s.itemB.id, variantId: s.b, quantity: 2, unitPriceMinor: 2_500 }),
    ]);
    expect(res.body.events).toEqual([expect.objectContaining({ status: 'requested', fromStatus: null, actorKind: 'buyer' })]);
    expect(emit).toHaveBeenCalledWith(s.orgId, 'order.return_requested', { orderId: s.order.id, returnId: res.body.id, number: s.order.number, status: 'requested', refundMinor: 15_000, currency: 'CDF' });

    const again = await ask(s).expect(409);
    expect(again.body.error.details.reason).toBe('return_exists');
    const list = (await ctx.http.get(`/v1/orders/${s.order.id}/returns`).set(bearer(s.buyer.token)).expect(200)).body;
    expect(list).toMatchObject({ canRequest: false, items: [{ id: res.body.id }] });
    expect(Date.parse(list.windowEndsAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
  });

  it('refuses excessive, duplicate, unknown and foreign lines', async () => {
    const s = await setup();
    const other = await setup();
    await ask(s, { items: [{ orderItemId: s.itemA.id, quantity: 3 }] }).expect(400);
    await ask(s, { items: [{ orderItemId: s.itemA.id, quantity: 0 }] }).expect(400);
    await ask(s, { items: [{ orderItemId: s.itemA.id, quantity: 1 }, { orderItemId: s.itemA.id, quantity: 1 }] }).expect(400);
    await ask(s, { items: [] }).expect(400);
    await ask(s, { items: [{ orderItemId: randomUUID(), quantity: 1 }] }).expect(400);
    await ask(s, { items: [{ orderItemId: other.itemA.id, quantity: 1 }] }).expect(400);
    await ask(s, { reason: 'because' }).expect(400);
    await ask(s, { details: 'x'.repeat(501) }).expect(400);
    expect((await ctx.sql.query('SELECT count(*)::int AS n FROM order_returns WHERE order_id = $1', [s.order.id])).rows[0].n).toBe(0);
  });

  it('shares the order coupon between the returned lines', async () => {
    const s = await setup({ coupon: true });
    // subtotal 25 000, discount 2 500: two b = 5 000 gross -> 4 500 due.
    const res = await ask(s, { items: [{ orderItemId: s.itemB.id, quantity: 2 }] }).expect(201);
    expect(res.body.refundMinor).toBe(4_500);
  });

  it('closes 7 days after the delivery', async () => {
    const s = await setup();
    await ageDelivery(s.order.id, 8);
    const res = await ask(s).expect(409);
    expect(res.body.error.details.reason).toBe('window_closed');
    const list = (await ctx.http.get(`/v1/orders/${s.order.id}/returns`).set(bearer(s.buyer.token)).expect(200)).body;
    expect(list).toMatchObject({ canRequest: false, items: [] });

    const fresh = await setup();
    await ageDelivery(fresh.order.id, 6);
    await ask(fresh).expect(201);
  });

  it('is private: an order of someone else is a 404, and the buyer is authenticated', async () => {
    const s = await setup();
    const stranger = await user();
    await ask(s, {}, stranger).expect(404);
    await ctx.http.get(`/v1/orders/${s.order.id}/returns`).set(bearer(stranger.token)).expect(404);
    await ctx.http.get(`/v1/orders/not-a-uuid/returns`).set(bearer(s.buyer.token)).expect(404);
    await ctx.http.post(`/v1/orders/${s.order.id}/returns`).send({}).expect(401);
  });
});

describe('seller steps', () => {
  it('walks requested, approved, received (restocked) and refunded, with history', async () => {
    const s = await setup();
    const stockBefore = fake.variants.get(s.a)!.stock;
    const r = (await ask(s, { items: [{ orderItemId: s.itemA.id, quantity: 2 }] }).expect(201)).body;
    const listed = (await ctx.http.get(`/v1/orgs/${s.orgId}/returns`).set(bearer(s.owner.token)).expect(200)).body;
    expect(listed.items).toEqual([expect.objectContaining({ id: r.id, status: 'requested', details: SECRET_TEXT })]);

    const approved = (await orgStep(s, r.id, 'approve', { note: 'Ok, rapportez-le' }).expect(200)).body;
    expect(approved).toMatchObject({ status: 'approved', sellerNote: 'Ok, rapportez-le', resolution: 'refund_buyer' });
    await buyerStep(s, r.id, 'cancel').expect(409); // decided: too late to cancel
    await orgStep(s, r.id, 'approve').expect(409);

    const release = vi.mocked(ctx.app.get(CatalogPort).release);
    release.mockClear();
    const received = (await orgStep(s, r.id, 'received', { restock: true }).expect(200)).body;
    expect(received).toMatchObject({ status: 'received', restock: true });
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]![1]).toEqual([{ variantId: s.a, quantity: 2 }]);
    expect(release.mock.calls[0]![2]).toEqual({ reason: 'return_restocked', promos: [] });
    expect(fake.variants.get(s.a)!.stock).toBe(stockBefore + 2);
    await orgStep(s, r.id, 'received').expect(409);

    await orgStep(s, r.id, 'refunded', { amountMinor: 20_001 }).expect(400); // more than due
    const refunded = (await orgStep(s, r.id, 'refunded', { amountMinor: 18_000 }).expect(200)).body;
    expect(refunded).toMatchObject({ status: 'refunded', refundMinor: 20_000, refundedMinor: 18_000 });
    expect(refunded.events.map((e: any) => [e.fromStatus, e.status, e.actorKind])).toEqual([
      [null, 'requested', 'buyer'],
      ['requested', 'approved', 'org'],
      ['approved', 'received', 'org'],
      ['received', 'refunded', 'org'],
    ]);
    await orgStep(s, r.id, 'refunded').expect(409);
  });

  it('refunds without restock straight after approval; refused on a returned item stays out of stock', async () => {
    const s = await setup();
    const stockBefore = fake.variants.get(s.a)!.stock;
    const r = (await ask(s).expect(201)).body;
    await orgStep(s, r.id, 'refunded').expect(409); // not approved yet
    await orgStep(s, r.id, 'approve').expect(200);
    const done = (await orgStep(s, r.id, 'refunded').expect(200)).body;
    expect(done).toMatchObject({ status: 'refunded', refundedMinor: 10_000, restock: false });
    expect(fake.variants.get(s.a)!.stock).toBe(stockBefore);

    const s2 = await setup();
    const r2 = (await ask(s2).expect(201)).body;
    await orgStep(s2, r2.id, 'approve').expect(200);
    const before = fake.variants.get(s2.a)!.stock;
    await orgStep(s2, r2.id, 'received', { restock: false }).expect(200);
    expect(fake.variants.get(s2.a)!.stock).toBe(before);
  });

  it('rejects, and filters the list by status with a cursor', async () => {
    const s = await setup();
    const r = (await ask(s).expect(201)).body;
    const rejected = (await orgStep(s, r.id, 'reject', { note: 'Hors garantie' }).expect(200)).body;
    expect(rejected).toMatchObject({ status: 'rejected', resolution: 'reject', sellerNote: 'Hors garantie' });
    await orgStep(s, r.id, 'approve').expect(409);
    const byStatus = (await ctx.http.get(`/v1/orgs/${s.orgId}/returns?status=rejected`).set(bearer(s.owner.token)).expect(200)).body;
    expect(byStatus.items).toHaveLength(1);
    expect((await ctx.http.get(`/v1/orgs/${s.orgId}/returns?status=requested`).set(bearer(s.owner.token)).expect(200)).body.items).toHaveLength(0);
    await ctx.http.get(`/v1/orgs/${s.orgId}/returns?status=nope`).set(bearer(s.owner.token)).expect(400);

    // Cursor pagination over two returns of the same organisation.
    const second = await (async () => {
      const a = fake.add({ orgId: s.orgId, currency: 'CDF', price: 1_000, stock: 5 });
      const buyer = await user();
      await ctx.http.put(`/v1/cart/items/${a}`).set(bearer(buyer.token)).send({ quantity: 1 }).expect(200);
      const order = (await ctx.http.post('/v1/orders/checkout').set(bearer(buyer.token)).send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery' }).expect(201)).body.orders[0];
      for (const st of ['confirmed', 'preparing', 'shipped', 'delivered']) await ctx.http.post(`/v1/orgs/${s.orgId}/orders/${order.id}/status`).set(bearer(s.owner.token)).send({ status: st }).expect(200);
      await ctx.http.post(`/v1/orders/${order.id}/returns`).set(bearer(buyer.token)).send({ reason: 'changed_mind', items: [{ orderItemId: order.items[0].id, quantity: 1 }] }).expect(201);
    })();
    void second;
    const p1 = (await ctx.http.get(`/v1/orgs/${s.orgId}/returns?limit=1`).set(bearer(s.owner.token)).expect(200)).body;
    expect(p1.items).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = (await ctx.http.get(`/v1/orgs/${s.orgId}/returns?limit=1&cursor=${p1.nextCursor}`).set(bearer(s.owner.token)).expect(200)).body;
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0].id).not.toBe(p1.items[0].id);
  });

  it('needs orders.manage and stays inside the organisation', async () => {
    const s = await setup();
    const r = (await ask(s).expect(201)).body;
    const support = await user();
    await addMember(s.orgId, s.owner, support, 'support'); // orders.view only
    const sales = await user();
    await addMember(s.orgId, s.owner, sales, 'sales'); // orders.manage
    await ctx.http.get(`/v1/orgs/${s.orgId}/returns`).set(bearer(support.token)).expect(403);
    await orgStep(s, r.id, 'approve', {}, support).expect(403);
    await orgStep(s, r.id, 'approve', {}, s.buyer).expect(404); // not a member: the organisation is not disclosed
    const foreign = await setup();
    await ctx.http.post(`/v1/orgs/${foreign.orgId}/returns/${r.id}/approve`).set(bearer(foreign.owner.token)).send({}).expect(404);
    await orgStep(s, randomUUID(), 'approve').expect(404);
    await orgStep(s, 'not-a-uuid', 'approve').expect(404);
    await orgStep(s, r.id, 'approve', {}, sales).expect(200);
  });
});

describe('buyer steps', () => {
  it('cancels before a decision and can ask again, but cannot touch a return of someone else', async () => {
    const s = await setup();
    const r = (await ask(s).expect(201)).body;
    const stranger = await user();
    await buyerStep(s, r.id, 'cancel', {}, stranger).expect(404);
    await buyerStep(s, r.id, 'dispute', { reason: 'Non' }, s.buyer).expect(409); // only after a rejection
    const cancelled = (await buyerStep(s, r.id, 'cancel').expect(200)).body;
    expect(cancelled.status).toBe('cancelled');
    await buyerStep(s, r.id, 'cancel').expect(409);
    await orgStep(s, r.id, 'approve').expect(409);
    const second = (await ask(s, { reason: 'wrong_item' }).expect(201)).body;
    expect(second.id).not.toBe(r.id);
    await ask(s).expect(409);
  });
});

describe('claims centre', () => {
  it('lists only my own claims, filters by status and needs authentication', async () => {
    const s = await setup();
    const r = (await ask(s).expect(201)).body;
    const stranger = await user();
    const mine = (await ctx.http.get('/v1/me/returns').set(bearer(s.buyer.token)).expect(200)).body;
    expect(mine.items.map((x: any) => x.id)).toEqual([r.id]);
    expect((await ctx.http.get('/v1/me/returns').set(bearer(stranger.token)).expect(200)).body.items).toEqual([]);
    expect((await ctx.http.get('/v1/me/returns?status=approved').set(bearer(s.buyer.token)).expect(200)).body.items).toEqual([]);
    expect((await ctx.http.get('/v1/me/returns?status=requested').set(bearer(s.buyer.token)).expect(200)).body.items).toHaveLength(1);
    await ctx.http.get('/v1/me/returns').expect(401);
  });
});

describe('dispute', () => {
  it('escalates a rejection, is arbitrated by admin or support only, and the seller then settles it', async () => {
    const s = await setup();
    const admin = await user(['user', 'admin']);
    const support = await user(['user', 'support']);
    const plain = await user();
    const r = (await ask(s).expect(201)).body;
    await orgStep(s, r.id, 'reject', { note: 'Non' }).expect(200);
    await buyerStep(s, r.id, 'dispute', { reason: 'x'.repeat(501) }).expect(400);
    const disputed = (await buyerStep(s, r.id, 'dispute', { reason: 'Le produit est cassé' }).expect(200)).body;
    expect(disputed).toMatchObject({ status: 'disputed', disputeReason: 'Le produit est cassé' });
    await buyerStep(s, r.id, 'dispute', { reason: 'Encore' }).expect(409);
    await orgStep(s, r.id, 'approve').expect(409); // the seller no longer decides

    await ctx.http.get('/v1/admin/disputes').expect(401);
    await ctx.http.get('/v1/admin/disputes').set(bearer(plain.token)).expect(403);
    await ctx.http.get('/v1/admin/disputes').set(bearer(s.owner.token)).expect(403);
    const queue = (await ctx.http.get('/v1/admin/disputes').set(bearer(support.token)).expect(200)).body;
    expect(queue.items.map((i: any) => i.id)).toContain(r.id);

    await ctx.http.post(`/v1/admin/disputes/${r.id}/resolve`).set(bearer(plain.token)).send({ resolution: 'reject' }).expect(403);
    await ctx.http.post(`/v1/admin/disputes/${r.id}/resolve`).set(bearer(admin.token)).send({ resolution: 'maybe' }).expect(400);
    await ctx.http.post(`/v1/admin/disputes/${r.id}/resolve`).set(bearer(admin.token)).send({ resolution: 'refund_partial' }).expect(400); // amount needed
    await ctx.http.post(`/v1/admin/disputes/${r.id}/resolve`).set(bearer(admin.token)).send({ resolution: 'refund_buyer', refundMinor: 5 }).expect(400); // amount only for a partial one
    await ctx.http.post(`/v1/admin/disputes/${r.id}/resolve`).set(bearer(admin.token)).send({ resolution: 'refund_partial', refundMinor: 10_001 }).expect(400);
    await ctx.http.post(`/v1/admin/disputes/${randomUUID()}/resolve`).set(bearer(admin.token)).send({ resolution: 'reject' }).expect(404);
    const resolved = (await ctx.http.post(`/v1/admin/disputes/${r.id}/resolve`).set(bearer(admin.token)).send({ resolution: 'refund_partial', refundMinor: 6_000, note: 'Moitié' }).expect(200)).body;
    expect(resolved).toMatchObject({ status: 'resolved', resolution: 'refund_partial', refundMinor: 6_000, adminNote: 'Moitié' });
    expect(resolved.events.at(-1)).toMatchObject({ fromStatus: 'disputed', status: 'resolved', actorKind: 'admin' });
    await ctx.http.post(`/v1/admin/disputes/${r.id}/resolve`).set(bearer(admin.token)).send({ resolution: 'reject' }).expect(409);
    expect((await ctx.http.get('/v1/admin/disputes').set(bearer(admin.token)).expect(200)).body.items.map((i: any) => i.id)).not.toContain(r.id);
    expect((await ctx.http.get('/v1/admin/disputes?status=resolved').set(bearer(admin.token)).expect(200)).body.items.map((i: any) => i.id)).toContain(r.id);

    const refunded = (await orgStep(s, r.id, 'refunded').expect(200)).body;
    expect(refunded).toMatchObject({ status: 'refunded', refundedMinor: 6_000 });
  });

  it('a platform rejection leaves nothing to refund', async () => {
    const s = await setup();
    const admin = await user(['user', 'admin']);
    const r = (await ask(s).expect(201)).body;
    await orgStep(s, r.id, 'reject').expect(200);
    await buyerStep(s, r.id, 'dispute', { reason: 'Injuste' }).expect(200);
    await ctx.http.post(`/v1/admin/disputes/${r.id}/resolve`).set(bearer(admin.token)).send({ resolution: 'reject' }).expect(200);
    const res = await orgStep(s, r.id, 'refunded').expect(409);
    expect(res.body.error.details.reason).toBe('invalid_transition');
  });
});

describe('notifications and audit', () => {
  it('tells both parties at each step with generic text, and audits ids and amounts only', async () => {
    const s = await setup();
    const admin = await user(['user', 'admin']);
    const r = (await ask(s, { details: SECRET_TEXT }).expect(201)).body;
    await orgStep(s, r.id, 'reject', { note: `${SECRET_TEXT}-note` }).expect(200);
    await buyerStep(s, r.id, 'dispute', { reason: `${SECRET_TEXT}-litige` }).expect(200);
    await ctx.http.post(`/v1/admin/disputes/${r.id}/resolve`).set(bearer(admin.token)).send({ resolution: 'refund_buyer', note: `${SECRET_TEXT}-admin` }).expect(200);
    await orgStep(s, r.id, 'refunded', { note: `${SECRET_TEXT}-fin` }).expect(200);

    const mine = (await notificationsOf(s.buyer)).filter((n: any) => n.data?.returnId === r.id);
    const theirs = (await notificationsOf(s.owner)).filter((n: any) => n.data?.returnId === r.id);
    // buyer: rejected, resolved, refunded. seller: requested, disputed, resolved.
    expect(mine.map((n: any) => n.data.status).sort()).toEqual(['refunded', 'rejected', 'resolved']);
    expect(theirs.map((n: any) => n.data.status).sort()).toEqual(['disputed', 'requested', 'resolved']);
    for (const n of [...mine, ...theirs]) {
      expect(n.category).toBe('commerce');
      expect(JSON.stringify(n)).not.toContain('SECRETTEXT');
      expect(n.title).toBe(`Retour ${s.order.number}`);
    }

    const audit = (await ctx.sql.query(`SELECT action, actor_user_id, metadata FROM audit_events WHERE action LIKE 'commerce.return_%' AND metadata->>'returnId' = $1 ORDER BY id`, [r.id])).rows;
    expect(audit.map((a) => a.action)).toEqual(['commerce.return_requested', ...Array(4).fill('commerce.return_status_changed')]);
    expect(audit.at(-1).metadata).toMatchObject({ orderId: s.order.id, returnId: r.id, orgId: s.orgId, from: 'resolved', to: 'refunded', refundMinor: 10_000 });
    expect(JSON.stringify(audit)).not.toContain('SECRETTEXT');
    expect(audit.map((a) => a.actor_user_id)).toEqual([s.buyer.id, s.owner.id, s.buyer.id, admin.id, s.owner.id]);
  });

  it('does not notify a manager blocked with the buyer', async () => {
    const s = await setup();
    await ctx.http.put(`/v1/blocks/${s.owner.id}`).set(bearer(s.buyer.token)).expect(204);
    const r = (await ask(s).expect(201)).body;
    expect((await notificationsOf(s.owner)).filter((n: any) => n.data?.returnId === r.id)).toHaveLength(0);
    // The seller still sees and decides the return; the buyer is not pinged by a blocked member.
    await orgStep(s, r.id, 'approve').expect(200);
    expect((await notificationsOf(s.buyer)).filter((n: any) => n.data?.returnId === r.id)).toHaveLength(0);
  });
});

describe('account export and purge', () => {
  it('exports the returns of the user and erases their free text on purge, keeping status and amounts', async () => {
    const s = await setup();
    const r = (await ask(s).expect(201)).body;
    await orgStep(s, r.id, 'reject').expect(200);
    await buyerStep(s, r.id, 'dispute', { reason: `${SECRET_TEXT}-litige` }).expect(200);

    const exp = (await ctx.http.get('/v1/me/export').set(bearer(s.buyer.token)).expect(200)).body;
    expect(exp.orderReturns).toEqual([
      expect.objectContaining({ orderNumber: s.order.number, reason: 'defective', details: SECRET_TEXT, status: 'disputed', refundMinor: 10_000, currency: 'CDF', disputeReason: `${SECRET_TEXT}-litige` }),
    ]);
    const seller = (await ctx.http.get('/v1/me/export').set(bearer(s.owner.token)).expect(200)).body;
    expect(seller.orderReturns).toEqual([]);

    await ctx.http.post('/v1/me/deletion-request').set(bearer(s.buyer.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [s.buyer.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    const row = (await ctx.sql.query('SELECT status, details, dispute_reason, refund_minor FROM order_returns WHERE id = $1', [r.id])).rows[0];
    expect(row).toMatchObject({ status: 'disputed', details: null, dispute_reason: null, refund_minor: '10000' });
  });
});

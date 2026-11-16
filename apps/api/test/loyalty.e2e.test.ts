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
}

async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id };
}

let slugCounter = 0;
async function seller(currency = 'USD') {
  const owner = await user();
  slugCounter += 1;
  const org = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug: `loy-${Date.now().toString(36)}-${slugCounter}`, name: 'Boutique Fidele', kind: 'shop' })
    .expect(201);
  const orgId: string = org.body.id;
  const variant = fake.add({ orgId, currency, price: 10_000, stock: 50 });
  return { owner, orgId, variant };
}

const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix', notes: 'Portail bleu' };

/** A buyer orders 2 x 100.00 (20 000 minor) and the seller walks the order to `delivered`. */
async function deliveredOrder(s: { owner: TU; orgId: string; variant: string }, buyer: TU, finish = true): Promise<string> {
  await ctx.http.put(`/v1/cart/items/${s.variant}`).set(bearer(buyer.token)).send({ quantity: 2 }).expect(200);
  const res = await ctx.http
    .post('/v1/orders/checkout')
    .set(bearer(buyer.token))
    .send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery' })
    .expect(201);
  const id: string = res.body.orders[0].id;
  if (finish) {
    for (const status of ['confirmed', 'preparing', 'shipped', 'delivered']) {
      await ctx.http.post(`/v1/orgs/${s.orgId}/orders/${id}/status`).set(bearer(s.owner.token)).send({ status }).expect(200);
    }
  }
  return id;
}

const program = (s: { owner: TU; orgId: string }, body: Record<string, unknown>) =>
  ctx.http.put(`/v1/orgs/${s.orgId}/loyalty`).set(bearer(s.owner.token)).send({ enabled: true, pointsPerUnit: 3, currency: 'USD', rewardText: 'Un cafe offert a 500 points', ...body });

describe('loyalty points', () => {
  it('awards points once per delivered order, in the programme currency, and reports balances', async () => {
    const s = await seller('USD');
    const buyer = await user();
    const stranger = await user();
    await ctx.http.get(`/v1/orgs/${s.orgId}/loyalty`).set(bearer(stranger.token)).expect(404);
    await program(s, { pointsPerUnit: 0 }).expect(400);
    await program(s, { pointsPerUnit: 101 }).expect(400);
    await program(s, { currency: 'EUR' }).expect(400);
    await program(s, { rewardText: 'x'.repeat(201) }).expect(400);

    // Programme still off: no points.
    await deliveredOrder(s, buyer);
    expect((await ctx.http.get('/v1/me/loyalty').set(bearer(buyer.token)).expect(200)).body.items).toEqual([]);

    await program(s, {}).expect(200);
    const orderId = await deliveredOrder(s, buyer);
    const mine = (await ctx.http.get('/v1/me/loyalty').set(bearer(buyer.token)).expect(200)).body;
    expect(mine.marketingConsent).toBe(false);
    expect(mine.items).toEqual([{ orgId: s.orgId, orgName: 'Boutique Fidele', points: 600, rewardText: 'Un cafe offert a 500 points', enabled: true }]);

    // Once per order (unique movement), even if the award is replayed.
    const again = await ctx.sql.query(
      `INSERT INTO loyalty_movements (order_id, org_id, user_id, points) VALUES ($1, $2, $3, 1)`,
      [orderId, s.orgId, buyer.id],
    ).then(() => 'inserted', (e: { constraint?: string }) => e.constraint);
    expect(again).toBe('loyalty_movements_order_unique');

    const prog = (await ctx.http.get(`/v1/orgs/${s.orgId}/loyalty`).set(bearer(s.owner.token)).expect(200)).body;
    expect(prog).toMatchObject({ enabled: true, pointsPerUnit: 3, currency: 'USD', members: 1, pointsIssued: 600 });
  });

  it('ignores orders in another currency', async () => {
    const s = await seller('CDF');
    const buyer = await user();
    await program(s, {}).expect(200); // USD programme, CDF order
    await deliveredOrder(s, buyer);
    expect((await ctx.http.get('/v1/me/loyalty').set(bearer(buyer.token)).expect(200)).body.items).toEqual([]);
  });
});

describe('marketing campaigns', () => {
  it('reaches only opted-in customers, respects blocks, the 24 h limit and keeps the text out of the audit', async () => {
    const s = await seller('USD');
    const yes = await user();
    const no = await user();
    const blocked = await user();
    await deliveredOrder(s, yes, false);
    await deliveredOrder(s, no, false);
    await deliveredOrder(s, blocked, false);
    await ctx.http.put('/v1/me/marketing-consent').set(bearer(yes.token)).send({ optIn: true }).expect(200);
    await ctx.http.put('/v1/me/marketing-consent').set(bearer(blocked.token)).send({ optIn: true }).expect(200);
    await ctx.http.put(`/v1/blocks/${s.owner.id}`).set(bearer(blocked.token)).expect(204);
    expect((await ctx.http.get('/v1/me/loyalty').set(bearer(yes.token))).body.marketingConsent).toBe(true);

    const stranger = await user();
    await ctx.http.post(`/v1/orgs/${s.orgId}/campaigns`).set(bearer(stranger.token)).send({ title: 'Soldes', body: 'Hello' }).expect(404);
    await ctx.http.post(`/v1/orgs/${s.orgId}/campaigns`).set(bearer(s.owner.token)).send({ title: 'x'.repeat(81), body: 'Hello' }).expect(400);
    await ctx.http.post(`/v1/orgs/${s.orgId}/campaigns`).set(bearer(s.owner.token)).send({ title: 'Soldes', body: 'y'.repeat(301) }).expect(400);

    const sent = await ctx.http.post(`/v1/orgs/${s.orgId}/campaigns`).set(bearer(s.owner.token)).send({ title: 'Soldes secrètes', body: 'Moins 20 pour cent ce week-end' }).expect(201);
    expect(sent.body).toMatchObject({ title: 'Soldes secrètes', recipients: 1 });
    await ctx.http.post(`/v1/orgs/${s.orgId}/campaigns`).set(bearer(s.owner.token)).send({ title: 'Encore', body: 'Bis' }).expect(409);

    const got = (await ctx.http.get('/v1/notifications').set(bearer(yes.token)).expect(200)).body.items.filter((n: any) => n.title === 'Soldes secrètes');
    expect(got).toHaveLength(1);
    for (const u of [no, blocked]) {
      expect((await ctx.http.get('/v1/notifications').set(bearer(u.token)).expect(200)).body.items.some((n: any) => n.title === 'Soldes secrètes')).toBe(false);
    }

    const list = (await ctx.http.get(`/v1/orgs/${s.orgId}/campaigns`).set(bearer(s.owner.token)).expect(200)).body;
    expect(list.items).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(yes.id);

    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action IN ('commerce.campaign_sent', 'user.marketing_consent_updated') AND (actor_user_id = $1 OR actor_user_id = $2)`, [s.owner.id, yes.id]);
    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit.rows)).not.toContain('Moins 20');
  });
});

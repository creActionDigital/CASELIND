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
    .send({ slug: `pos-${Date.now().toString(36)}-${slugCounter}`, name: 'Boutique Caisse', kind: 'shop' })
    .expect(201);
  const orgId: string = org.body.id;
  const variant = fake.add({ orgId, currency, price: 10_000, stock: 50 });
  return { owner, orgId, variant };
}

const sale = (s: { owner: TU; orgId: string }, body: Record<string, unknown>, token = s.owner.token) =>
  ctx.http.post(`/v1/orgs/${s.orgId}/pos/sales`).set(bearer(token)).send({ clientId: randomUUID(), paymentMethod: 'cash', ...body });

describe('caisse (counter sales)', () => {
  it('retries: concurrent same key gives one sale, a reused key with another content is refused', async () => {
    const s = await seller('USD');
    const clientId = randomUUID();
    const body = { clientId, lines: [{ variantId: s.variant, quantity: 2 }] };
    const [a, b] = await Promise.all([sale(s, body), sale(s, body)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(fake.variants.get(s.variant)!.stock).toBe(48);
    const other = await sale(s, { ...body, paymentMethod: 'card' }).expect(409);
    expect(other.body.error.details).toMatchObject({ reason: 'client_id_reused' });
    await sale(s, { ...body, lines: [{ variantId: s.variant, quantity: 3 }] }).expect(409);
    expect(fake.variants.get(s.variant)!.stock).toBe(48);
  });

  it('records a sale, takes stock, is idempotent, and sums the day per method', async () => {
    const s = await seller('USD');
    const other = await seller('USD');
    const clientId = randomUUID();
    const res = await sale(s, { clientId, lines: [{ variantId: s.variant, quantity: 3 }] }).expect(201);
    expect(res.body).toMatchObject({ currency: 'USD', totalMinor: 30_000, paymentMethod: 'cash' });
    expect(res.body.lines).toEqual([{ title: 'Article', variantLabel: 'Standard', quantity: 3, unitPriceMinor: 10_000 }]);
    expect(fake.variants.get(s.variant)!.stock).toBe(47);

    // Same clientId: same sale, stock untouched.
    const again = await sale(s, { clientId, lines: [{ variantId: s.variant, quantity: 3 }] }).expect(201);
    expect(again.body.id).toBe(res.body.id);
    expect(fake.variants.get(s.variant)!.stock).toBe(47);

    await sale(s, { paymentMethod: 'mobile_money', lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201);
    const sum = (await ctx.http.get(`/v1/orgs/${s.orgId}/pos/summary`).set(bearer(s.owner.token)).expect(200)).body;
    expect(sum.items).toEqual([{ currency: 'USD', salesCount: 2, totalMinor: 40_000, byMethod: { cash: 30_000, mobile_money: 10_000, card: 0 } }]);
    const list = (await ctx.http.get(`/v1/orgs/${s.orgId}/pos/sales`).set(bearer(s.owner.token)).expect(200)).body;
    expect(list.items).toHaveLength(2);
    expect((await ctx.http.get(`/v1/orgs/${other.orgId}/pos/sales`).set(bearer(other.owner.token)).expect(200)).body.items).toEqual([]);

    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'commerce.pos_sale' AND actor_user_id = $1`, [s.owner.id]);
    expect(audit.rows).toHaveLength(2);
    expect(JSON.stringify(audit.rows)).not.toContain('Article');
  });

  it('refuses bad input, short stock, foreign items, mixed currencies and strangers', async () => {
    const s = await seller('USD');
    const other = await seller('USD');
    const cdf = fake.add({ orgId: s.orgId, currency: 'CDF', price: 500, stock: 5 });
    const stranger = await user();
    await sale(s, { lines: [] }).expect(400);
    await sale(s, { lines: [{ variantId: s.variant, quantity: 0 }] }).expect(400);
    await sale(s, { paymentMethod: 'bitcoin', lines: [{ variantId: s.variant, quantity: 1 }] }).expect(400);
    await sale(s, { lines: [{ variantId: s.variant, quantity: 999 }] }).expect(409);
    // A variant of another shop gives the same answer as an unknown one, whatever the quantity.
    const foreign = await sale(s, { lines: [{ variantId: other.variant, quantity: 999 }] }).expect(409);
    expect(foreign.body.error.details).toMatchObject({ reason: 'unavailable' });
    expect(fake.variants.get(other.variant)!.stock).toBe(50);
    await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }, { variantId: cdf, quantity: 1 }] }).expect(409);
    await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }, stranger.token).expect(404);
    await ctx.http.get(`/v1/orgs/${s.orgId}/pos/summary`).set(bearer(stranger.token)).expect(404);
  });
});

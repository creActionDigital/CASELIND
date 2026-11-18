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
    expect(res.body).toMatchObject({ currency: 'USD', totalMinor: 30_000, paymentMethod: 'cash', voidedAt: null });
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

  it('GET sales honours ?limit (1-50, default 20)', async () => {
    const s = await seller('USD');
    for (let i = 0; i < 3; i++) await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201);
    const get = (q: string) => ctx.http.get(`/v1/orgs/${s.orgId}/pos/sales${q}`).set(bearer(s.owner.token));
    expect((await get('?limit=2').expect(200)).body.items).toHaveLength(2);
    expect((await get('').expect(200)).body.items).toHaveLength(3);
    await get('?limit=0').expect(400);
    await get('?limit=51').expect(400);
  });

  it('ticket: the sale plus the shop header; another shop or a bad id is 404', async () => {
    const s = await seller('USD');
    const other = await seller('USD');
    await ctx.http.patch(`/v1/orgs/${s.orgId}`).set(bearer(s.owner.token)).send({ address: '12 av. du Commerce', phone: '+243810000000' }).expect(200);
    const made = await sale(s, { lines: [{ variantId: s.variant, quantity: 2 }] }).expect(201);
    const t = (await ctx.http.get(`/v1/orgs/${s.orgId}/pos/sales/${made.body.id}`).set(bearer(s.owner.token)).expect(200)).body;
    expect(t.sale).toEqual(made.body);
    expect(t.shop).toEqual({ name: 'Boutique Caisse', address: '12 av. du Commerce', phone: '+243810000000' });
    await ctx.http.get(`/v1/orgs/${other.orgId}/pos/sales/${made.body.id}`).set(bearer(other.owner.token)).expect(404);
    await ctx.http.get(`/v1/orgs/${s.orgId}/pos/sales/not-a-uuid`).set(bearer(s.owner.token)).expect(404);
  });

  it('void: gives the stock back, leaves the day summary, is idempotent, audited without lines, 404 for another shop', async () => {
    const s = await seller('USD');
    const other = await seller('USD');
    const keep = await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201);
    const made = await sale(s, { lines: [{ variantId: s.variant, quantity: 4 }] }).expect(201);
    expect(fake.variants.get(s.variant)!.stock).toBe(45);
    const url = `/v1/orgs/${s.orgId}/pos/sales/${made.body.id}/void`;
    await ctx.http.post(`/v1/orgs/${other.orgId}/pos/sales/${made.body.id}/void`).set(bearer(other.owner.token)).send({}).expect(404);
    expect(fake.variants.get(s.variant)!.stock).toBe(45);
    const v = await ctx.http.post(url).set(bearer(s.owner.token)).send({ reason: 'Erreur de saisie' }).expect(200);
    expect(v.body.voidedAt).toEqual(expect.any(String));
    expect(fake.variants.get(s.variant)!.stock).toBe(49);
    // Again (no body at all): same sale, stock untouched.
    const again = await ctx.http.post(url).set(bearer(s.owner.token)).expect(200);
    expect(again.body).toEqual(v.body);
    expect(fake.variants.get(s.variant)!.stock).toBe(49);
    await ctx.http.post(`/v1/orgs/${s.orgId}/pos/sales/${keep.body.id}/void`).set(bearer(s.owner.token)).send({ reason: 'x'.repeat(201) }).expect(400);

    const sum = (await ctx.http.get(`/v1/orgs/${s.orgId}/pos/summary`).set(bearer(s.owner.token)).expect(200)).body;
    expect(sum.items).toEqual([{ currency: 'USD', salesCount: 1, totalMinor: 10_000, byMethod: { cash: 10_000, mobile_money: 0, card: 0 } }]);
    const list = (await ctx.http.get(`/v1/orgs/${s.orgId}/pos/sales`).set(bearer(s.owner.token)).expect(200)).body.items;
    expect(list.find((x: { id: string }) => x.id === keep.body.id).voidedAt).toBeNull();
    expect(list.find((x: { id: string }) => x.id === made.body.id).voidedAt).not.toBeNull();

    const row = (await ctx.sql.query(`SELECT voided_by, void_reason FROM pos_sales WHERE id = $1`, [made.body.id])).rows[0];
    expect(row).toEqual({ voided_by: s.owner.id, void_reason: 'Erreur de saisie' });
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'commerce.pos_void' AND actor_user_id = $1`, [s.owner.id]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain('Article');
  });

  it('void: a variant with untracked stock is left alone', async () => {
    const s = await seller('USD');
    const free = fake.add({ orgId: s.orgId, currency: 'USD', price: 700, stock: 0, trackStock: false });
    const made = await sale(s, { lines: [{ variantId: free, quantity: 5 }] }).expect(201);
    expect(fake.variants.get(free)!.stock).toBe(0);
    await ctx.http.post(`/v1/orgs/${s.orgId}/pos/sales/${made.body.id}/void`).set(bearer(s.owner.token)).send({}).expect(200);
    expect(fake.variants.get(free)!.stock).toBe(0);
  });

  it('a role without orders.manage (stock) is refused everywhere on the till', async () => {
    const s = await seller('USD');
    const clerk = await user();
    await ctx.http.post(`/v1/orgs/${s.orgId}/invitations`).set(bearer(s.owner.token)).send({ handle: clerk.handle, role: 'stock' }).expect(201);
    await ctx.http.post(`/v1/me/org-invitations/${s.orgId}/accept`).set(bearer(clerk.token)).expect(200);
    const made = await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201);
    const base = `/v1/orgs/${s.orgId}/pos`;
    await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }, clerk.token).expect(403);
    await ctx.http.get(`${base}/sales`).set(bearer(clerk.token)).expect(403);
    await ctx.http.get(`${base}/sales/${made.body.id}`).set(bearer(clerk.token)).expect(403);
    await ctx.http.post(`${base}/sales/${made.body.id}/void`).set(bearer(clerk.token)).send({}).expect(403);
    await ctx.http.get(`${base}/summary`).set(bearer(clerk.token)).expect(403);
    await ctx.http.post(`${base}/shifts`).set(bearer(clerk.token)).send({ currency: 'USD', openingFloatMinor: 0 }).expect(403);
    await ctx.http.get(`${base}/shifts/current`).set(bearer(clerk.token)).expect(403);
    expect(fake.variants.get(s.variant)!.stock).toBe(49);
  });

  it('cash drawer: open, sell, void, close with the difference; a second open is 409; sales without a session still work', async () => {
    const s = await seller('USD');
    const base = `/v1/orgs/${s.orgId}/pos`;
    const get = () => ctx.http.get(`${base}/shifts/current`).set(bearer(s.owner.token)).expect(200);
    expect((await get()).body).toEqual({ shift: null });
    await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201); // before the session: not counted
    await ctx.http.post(`${base}/shifts`).set(bearer(s.owner.token)).send({ currency: 'USD', openingFloatMinor: -1 }).expect(400);
    const open = await ctx.http.post(`${base}/shifts`).set(bearer(s.owner.token)).send({ currency: 'USD', openingFloatMinor: 5_000 }).expect(201);
    expect(open.body).toMatchObject({ currency: 'USD', openingFloatMinor: 5_000, closedAt: null, countedCashMinor: null });
    const dup = await ctx.http.post(`${base}/shifts`).set(bearer(s.owner.token)).send({ currency: 'CDF', openingFloatMinor: 0 }).expect(409);
    expect(dup.body.error.details).toMatchObject({ reason: 'shift_open' });
    expect((await get()).body.shift.id).toBe(open.body.id);

    await sale(s, { lines: [{ variantId: s.variant, quantity: 2 }] }).expect(201); // cash 20 000
    await sale(s, { paymentMethod: 'card', lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201); // not cash
    const gone = await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201); // voided below
    await ctx.http.post(`${base}/sales/${gone.body.id}/void`).set(bearer(s.owner.token)).send({}).expect(200);

    await ctx.http.post(`${base}/shifts/${randomUUID()}/close`).set(bearer(s.owner.token)).send({ countedCashMinor: 0 }).expect(404);
    await ctx.http.post(`${base}/shifts/${open.body.id}/close`).set(bearer(s.owner.token)).send({ countedCashMinor: -5 }).expect(400);
    const rep = await ctx.http.post(`${base}/shifts/${open.body.id}/close`).set(bearer(s.owner.token)).send({ countedCashMinor: 24_000 }).expect(200);
    expect(rep.body).toMatchObject({ expectedCashMinor: 25_000, countedCashMinor: 24_000, differenceMinor: -1_000 });
    expect(rep.body.shift.closedAt).toEqual(expect.any(String));
    // A retry reports the same figures; nothing is overwritten.
    const retry = await ctx.http.post(`${base}/shifts/${open.body.id}/close`).set(bearer(s.owner.token)).send({ countedCashMinor: 99 }).expect(200);
    expect(retry.body).toEqual(rep.body);
    expect((await get()).body).toEqual({ shift: null });

    // Sale after closing: no session, still fine; a new session can open.
    await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201);
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM pos_sales WHERE org_id = $1 AND shift_id IS NULL`, [s.orgId])).rows[0].n).toBe(2);
    await ctx.http.post(`${base}/shifts`).set(bearer(s.owner.token)).send({ currency: 'CDF', openingFloatMinor: 0 }).expect(201);
  });

  it('time zone: "today" follows the shop zone; bad zones are refused', async () => {
    const s = await seller('USD');
    expect((await ctx.http.get(`/v1/orgs/${s.orgId}`).set(bearer(s.owner.token)).expect(200)).body.timezone).toBe('Africa/Lubumbashi');
    await ctx.http.patch(`/v1/orgs/${s.orgId}`).set(bearer(s.owner.token)).send({ timezone: 'Mars/Olympus' }).expect(400);
    await ctx.http.patch(`/v1/orgs/${s.orgId}`).set(bearer(s.owner.token)).send({ timezone: null }).expect(400);
    const a = (await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201)).body.id;
    const b = (await sale(s, { lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201)).body.id;
    // Zones 26 h apart: the same instants cannot be "today" in both. For each zone, sale a starts the local day, sale b ends the previous one.
    for (const tz of ['Pacific/Kiritimati', 'Etc/GMT+12', 'Pacific/Kiritimati']) {
      const patched = await ctx.http.patch(`/v1/orgs/${s.orgId}`).set(bearer(s.owner.token)).send({ timezone: tz }).expect(200);
      expect(patched.body.timezone).toBe(tz);
      await ctx.sql.query(
        `UPDATE pos_sales SET created_at = (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1) - CASE WHEN id = $2 THEN interval '1 minute' ELSE interval '0' END WHERE id IN ($2, $3)`,
        [tz, b, a],
      );
      const sum = (await ctx.http.get(`/v1/orgs/${s.orgId}/pos/summary`).set(bearer(s.owner.token)).expect(200)).body;
      expect(sum.items).toMatchObject([{ currency: 'USD', salesCount: 1, totalMinor: 10_000 }]);
    }
  });
});

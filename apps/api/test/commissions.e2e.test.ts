import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commissionMinor } from '@caselind/contracts';
import { CommissionService } from '../src/platform-ops/commission.service.js';
import { FakeCatalog, installFakeCatalog } from './fake-catalog.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Commissions : relevé indicatif, une ligne par commande livrée, arrondi exact, transition jamais cassée (CDC §26). */
let ctx: TestContext;
const fake = new FakeCatalog();
beforeAll(async () => {
  ctx = await createTestContext();
  installFakeCatalog(ctx, fake);
  await ctx.sql.query(`INSERT INTO feature_flags (key, description, enabled) VALUES ('commerce', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`);
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
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id };
}
let n = 0;
async function seller(price: number, currency = 'USD') {
  const owner = await user();
  n += 1;
  const org = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `com-${Date.now().toString(36)}-${n}`, name: `Boutique ${n}`, kind: 'shop' }).expect(201);
  const orgId: string = org.body.id;
  return { owner, orgId, variant: fake.add({ orgId, currency, price, stock: 100 }) };
}
const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix', notes: 'Portail bleu' };

async function order(s: { owner: TU; orgId: string; variant: string }, buyer: TU, upTo: 'delivered' | 'shipped' = 'delivered'): Promise<string> {
  await ctx.http.put(`/v1/cart/items/${s.variant}`).set(bearer(buyer.token)).send({ quantity: 1 }).expect(200);
  const res = await ctx.http.post('/v1/orders/checkout').set(bearer(buyer.token)).send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery' }).expect(201);
  const id: string = res.body.orders[0].id;
  const steps = upTo === 'delivered' ? ['confirmed', 'preparing', 'shipped', 'delivered'] : ['confirmed', 'preparing', 'shipped'];
  for (const status of steps) await ctx.http.post(`/v1/orgs/${s.orgId}/orders/${id}/status`).set(bearer(s.owner.token)).send({ status }).expect(200);
  return id;
}
const lines = async (orderId: string) => (await ctx.sql.query('SELECT * FROM order_commissions WHERE order_id = $1', [orderId])).rows;
const setDefault = (bps: number) =>
  ctx.sql.query(`INSERT INTO platform_settings (key, scope, value) VALUES ('commission.defaultBps', 'global', $1::jsonb) ON CONFLICT (key, scope) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(bps)]);

describe('arrondi', () => {
  it('demi vers le haut, en entiers', () => {
    expect(commissionMinor(1001, 250)).toBe(25); // 25,025
    expect(commissionMinor(1019, 500)).toBe(51); // 50,95
    expect(commissionMinor(1, 5000)).toBe(1); // 0,5 -> 1
    expect(commissionMinor(1, 4999)).toBe(0);
    expect(commissionMinor(20_000, 0)).toBe(0);
    expect(commissionMinor(1_000_000_000_000, 3000)).toBe(300_000_000_000);
  });
});

describe('relevé de commissions', () => {
  it('une ligne par commande livrée, au taux de la plateforme puis à la surcharge de l\'organisation, arrondie exactement', async () => {
    const admin = await user(['user', 'admin']);
    const buyer = await user();
    await setDefault(250);
    const s = await seller(1_001);
    const o1 = await order(s, buyer);
    const l1 = await lines(o1);
    expect(l1).toHaveLength(1);
    expect(l1[0]).toMatchObject({ org_id: s.orgId, gross_minor: '1001', bps: 250, commission_minor: '25' });
    expect(l1[0].currency.trim()).toBe('USD');

    // Surcharge de l'organisation : appliquée aux prochaines livraisons seulement.
    await ctx.http.put(`/v1/admin/orgs/${s.orgId}/commission`).set(bearer(buyer.token)).send({ bps: 500, reason: 'accord' }).expect(403);
    await ctx.http.put(`/v1/admin/orgs/${s.orgId}/commission`).set(bearer(admin.token)).send({ bps: 3001, reason: 'accord' }).expect(400);
    await ctx.http.put(`/v1/admin/orgs/${s.orgId}/commission`).set(bearer(admin.token)).send({ bps: 500, reason: 'accord' }).expect(200);
    s.variant = fake.add({ orgId: s.orgId, currency: 'USD', price: 1_019, stock: 10 });
    const o2 = await order(s, buyer);
    expect((await lines(o2))[0]).toMatchObject({ gross_minor: '1019', bps: 500, commission_minor: '51' });
    expect((await lines(o1))[0].bps).toBe(250); // l'ancienne ligne ne bouge pas

    // Une ligne par commande : un rejeu ne double rien.
    await ctx.app.get(CommissionService).recordForOrder(o2);
    expect(await lines(o2)).toHaveLength(1);
    // Une commande non livrée n'en a pas.
    const o3 = await order(s, buyer, 'shipped');
    expect(await lines(o3)).toHaveLength(0);

    // Relevé du vendeur : finance.view ; un étranger ne voit rien.
    const st = (await ctx.http.get(`/v1/orgs/${s.orgId}/commissions`).set(bearer(s.owner.token)).expect(200)).body;
    expect(st.indicative).toBe(true);
    expect(st.currentBps).toBe(500);
    expect(st.totals).toEqual([{ currency: 'USD', orders: 2, grossMinor: 2020, commissionMinor: 76 }]);
    expect(st.items).toHaveLength(2);
    expect(st.items[0]).toMatchObject({ orderId: o2, bps: 500, commissionMinor: 51 });
    const p1 = (await ctx.http.get(`/v1/orgs/${s.orgId}/commissions`).query({ limit: 1 }).set(bearer(s.owner.token)).expect(200)).body;
    expect(p1.items).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    await ctx.http.get(`/v1/orgs/${s.orgId}/commissions`).set(bearer(buyer.token)).expect(404);
    await ctx.http.get(`/v1/orgs/${s.orgId}/commissions`).query({ from: '2030-01-02', to: '2030-01-01' }).set(bearer(s.owner.token)).expect(409);

    // Relevé de la plateforme.
    const all = (await ctx.http.get('/v1/admin/commissions').set(bearer(admin.token)).expect(200)).body;
    expect(all.indicative).toBe(true);
    const usd = all.totals.find((t: { currency: string }) => t.currency === 'USD');
    expect(usd.commissionMinor).toBeGreaterThanOrEqual(76);
    expect(all.byOrg.find((x: { orgId: string }) => x.orgId === s.orgId)).toMatchObject({ orders: 2, commissionMinor: 76 });
    await ctx.http.get('/v1/admin/commissions').set(bearer(buyer.token)).expect(403);
    // Retour au taux de la plateforme.
    await ctx.http.put(`/v1/admin/orgs/${s.orgId}/commission`).set(bearer(admin.token)).send({ bps: null, reason: 'fin de l\'accord' }).expect(200);
    expect((await ctx.http.get(`/v1/orgs/${s.orgId}/commissions`).set(bearer(s.owner.token)).expect(200)).body.currentBps).toBe(250);
  });

  it('la transition vers « livrée » ne casse jamais, même si l\'enregistrement de la commission échoue', async () => {
    const buyer = await user();
    const s = await seller(2_000);
    await ctx.sql.query('ALTER TABLE order_commissions RENAME TO order_commissions_off');
    let id: string;
    try {
      id = await order(s, buyer); // un 200 à chaque étape, jusqu'à delivered
    } finally {
      await ctx.sql.query('ALTER TABLE order_commissions_off RENAME TO order_commissions');
    }
    expect((await ctx.sql.query('SELECT status FROM orders WHERE id = $1', [id])).rows[0].status).toBe('delivered');
    expect(await lines(id)).toHaveLength(0);
  });
});

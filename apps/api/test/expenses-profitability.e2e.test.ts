import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Dépenses, rentabilité et exports CSV : agrégats vérifiés sur des données semées à la main. */
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
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id };
}
let n = 0;
const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;
async function createOrg(owner: TU): Promise<string> {
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: uniq('compta'), name: 'Boutique', kind: 'shop' }).expect(201);
  return res.body.id;
}
async function member(orgId: string, role: string): Promise<TU> {
  const u = await user();
  await ctx.sql.query(`INSERT INTO org_members (org_id, user_id, role, status, joined_at) VALUES ($1, $2, $3, 'active', now())`, [orgId, u.id, role]);
  return u;
}
async function product(owner: TU, orgId: string, price: number, stock: number, currency: string, cost: number | null): Promise<{ productId: string; variantId: string }> {
  const res = await ctx.http
    .post(`/v1/orgs/${orgId}/products`)
    .set(bearer(owner.token))
    .send({ title: `Article ${price}${currency}`, status: 'published', variants: [{ sku: uniq('SKU'), options: {}, priceMinor: price, currency, stock }] })
    .expect(201);
  const variantId = res.body.variants[0].id as string;
  if (cost !== null) await ctx.sql.query(`UPDATE product_variants SET cost_minor = $1 WHERE id = $2`, [cost, variantId]);
  return { productId: res.body.id, variantId };
}
interface Item {
  p: { productId: string; variantId: string };
  qty: number;
  unit: number;
}
async function order(orgId: string, buyer: TU, o: { status: string; currency: string; fee?: number; daysAgo: number; items: Item[] }, number: string): Promise<void> {
  const sub = o.items.reduce((s, i) => s + i.qty * i.unit, 0);
  const r = await ctx.sql.query(
    `INSERT INTO orders (number, buyer_id, org_id, client_id, currency, status, subtotal_minor, total_minor, payment_method, delivery_fee_minor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cash_on_delivery', $9) RETURNING id`,
    [number, buyer.id, orgId, randomUUID(), o.currency, o.status, sub, sub + (o.fee ?? 0), o.fee ?? 0],
  );
  const id = r.rows[0].id as string;
  for (const i of o.items) {
    await ctx.sql.query(
      `INSERT INTO order_items (order_id, variant_id, product_id, title, unit_price_minor, quantity, line_total_minor) VALUES ($1, $2, $3, 'Article', $4, $5, $6)`,
      [id, i.p.variantId, i.p.productId, i.unit, i.qty, i.qty * i.unit],
    );
  }
  if (o.status === 'delivered') {
    await ctx.sql.query(`INSERT INTO order_events (order_id, status, actor_kind, created_at) VALUES ($1, 'delivered', 'org', now() - $2 * interval '1 day')`, [id, o.daysAgo]);
  }
}
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const base = (orgId: string) => `/v1/orgs/${orgId}`;
const get = (t: TU, url: string) => ctx.http.get(url).set(bearer(t.token));
const post = (t: TU, url: string, body: object = {}) => ctx.http.post(url).set(bearer(t.token)).send(body);
const expense = (t: TU, orgId: string, body: object = {}) =>
  post(t, `${base(orgId)}/expenses`, { category: 'rent', amountMinor: 1000, currency: 'USD', spentOn: day(0), ...body });

describe('dépenses', () => {
  it('crée, liste avec curseur et filtres, modifie, supprime ; plafond de lecture 1000', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const sid = (await post(owner, `${base(orgId)}/suppliers`, { name: 'Imprimerie' }).expect(201)).body.id;
    const e1 = (await expense(owner, orgId, { spentOn: day(-3), supplierId: sid, note: 'Affiches' }).expect(201)).body;
    expect(e1).toMatchObject({ category: 'rent', amountMinor: 1000, currency: 'USD', supplierName: 'Imprimerie', note: 'Affiches' });
    await expense(owner, orgId, { category: 'transport', amountMinor: 300, spentOn: day(-2) }).expect(201);
    await expense(owner, orgId, { category: 'taxes', amountMinor: 50, currency: 'CDF', spentOn: day(-1) }).expect(201);
    const all = (await get(owner, `${base(orgId)}/expenses`).expect(200)).body;
    expect(all.items.map((e: { category: string }) => e.category)).toEqual(['taxes', 'transport', 'rent']);
    const p1 = (await get(owner, `${base(orgId)}/expenses?limit=2`).expect(200)).body;
    expect(p1.items).toHaveLength(2);
    const p2 = (await get(owner, `${base(orgId)}/expenses?limit=2&cursor=${p1.nextCursor}`).expect(200)).body;
    expect(p2.items.map((e: { id: string }) => e.id)).toEqual([e1.id]);
    expect(p2.nextCursor).toBeNull();
    expect((await get(owner, `${base(orgId)}/expenses?category=transport`).expect(200)).body.items).toHaveLength(1);
    expect((await get(owner, `${base(orgId)}/expenses?from=${day(-2)}&to=${day(-2)}`).expect(200)).body.items).toHaveLength(1);
    await get(owner, `${base(orgId)}/expenses?limit=1000`).expect(200);
    await get(owner, `${base(orgId)}/expenses?limit=1001`).expect(400);
    await get(owner, `${base(orgId)}/expenses?cursor=n-importe-quoi`).expect(400);

    const patched = (await ctx.http.patch(`${base(orgId)}/expenses/${e1.id}`).set(bearer(owner.token)).send({ amountMinor: 1200, supplierId: null, note: null }).expect(200)).body;
    expect(patched).toMatchObject({ amountMinor: 1200, supplierId: null, supplierName: null, note: null, category: 'rent' });
    await ctx.http.patch(`${base(orgId)}/expenses/${e1.id}`).set(bearer(owner.token)).send({}).expect(400);
    await ctx.http.delete(`${base(orgId)}/expenses/${e1.id}`).set(bearer(owner.token)).expect(204);
    await ctx.http.delete(`${base(orgId)}/expenses/${e1.id}`).set(bearer(owner.token)).expect(404);
  });

  it('valide les champs et refuse un fournisseur d\'une autre organisation', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    await expense(owner, orgId, { amountMinor: 0 }).expect(400);
    await expense(owner, orgId, { amountMinor: -5 }).expect(400);
    await expense(owner, orgId, { amountMinor: 1.5 }).expect(400);
    await expense(owner, orgId, { category: 'jeux' }).expect(400);
    await expense(owner, orgId, { currency: 'EUR' }).expect(400);
    await expense(owner, orgId, { spentOn: '2030-13-01' }).expect(400);
    await expense(owner, orgId, { note: 'x'.repeat(201) }).expect(400);
    const other = await user();
    const otherOrg = await createOrg(other);
    const foreign = (await post(other, `${base(otherOrg)}/suppliers`, { name: 'Autre' }).expect(201)).body.id;
    await expense(owner, orgId, { supplierId: foreign }).expect(404);
  });

  it('sépare lecture (finance.view) et écriture (finance.manage), isole les organisations', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const finance = await member(orgId, 'finance');
    const admin = await member(orgId, 'admin');
    const manager = await member(orgId, 'manager');
    const stock = await member(orgId, 'stock');
    const stranger = await user();
    const mine = (await expense(owner, orgId).expect(201)).body;
    await expense(finance, orgId).expect(201);
    await expense(admin, orgId).expect(201);
    await expense(manager, orgId).expect(403);
    await expense(stock, orgId).expect(403);
    await get(manager, `${base(orgId)}/expenses`).expect(403);
    await get(finance, `${base(orgId)}/expenses`).expect(200);
    await expense(stranger, orgId).expect(404);
    const other = await user();
    const otherOrg = await createOrg(other);
    await ctx.http.patch(`${base(orgId)}/expenses/${(await expense(other, otherOrg).expect(201)).body.id}`).set(bearer(owner.token)).send({ amountMinor: 5 }).expect(404);
    await ctx.http.delete(`${base(otherOrg)}/expenses/${mine.id}`).set(bearer(other.token)).expect(404);
    expect((await get(other, `${base(otherOrg)}/expenses`).expect(200)).body.items).toHaveLength(1);
  });
});

describe('rentabilité', () => {
  it('agrège chiffre d\'affaires, coût, coût inconnu, dépenses et résultat par devise', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const buyer = await user();
    const v1 = await product(owner, orgId, 1000, 20, 'USD', 400);
    const v2 = await product(owner, orgId, 500, 20, 'USD', null); // coût inconnu
    const v3 = await product(owner, orgId, 250, 20, 'CDF', 100);
    // Livrées dans la période : O1 = 3 x V1 + 2 x V2 + 500 de livraison ; O2 = 1 x V1 ; O6 en CDF.
    await order(orgId, buyer, { status: 'delivered', currency: 'USD', fee: 500, daysAgo: 1, items: [{ p: v1, qty: 3, unit: 1000 }, { p: v2, qty: 2, unit: 500 }] }, uniq('O1'));
    await order(orgId, buyer, { status: 'delivered', currency: 'USD', daysAgo: 1, items: [{ p: v1, qty: 1, unit: 1000 }] }, uniq('O2'));
    await order(orgId, buyer, { status: 'delivered', currency: 'CDF', daysAgo: 0, items: [{ p: v3, qty: 4, unit: 250 }] }, uniq('O6'));
    // Ignorées : annulée, en attente, livrée hors période.
    await order(orgId, buyer, { status: 'cancelled', currency: 'USD', daysAgo: 1, items: [{ p: v1, qty: 9, unit: 1000 }] }, uniq('O3'));
    await order(orgId, buyer, { status: 'pending', currency: 'USD', daysAgo: 1, items: [{ p: v1, qty: 9, unit: 1000 }] }, uniq('O4'));
    await order(orgId, buyer, { status: 'delivered', currency: 'USD', daysAgo: 30, items: [{ p: v1, qty: 9, unit: 1000 }] }, uniq('O5'));
    // Caisse : 2 x V1 = 2000 comptés ; une vente annulée ne l'est pas.
    const cash = (lines: object[]) => post(owner, `${base(orgId)}/pos/sales`, { clientId: randomUUID(), paymentMethod: 'cash', lines });
    await cash([{ variantId: v1.variantId, quantity: 2 }]).expect(201);
    const voided = (await cash([{ variantId: v2.variantId, quantity: 1 }]).expect(201)).body;
    await post(owner, `${base(orgId)}/pos/sales/${voided.id}/void`, {}).expect(200);
    // Dépenses : dans la période (USD 1000 + 500 loyer, 300 transport ; CDF 2000 salaires), une hors période.
    await expense(owner, orgId, { category: 'rent', amountMinor: 1000, spentOn: day(-1) }).expect(201);
    await expense(owner, orgId, { category: 'rent', amountMinor: 500, spentOn: day(0) }).expect(201);
    await expense(owner, orgId, { category: 'transport', amountMinor: 300, spentOn: day(0) }).expect(201);
    await expense(owner, orgId, { category: 'salaries', amountMinor: 2000, currency: 'CDF', spentOn: day(0) }).expect(201);
    await expense(owner, orgId, { category: 'other', amountMinor: 9999, spentOn: day(-60) }).expect(201);

    const res = (await get(owner, `${base(orgId)}/profitability?from=${day(-3)}&to=${day(1)}`).expect(200)).body;
    expect(res.currencies.map((c: { currency: string }) => c.currency)).toEqual(['CDF', 'USD']);
    const [cdf, usd] = res.currencies;
    expect(usd).toMatchObject({
      revenueMinor: 7000, // 4000 + 1000 (hors livraison) + 2000 caisse
      ordersRevenueMinor: 5000,
      posRevenueMinor: 2000,
      cogsMinor: 2400, // 6 x 400
      unknownCostLines: 1,
      unknownCostRevenueMinor: 1000,
      grossMarginMinor: 4600,
      expensesMinor: 1800,
      estimatedResultMinor: 2800,
    });
    expect(usd.expensesByCategory).toEqual([
      { category: 'rent', amountMinor: 1500 },
      { category: 'transport', amountMinor: 300 },
    ]);
    expect(usd.topProducts).toEqual([{ productId: v1.productId, title: 'Article 1000USD', quantity: 6, revenueMinor: 6000, costMinor: 2400, marginMinor: 3600 }]);
    expect(cdf).toMatchObject({ revenueMinor: 1000, cogsMinor: 400, unknownCostLines: 0, grossMarginMinor: 600, expensesMinor: 2000, estimatedResultMinor: -1400 });

    const only = (await get(owner, `${base(orgId)}/profitability?from=${day(-3)}&to=${day(1)}&currency=CDF`).expect(200)).body;
    expect(only.currencies).toHaveLength(1);
    // Période vide : aucune devise.
    expect((await get(owner, `${base(orgId)}/profitability?from=${day(-400)}&to=${day(-399)}`).expect(200)).body.currencies).toEqual([]);
  });

  it('tient compte du coupon (lignes au prorata) et déduit les retours remboursés de la période', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const buyer = await user();
    const v = await product(owner, orgId, 1000, 20, 'USD', 400);
    const number = uniq('OC');
    await order(orgId, buyer, { status: 'delivered', currency: 'USD', daysAgo: 1, items: [{ p: v, qty: 2, unit: 1000 }] }, number);
    await ctx.sql.query(`UPDATE orders SET discount_minor = 500, total_minor = total_minor - 500 WHERE number = $1`, [number]);
    const url = `${base(orgId)}/profitability?from=${day(-3)}&to=${day(1)}`;
    let usd = (await get(owner, url).expect(200)).body.currencies[0];
    // 2 x 1000 - 500 de remise : le chiffre d'affaires et le total des lignes disent la même chose.
    expect(usd).toMatchObject({ ordersRevenueMinor: 1500, revenueMinor: 1500, cogsMinor: 800 });
    expect(usd.topProducts[0].revenueMinor).toBe(1500);

    // Un retour vivant par commande : chaque retour a sa propre commande, livrée hors période (elle ne compte pas dans le chiffre d'affaires).
    const ret = async (status: string, resolution: string | null, refund: number, refunded: number | null, ago: number) => {
      const nb = uniq('OR');
      await order(orgId, buyer, { status: 'delivered', currency: 'USD', daysAgo: 40, items: [{ p: v, qty: 1, unit: 1000 }] }, nb);
      const oid = (await ctx.sql.query(`SELECT id FROM orders WHERE number = $1`, [nb])).rows[0].id;
      await ctx.sql.query(
        `INSERT INTO order_returns (order_id, org_id, requested_by, reason, items, refund_minor, refunded_minor, currency, status, resolution, updated_at)
         VALUES ($1, $2, $3, 'other', '[]'::jsonb, $4, $5, 'USD', $6, $7, now() - $8 * interval '1 day')`,
        [oid, orgId, buyer.id, refund, refunded, status, resolution, ago],
      );
    };
    await ret('refunded', 'refund_buyer', 400, 300, 0); // remboursé 300
    await ret('resolved', 'refund_partial', 200, null, 0); // tranché en faveur de l'acheteur : 200
    await ret('resolved', 'reject', 900, null, 0); // refusé : rien
    await ret('requested', null, 900, null, 0); // pas encore remboursé : rien
    await ret('refunded', 'refund_buyer', 900, 900, 40); // hors période : rien
    usd = (await get(owner, url).expect(200)).body.currencies[0];
    expect(usd).toMatchObject({ ordersRevenueMinor: 1000, revenueMinor: 1000, grossMarginMinor: 200 });
  });

  it('refuse les périodes invalides ou de plus de 366 jours, et les rôles sans finance.view', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const manager = await member(orgId, 'manager');
    const finance = await member(orgId, 'finance');
    const stranger = await user();
    await get(owner, `${base(orgId)}/profitability?from=2030-01-01&to=2031-01-01`).expect(200); // 366 jours inclus
    await get(owner, `${base(orgId)}/profitability?from=2030-01-01&to=2031-01-02`).expect(400);
    await get(owner, `${base(orgId)}/profitability?from=2030-02-01&to=2030-01-01`).expect(400);
    await get(owner, `${base(orgId)}/profitability?from=2030-02-30&to=2030-03-01`).expect(400);
    await get(owner, `${base(orgId)}/profitability?from=2030-01-01`).expect(400);
    await get(owner, `${base(orgId)}/profitability`).expect(400);
    await get(owner, `${base(orgId)}/exports/sales.csv?from=2030-01-01&to=2031-01-02`).expect(400);
    await get(owner, `${base(orgId)}/exports/sales.csv`).expect(400);
    await get(manager, `${base(orgId)}/profitability?from=2030-01-01&to=2030-01-31`).expect(403);
    await get(manager, `${base(orgId)}/exports/expenses.csv?from=2030-01-01&to=2030-01-31`).expect(403);
    await get(finance, `${base(orgId)}/profitability?from=2030-01-01&to=2030-01-31`).expect(200);
    await get(stranger, `${base(orgId)}/profitability?from=2030-01-01&to=2030-01-31`).expect(404);
  });
});

describe('exports CSV', () => {
  it('exporte ventes, dépenses et achats avec en-têtes, échappement et protection contre les formules', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const finance = await member(orgId, 'finance');
    const buyer = await user();
    const v1 = await product(owner, orgId, 1000, 20, 'USD', 400);
    await order(orgId, buyer, { status: 'delivered', currency: 'USD', daysAgo: 1, items: [{ p: v1, qty: 2, unit: 1000 }] }, 'ORD-CSV-1');
    await post(owner, `${base(orgId)}/pos/sales`, { clientId: randomUUID(), paymentMethod: 'mobile_money', lines: [{ variantId: v1.variantId, quantity: 1 }] }).expect(201);
    await expense(owner, orgId, { note: '=2+2' }).expect(201);
    await expense(owner, orgId, { note: '+1,5 "promo"', category: 'marketing' }).expect(201);
    await expense(owner, orgId, { note: '@cmd', category: 'taxes' }).expect(201);
    await expense(owner, orgId, { note: 'ligne1\nligne2', category: 'supplies' }).expect(201);
    await expense(owner, orgId, { note: '-note', category: 'other' }).expect(201);
    const sid = (await post(owner, `${base(orgId)}/suppliers`, { name: '=Fournisseur' }).expect(201)).body.id;
    await post(owner, `${base(orgId)}/purchase-orders`, { supplierId: sid, currency: 'USD', lines: [{ description: 'Lot', quantity: 2, unitCostMinor: 50 }] }).expect(201);
    const q = `from=${day(-3)}&to=${day(1)}`;

    const sales = await get(finance, `${base(orgId)}/exports/sales.csv?${q}`).expect(200);
    expect(sales.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(sales.headers['content-disposition']).toContain('attachment');
    const lines = sales.text.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('date,source,reference,currency,total_minor,payment_method');
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.includes(',order,'))).toMatch(/,order,ORD-CSV-1,USD,2000,$/);
    expect(lines.find((l) => l.includes(',pos,'))).toMatch(/,pos,[0-9a-f-]{36},USD,1000,mobile_money$/);

    const exp = await get(finance, `${base(orgId)}/exports/expenses.csv?${q}`).expect(200);
    expect(exp.text.startsWith('﻿date,category,amount_minor,currency,supplier,note\r\n')).toBe(true);
    expect(exp.text).toContain(",'=2+2\r\n");
    expect(exp.text).toContain(',"\'+1,5 ""promo"""\r\n');
    expect(exp.text).toContain(",'@cmd\r\n");
    expect(exp.text).toContain(',"ligne1\nligne2"\r\n');
    expect(exp.text).toContain(",'-note\r\n");
    // Aucune cellule ne commence par un caractère de formule.
    expect(exp.text).not.toMatch(/(^|,)[=+@]/m);

    const purchases = await get(owner, `${base(orgId)}/exports/purchases.csv?${q}`).expect(200);
    expect(purchases.text).toContain('date,number,supplier,status,currency,total_minor,expected_on,lines\r\n');
    expect(purchases.text).toMatch(/,PO-0001,'=Fournisseur,draft,USD,100,,1\r\n/);

    // Période vide : en-têtes seuls.
    const empty = await get(owner, `${base(orgId)}/exports/expenses.csv?from=2020-01-01&to=2020-01-31`).expect(200);
    expect(empty.text).toBe('﻿date,category,amount_minor,currency,supplier,note\r\n');
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'business.export' AND metadata->>'orgId' = $1`, [orgId]);
    expect(audit.rows.length).toBeGreaterThanOrEqual(4);
  });

  it('plafonne le nombre de lignes exportées', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    await ctx.sql.query(
      `INSERT INTO expenses (org_id, category, amount_minor, currency, spent_on) SELECT $1, 'other', 1, 'USD', DATE '2030-03-01' FROM generate_series(1, 10001)`,
      [orgId],
    );
    const res = await get(owner, `${base(orgId)}/exports/expenses.csv?from=2030-03-01&to=2030-03-31`).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
    await get(owner, `${base(orgId)}/exports/expenses.csv?from=2030-04-01&to=2030-04-30`).expect(200);
  });
});

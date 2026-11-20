import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Fournisseurs et bons de commande d'achat avec le vrai catalogue (stock, coût moyen pondéré). */
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
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: uniq('achat'), name: 'Boutique', kind: 'shop' }).expect(201);
  return res.body.id;
}
async function member(orgId: string, role: string): Promise<TU> {
  const u = await user();
  await ctx.sql.query(`INSERT INTO org_members (org_id, user_id, role, status, joined_at) VALUES ($1, $2, $3, 'active', now())`, [orgId, u.id, role]);
  return u;
}
async function variant(owner: TU, orgId: string, stock: number, currency = 'USD'): Promise<string> {
  const res = await ctx.http
    .post(`/v1/orgs/${orgId}/products`)
    .set(bearer(owner.token))
    .send({ title: 'Sac de riz', status: 'published', variants: [{ sku: uniq('SKU'), options: { poids: '25kg' }, priceMinor: 5000, currency, stock }] })
    .expect(201);
  return res.body.variants[0].id;
}
const row = async (id: string) => (await ctx.sql.query(`SELECT stock, cost_minor FROM product_variants WHERE id = $1`, [id])).rows[0] as { stock: number; cost_minor: string | null };
const base = (orgId: string) => `/v1/orgs/${orgId}`;
const post = (t: TU, url: string, body: object = {}) => ctx.http.post(url).set(bearer(t.token)).send(body);
const get = (t: TU, url: string) => ctx.http.get(url).set(bearer(t.token));
const supplier = async (owner: TU, orgId: string, name = uniq('Fournisseur')): Promise<string> =>
  (await post(owner, `${base(orgId)}/suppliers`, { name }).expect(201)).body.id;
const makePo = (owner: TU, orgId: string, supplierId: string, lines: object[], extra: object = {}) =>
  post(owner, `${base(orgId)}/purchase-orders`, { supplierId, currency: 'USD', lines, ...extra });

describe('fournisseurs', () => {
  it('crée, lit, modifie (null efface), refuse un doublon insensible à la casse et un téléphone invalide', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const s = (await post(owner, `${base(orgId)}/suppliers`, { name: 'Régideso Sarl', contactName: 'Awa', phone: '+243810000000', email: 'Achats@Example.com', address: 'Kinshasa', notes: 'Livre le mardi' }).expect(201)).body;
    expect(s).toMatchObject({ name: 'Régideso Sarl', phone: '+243810000000', email: 'achats@example.com', active: true });
    await post(owner, `${base(orgId)}/suppliers`, { name: 'RÉGIDESO SARL' }).expect(409);
    expect((await post(owner, `${base(orgId)}/suppliers`, { name: 'X', phone: '0810000000' }).expect(400)).body.error).toBeDefined();
    await post(owner, `${base(orgId)}/suppliers`, { name: 'Y', email: 'pas-un-email' }).expect(400);
    const patched = (await ctx.http.patch(`${base(orgId)}/suppliers/${s.id}`).set(bearer(owner.token)).send({ notes: null, contactName: 'Bob' }).expect(200)).body;
    expect(patched).toMatchObject({ notes: null, contactName: 'Bob', phone: '+243810000000' });
    await ctx.http.patch(`${base(orgId)}/suppliers/${s.id}`).set(bearer(owner.token)).send({}).expect(400);
    expect((await get(owner, `${base(orgId)}/suppliers/${s.id}`).expect(200)).body.name).toBe('Régideso Sarl');
    // Pagination et filtre actif.
    await supplier(owner, orgId, 'Deuxième');
    const page = (await get(owner, `${base(orgId)}/suppliers?limit=1`).expect(200)).body;
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const next = (await get(owner, `${base(orgId)}/suppliers?limit=1&cursor=${page.nextCursor}`).expect(200)).body;
    expect(next.items[0].id).not.toBe(page.items[0].id);
    await ctx.http.patch(`${base(orgId)}/suppliers/${s.id}`).set(bearer(owner.token)).send({ active: false }).expect(200);
    expect((await get(owner, `${base(orgId)}/suppliers?active=false`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([s.id]);
    // Aucun achat ni dépense : suppression réelle.
    expect((await ctx.http.delete(`${base(orgId)}/suppliers/${s.id}`).set(bearer(owner.token)).expect(200)).body).toEqual({ outcome: 'deleted' });
    await get(owner, `${base(orgId)}/suppliers/${s.id}`).expect(404);
  });

  it('désactive au lieu de supprimer quand un bon de commande existe', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const sid = await supplier(owner, orgId);
    await makePo(owner, orgId, sid, [{ description: 'Carton', quantity: 1, unitCostMinor: 100 }]).expect(201);
    const res = await ctx.http.delete(`${base(orgId)}/suppliers/${sid}`).set(bearer(owner.token)).expect(200);
    expect(res.body).toEqual({ outcome: 'deactivated' });
    expect((await get(owner, `${base(orgId)}/suppliers/${sid}`).expect(200)).body.active).toBe(false);
    // Un fournisseur désactivé ne reçoit plus de commande.
    const again = await makePo(owner, orgId, sid, [{ description: 'Carton', quantity: 1, unitCostMinor: 100 }]).expect(409);
    expect(again.body.error.details).toMatchObject({ reason: 'supplier_inactive' });
  });

  it('plafonne à 500 fournisseurs par organisation', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    await ctx.sql.query(`INSERT INTO suppliers (org_id, name) SELECT $1, 'F' || g FROM generate_series(1, 499) g`, [orgId]);
    await post(owner, `${base(orgId)}/suppliers`, { name: 'Le 500e' }).expect(201);
    const over = await post(owner, `${base(orgId)}/suppliers`, { name: 'Le 501e' }).expect(409);
    expect(over.body.error.details).toMatchObject({ reason: 'supplier_limit' });
  });

  it('applique les droits et isole les organisations', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const stock = await member(orgId, 'stock');
    const finance = await member(orgId, 'finance');
    const employee = await member(orgId, 'employee');
    const stranger = await user();
    await post(stock, `${base(orgId)}/suppliers`, { name: 'Par le stock' }).expect(201);
    await post(finance, `${base(orgId)}/suppliers`, { name: 'Non' }).expect(403);
    await get(employee, `${base(orgId)}/suppliers`).expect(403);
    await get(stranger, `${base(orgId)}/suppliers`).expect(404);
    const other = await user();
    const otherOrg = await createOrg(other);
    const foreign = await supplier(other, otherOrg);
    await get(owner, `${base(orgId)}/suppliers/${foreign}`).expect(404);
    await ctx.http.patch(`${base(orgId)}/suppliers/${foreign}`).set(bearer(owner.token)).send({ name: 'Piraté' }).expect(404);
    await ctx.http.delete(`${base(orgId)}/suppliers/${foreign}`).set(bearer(owner.token)).expect(404);
    await ctx.http.get(`${base(orgId)}/suppliers/pas-un-uuid`).set(bearer(owner.token)).expect(404);
  });
});

describe('bons de commande d\'achat', () => {
  it('parcourt tout le cycle : réception partielle puis complète, stock et coût moyen exacts', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const sid = await supplier(owner, orgId);
    const a = await variant(owner, orgId, 10); // coût inconnu
    const b = await variant(owner, orgId, 3);
    await ctx.sql.query(`UPDATE product_variants SET cost_minor = 100 WHERE id = $1`, [b]);

    const po = (
      await makePo(owner, orgId, sid, [
        { variantId: a, quantity: 10, unitCostMinor: 100 },
        { variantId: b, quantity: 2, unitCostMinor: 151 },
        { description: 'Transport', quantity: 1, unitCostMinor: 5000 },
      ], { expectedOn: '2030-01-31', note: 'Urgent' }).expect(201)
    ).body;
    expect(po).toMatchObject({ number: 'PO-0001', status: 'draft', currency: 'USD', expectedOn: '2030-01-31', totalMinor: 1000 + 302 + 5000, supplierId: sid });
    expect(po.lines[0].description).toBe('Sac de riz (poids: 25kg)');
    const [la, lb, lc] = po.lines as { id: string }[];

    // Brouillon : modifiable, total recalculé par le serveur ; pas de réception.
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/receive`, { lines: [{ lineId: la!.id, quantity: 1 }] }).expect(409);
    const edited = (
      await ctx.http
        .patch(`${base(orgId)}/purchase-orders/${po.id}`)
        .set(bearer(owner.token))
        .send({ note: null, lines: [{ variantId: a, quantity: 10, unitCostMinor: 100 }, { variantId: b, quantity: 2, unitCostMinor: 151 }, { description: 'Transport', quantity: 1, unitCostMinor: 5000 }] })
        .expect(200)
    ).body;
    expect(edited.note).toBeNull();
    expect(edited.totalMinor).toBe(6302);
    const [ea, eb, ec] = edited.lines as { id: string }[];

    const sent = (await post(owner, `${base(orgId)}/purchase-orders/${po.id}/order`).expect(200)).body;
    expect(sent.status).toBe('ordered');
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/order`).expect(409);
    const locked = await ctx.http.patch(`${base(orgId)}/purchase-orders/${po.id}`).set(bearer(owner.token)).send({ note: 'x' }).expect(409);
    expect(locked.body.error.details).toMatchObject({ reason: 'invalid_state', status: 'ordered' });

    // Réception partielle : 4 sur 10 de A (coût inconnu -> 100), 1 sur 2 de B (3 x 100 + 1 x 151 = 451 / 4 = 112,75 -> 113).
    const part = (await post(owner, `${base(orgId)}/purchase-orders/${po.id}/receive`, { lines: [{ lineId: ea!.id, quantity: 4 }, { lineId: eb!.id, quantity: 1 }] }).expect(200)).body;
    expect(part.status).toBe('partially_received');
    expect(part.lines.map((l: { quantityReceived: number }) => l.quantityReceived)).toEqual([4, 1, 0]);
    expect(await row(a)).toMatchObject({ stock: 14, cost_minor: '100' });
    expect(await row(b)).toMatchObject({ stock: 4, cost_minor: '113' });

    // Au-delà du reste attendu : 409, rien ne bouge.
    const over = await post(owner, `${base(orgId)}/purchase-orders/${po.id}/receive`, { lines: [{ lineId: ea!.id, quantity: 7 }] }).expect(409);
    expect(over.body.error.details).toMatchObject({ reason: 'quantity_exceeds_ordered' });
    expect((await row(a)).stock).toBe(14);
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/receive`, { lines: [{ lineId: randomUUID(), quantity: 1 }] }).expect(404);
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/receive`, { lines: [{ lineId: ea!.id, quantity: 1 }, { lineId: ea!.id, quantity: 1 }] }).expect(400);

    // Reste : A 6 (14 x 100 + 6 x 100 -> 100), B 1 (4 x 113 + 151 = 603 / 5 = 120,6 -> 121), ligne libre sans stock.
    const done = (
      await post(owner, `${base(orgId)}/purchase-orders/${po.id}/receive`, { lines: [{ lineId: ea!.id, quantity: 6 }, { lineId: eb!.id, quantity: 1 }, { lineId: ec!.id, quantity: 1 }] }).expect(200)
    ).body;
    expect(done.status).toBe('received');
    expect(await row(a)).toMatchObject({ stock: 20, cost_minor: '100' });
    expect(await row(b)).toMatchObject({ stock: 5, cost_minor: '121' });
    const moves = await ctx.sql.query(`SELECT variant_id, delta, stock_after, reason FROM stock_movements WHERE variant_id = ANY($1) AND reason = 'restock' ORDER BY created_at, delta`, [[a, b]]);
    expect(moves.rows.map((m) => [m.delta, m.stock_after])).toEqual(expect.arrayContaining([[4, 14], [1, 4], [6, 20], [1, 5]]));
    expect(moves.rows).toHaveLength(4);

    // Reçu : plus de réception ni d'annulation.
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/receive`, { lines: [{ lineId: ea!.id, quantity: 1 }] }).expect(409);
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/cancel`).expect(409);
    expect(lb && lc).toBeTruthy();

    // Numéros séquentiels, liste filtrée.
    const second = (await makePo(owner, orgId, sid, [{ description: 'Carton', quantity: 1, unitCostMinor: 1 }]).expect(201)).body;
    expect(second.number).toBe('PO-0002');
    const list = (await get(owner, `${base(orgId)}/purchase-orders?status=received`).expect(200)).body;
    expect(list.items.map((p: { id: string }) => p.id)).toEqual([po.id]);
    expect((await get(owner, `${base(orgId)}/purchase-orders`).expect(200)).body.items[0].id).toBe(second.id);
  });

  it('refuse dès la création du brouillon une devise différente de celle de l’article (409), et la réception si cette devise change ensuite', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const sid = await supplier(owner, orgId);
    const v = await variant(owner, orgId, 5, 'USD');
    const early = await makePo(owner, orgId, sid, [{ variantId: v, quantity: 3, unitCostMinor: 100 }], { currency: 'CDF' }).expect(409);
    expect(early.body.error.details).toMatchObject({ reason: 'currency_mismatch', variantId: v });
    const po = (await makePo(owner, orgId, sid, [{ variantId: v, quantity: 3, unitCostMinor: 100 }]).expect(201)).body;
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/order`).expect(200);
    await ctx.sql.query(`UPDATE product_variants SET currency = 'CDF' WHERE id = $1`, [v]);
    const res = await post(owner, `${base(orgId)}/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, quantity: 3 }] }).expect(409);
    expect(res.body.error.details).toMatchObject({ reason: 'currency_mismatch', variantId: v });
    expect(await row(v)).toMatchObject({ stock: 5, cost_minor: null });
    expect((await get(owner, `${base(orgId)}/purchase-orders/${po.id}`).expect(200)).body.lines[0].quantityReceived).toBe(0);
  });

  it('annule un bon envoyé, pas un bon annulé ou reçu ; un article non suivi ne bouge pas le stock mais fixe le coût', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const sid = await supplier(owner, orgId);
    const v = await variant(owner, orgId, 0);
    await ctx.sql.query(`UPDATE product_variants SET track_stock = false WHERE id = $1`, [v]);
    const untracked = (await makePo(owner, orgId, sid, [{ variantId: v, quantity: 2, unitCostMinor: 70 }]).expect(201)).body;
    await post(owner, `${base(orgId)}/purchase-orders/${untracked.id}/order`).expect(200);
    await post(owner, `${base(orgId)}/purchase-orders/${untracked.id}/receive`, { lines: [{ lineId: untracked.lines[0].id, quantity: 2 }] }).expect(200);
    expect(await row(v)).toMatchObject({ stock: 0, cost_minor: '70' });
    expect((await ctx.sql.query(`SELECT 1 FROM stock_movements WHERE variant_id = $1 AND reason = 'restock'`, [v])).rows).toHaveLength(0);

    const po = (await makePo(owner, orgId, sid, [{ description: 'Palette', quantity: 1, unitCostMinor: 100 }]).expect(201)).body;
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/order`).expect(200);
    expect((await post(owner, `${base(orgId)}/purchase-orders/${po.id}/cancel`).expect(200)).body.status).toBe('cancelled');
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/cancel`).expect(409);
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/order`).expect(409);
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, quantity: 1 }] }).expect(409);
  });

  it('numérote sans trou ni doublon sous concurrence', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const sid = await supplier(owner, orgId);
    const res = await Promise.all(Array.from({ length: 5 }, () => makePo(owner, orgId, sid, [{ description: 'Lot', quantity: 1, unitCostMinor: 1 }])));
    expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(res.map((r) => r.body.number).sort()).toEqual(['PO-0001', 'PO-0002', 'PO-0003', 'PO-0004', 'PO-0005']);
  });

  it('valide les lignes, les droits et l\'isolation', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const stock = await member(orgId, 'stock');
    const finance = await member(orgId, 'finance');
    const manager = await member(orgId, 'manager');
    const sid = await supplier(owner, orgId);
    const other = await user();
    const otherOrg = await createOrg(other);
    const foreignSupplier = await supplier(other, otherOrg);
    const foreignVariant = await variant(other, otherOrg, 1);

    await makePo(owner, orgId, sid, []).expect(400);
    await makePo(owner, orgId, sid, [{ quantity: 1, unitCostMinor: 1 }]).expect(400); // ni article ni description
    await makePo(owner, orgId, sid, [{ description: 'X', quantity: 0, unitCostMinor: 1 }]).expect(400);
    await makePo(owner, orgId, sid, [{ description: 'X', quantity: 1, unitCostMinor: -1 }]).expect(400);
    await makePo(owner, orgId, sid, [{ description: 'X'.repeat(121), quantity: 1, unitCostMinor: 1 }]).expect(400);
    await makePo(owner, orgId, sid, Array.from({ length: 101 }, () => ({ description: 'X', quantity: 1, unitCostMinor: 1 }))).expect(400);
    await makePo(owner, orgId, sid, [{ description: 'X', quantity: 1, unitCostMinor: 1 }], { currency: 'EUR' }).expect(400);
    await makePo(owner, orgId, sid, [{ description: 'X', quantity: 1, unitCostMinor: 1 }], { expectedOn: '2030-02-31' }).expect(400);
    // Article d'une autre organisation : refusé ; fournisseur d'une autre organisation : 404.
    await makePo(owner, orgId, sid, [{ variantId: foreignVariant, quantity: 1, unitCostMinor: 1 }]).expect(400);
    await makePo(owner, orgId, foreignSupplier, [{ description: 'X', quantity: 1, unitCostMinor: 1 }]).expect(404);
    // Total démesuré : refusé plutôt qu'arrondi.
    await makePo(owner, orgId, sid, Array.from({ length: 100 }, () => ({ description: 'X', quantity: 1_000_000, unitCostMinor: 1_000_000_000_000 }))).expect(400);

    await makePo(stock, orgId, sid, [{ description: 'Par le stock', quantity: 1, unitCostMinor: 1 }]).expect(201);
    await makePo(manager, orgId, sid, [{ description: 'Par le gérant', quantity: 1, unitCostMinor: 1 }]).expect(201);
    await makePo(finance, orgId, sid, [{ description: 'Non', quantity: 1, unitCostMinor: 1 }]).expect(403);
    await get(finance, `${base(orgId)}/purchase-orders`).expect(403);

    const foreignPo = (await makePo(other, otherOrg, foreignSupplier, [{ description: 'Z', quantity: 1, unitCostMinor: 1 }]).expect(201)).body;
    await get(owner, `${base(orgId)}/purchase-orders/${foreignPo.id}`).expect(404);
    await post(owner, `${base(orgId)}/purchase-orders/${foreignPo.id}/order`).expect(404);
    await post(owner, `${base(orgId)}/purchase-orders/${foreignPo.id}/cancel`).expect(404);
    await post(owner, `${base(orgId)}/purchase-orders/${foreignPo.id}/receive`, { lines: [{ lineId: foreignPo.lines[0].id, quantity: 1 }] }).expect(404);
    await ctx.http.patch(`${base(orgId)}/purchase-orders/${foreignPo.id}`).set(bearer(owner.token)).send({ note: 'x' }).expect(404);
    expect((await get(owner, `${base(otherOrg)}/purchase-orders`).expect(404)).status).toBe(404);
  });

  it('écrit un audit sans contenu', async () => {
    const owner = await user();
    const orgId = await createOrg(owner);
    const sid = await supplier(owner, orgId, 'Nom très confidentiel');
    const po = (await makePo(owner, orgId, sid, [{ description: 'Note secrète', quantity: 1, unitCostMinor: 5 }], { note: 'Note secrète' }).expect(201)).body;
    await post(owner, `${base(orgId)}/purchase-orders/${po.id}/order`).expect(200);
    const rows = await ctx.sql.query(`SELECT action, metadata::text AS m FROM audit_events WHERE action LIKE 'business.%' AND metadata->>'orgId' = $1`, [orgId]);
    expect(rows.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['business.supplier_created', 'business.po_created', 'business.po_ordered']));
    for (const r of rows.rows) expect(r.m).not.toMatch(/confidentiel|secrète/);
  });
});

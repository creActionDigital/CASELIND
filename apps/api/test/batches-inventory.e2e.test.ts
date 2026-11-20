import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
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

let n = 0;
async function createOrg(owner: TU): Promise<string> {
  const slug = `inv-${Date.now().toString(36)}-${++n}`;
  return (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: 'Entrepot', kind: 'shop' }).expect(201)).body.id;
}

async function addMember(orgId: string, owner: TU, m: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(owner.token)).send({ handle: m.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(m.token)).expect(200);
}

const DAY = 86_400_000;
const date = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

let sku = 0;
async function product(owner: TU, orgId: string, stock: number, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await ctx.http
    .post(`/v1/orgs/${orgId}/products`)
    .set(bearer(owner.token))
    .send({ title: 'Savon-SECRET', description: 'Lot test', variants: [{ sku: `SKU-${Date.now()}-${++sku}`, options: { taille: 'M' }, priceMinor: 1500, currency: 'USD', stock, ...extra }] })
    .expect(201);
  return res.body.variants[0].id;
}

const stockOf = async (variantId: string) => (await ctx.sql.query('SELECT stock FROM product_variants WHERE id = $1', [variantId])).rows[0].stock as number;
const movements = async (variantId: string) =>
  (await ctx.sql.query('SELECT delta, stock_after, reason FROM stock_movements WHERE variant_id = $1 ORDER BY created_at, id', [variantId])).rows as { delta: number; stock_after: number; reason: string }[];

const batches = (u: TU, orgId: string, v: string) => ctx.http.get(`/v1/orgs/${orgId}/variants/${v}/batches`).set(bearer(u.token));
const addBatch = (u: TU, orgId: string, v: string, body: Record<string, unknown>) => ctx.http.post(`/v1/orgs/${orgId}/variants/${v}/batches`).set(bearer(u.token)).send(body);

describe('batches and expiry', () => {
  it('records batches as information, enters stock only on request, corrects and consumes without touching the stock', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const v = await product(owner, org, 5);

    const l1 = (await addBatch(owner, org, v, { batchCode: 'L1', expiresOn: date(3), quantity: 10, note: 'Fournisseur A' }).expect(201)).body;
    expect(l1).toMatchObject({ batchCode: 'L1', quantityReceived: 10, quantityRemaining: 10, expired: false, daysToExpiry: 3 });
    expect(await stockOf(v)).toBe(5);

    const l2 = (await addBatch(owner, org, v, { batchCode: 'L2', expiresOn: date(20), quantity: 4, enterStock: true }).expect(201)).body;
    expect(await stockOf(v)).toBe(9);
    expect((await movements(v)).at(-1)).toEqual({ delta: 4, stock_after: 9, reason: 'restock' });

    const dup = await addBatch(owner, org, v, { batchCode: 'L1', quantity: 1 }).expect(409);
    expect(dup.body.error.details.reason).toBe('batch_code_taken');
    await addBatch(owner, org, v, { batchCode: '', quantity: 1 }).expect(400);
    await addBatch(owner, org, v, { batchCode: 'x'.repeat(41), quantity: 1 }).expect(400);
    await addBatch(owner, org, v, { batchCode: 'Z', quantity: 0 }).expect(400);
    await addBatch(owner, org, v, { batchCode: 'Z', quantity: 1, expiresOn: '2026-02-30' }).expect(400);
    const l3 = (await addBatch(owner, org, v, { batchCode: 'L3', quantity: 2 }).expect(201)).body;
    expect(l3.expiresOn).toBeNull();
    const l4 = (await addBatch(owner, org, v, { batchCode: 'L4', expiresOn: date(-5), quantity: 3 }).expect(201)).body;
    expect(l4).toMatchObject({ expired: true, daysToExpiry: -5 });

    // A batch does not have to cover the whole stock (9 in stock, 19 in batches here is fine too).
    expect((await batches(owner, org, v).expect(200)).body.items.map((b: { batchCode: string }) => b.batchCode)).toEqual(['L4', 'L1', 'L2', 'L3']);

    // Corrections.
    const bad = await ctx.http.patch(`/v1/orgs/${org}/variants/${v}/batches/${l1.id}`).set(bearer(owner.token)).send({ quantityRemaining: 11 }).expect(409);
    expect(bad.body.error.details.reason).toBe('quantity_exceeds_received');
    await ctx.http.patch(`/v1/orgs/${org}/variants/${v}/batches/${l1.id}`).set(bearer(owner.token)).send({}).expect(400);
    await ctx.http.patch(`/v1/orgs/${org}/variants/${v}/batches/${l1.id}`).set(bearer(owner.token)).send({ batchCode: 'L2' }).expect(409);
    const fixed = (await ctx.http.patch(`/v1/orgs/${org}/variants/${v}/batches/${l3.id}`).set(bearer(owner.token)).send({ expiresOn: date(60), note: null }).expect(200)).body;
    expect(fixed).toMatchObject({ expiresOn: date(60), note: null });
    const cleared = (await ctx.http.patch(`/v1/orgs/${org}/variants/${v}/batches/${l3.id}`).set(bearer(owner.token)).send({ expiresOn: null }).expect(200)).body;
    expect(cleared.expiresOn).toBeNull();

    // Manual consumption: batch information only, the stock stays 9.
    const c = (await ctx.http.post(`/v1/orgs/${org}/variants/${v}/batches/${l1.id}/consume`).set(bearer(owner.token)).send({ quantity: 3 }).expect(200)).body;
    expect(c.quantityRemaining).toBe(7);
    expect(await stockOf(v)).toBe(9);
    expect((await movements(v)).length).toBe(2);
    const over = await ctx.http.post(`/v1/orgs/${org}/variants/${v}/batches/${l1.id}/consume`).set(bearer(owner.token)).send({ quantity: 8 }).expect(409);
    expect(over.body.error.details).toMatchObject({ reason: 'batch_insufficient', remaining: 7 });
    await ctx.http.post(`/v1/orgs/${org}/variants/${v}/batches/${l1.id}/consume`).set(bearer(owner.token)).send({ quantity: 0 }).expect(400);

    // FEFO: nearest expiry first, undated last, expired flagged and kept out of the plan.
    const fefo = (await ctx.http.get(`/v1/orgs/${org}/variants/${v}/batches/fefo?quantity=12`).set(bearer(owner.token)).expect(200)).body;
    expect(fefo.items.map((b: { batchCode: string }) => b.batchCode)).toEqual(['L4', 'L1', 'L2', 'L3']);
    expect(fefo.plan).toEqual([{ batchId: l1.id, batchCode: 'L1', take: 7 }, { batchId: l2.id, batchCode: 'L2', take: 4 }, { batchId: l3.id, batchCode: 'L3', take: 1 }]);
    expect(fefo.shortfall).toBe(0);
    expect((await ctx.http.get(`/v1/orgs/${org}/variants/${v}/batches/fefo?quantity=100`).set(bearer(owner.token)).expect(200)).body.shortfall).toBe(100 - 13);
    expect((await ctx.http.get(`/v1/orgs/${org}/variants/${v}/batches/fefo`).set(bearer(owner.token)).expect(200)).body.plan).toBeNull();

    // Expiring list: undated batches are not in it, expired ones are.
    const exp = (await ctx.http.get(`/v1/orgs/${org}/batches/expiring?days=30`).set(bearer(owner.token)).expect(200)).body.items;
    expect(exp.map((b: { batchCode: string }) => b.batchCode)).toEqual(['L4', 'L1', 'L2']);
    expect(exp[0]).toMatchObject({ productTitle: 'Savon-SECRET', expired: true });
    expect((await ctx.http.get(`/v1/orgs/${org}/batches/expiring?days=5`).set(bearer(owner.token)).expect(200)).body.items).toHaveLength(2);
    await ctx.http.get(`/v1/orgs/${org}/batches/expiring?days=400`).set(bearer(owner.token)).expect(400);

    // Audit: ids and quantities, never notes or titles.
    const { rows } = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE action LIKE 'stock.batch_%' AND metadata->>'orgId' = $1`, [org]);
    expect(rows.length).toBe(7);
    expect(JSON.stringify(rows)).not.toMatch(/Fournisseur A|Savon-SECRET/);
  });

  it('refuses enterStock on an untracked variant atomically, and enforces permissions and isolation', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const [stock, employee, sales, stranger] = [await user(), await user(), await user(), await user()];
    await addMember(org, owner, stock, 'stock');
    await addMember(org, owner, employee, 'employee');
    await addMember(org, owner, sales, 'sales');
    const other = await createOrg(stranger);
    const untracked = await product(owner, org, 0, { trackStock: false });
    const tracked = await product(owner, org, 2);
    const foreign = await product(stranger, other, 2);

    const r = await addBatch(owner, org, untracked, { batchCode: 'U1', quantity: 5, enterStock: true }).expect(409);
    expect(r.body.error.details.reason).toBe('stock_not_tracked');
    expect((await batches(owner, org, untracked).expect(200)).body.items).toHaveLength(0);
    // Without enterStock the information alone is allowed.
    await addBatch(owner, org, untracked, { batchCode: 'U1', quantity: 5 }).expect(201);

    await addBatch(stock, org, tracked, { batchCode: 'S1', quantity: 1 }).expect(201);
    await addBatch(employee, org, tracked, { batchCode: 'E1', quantity: 1 }).expect(403);
    await addBatch(sales, org, tracked, { batchCode: 'E1', quantity: 1 }).expect(403);
    await batches(employee, org, tracked).expect(403);
    await ctx.http.get(`/v1/orgs/${org}/batches/expiring`).set(bearer(employee.token)).expect(403);
    await batches(stranger, org, tracked).expect(404);
    await ctx.http.get(`/v1/orgs/${org}/batches/expiring`).set(bearer(stranger.token)).expect(404);
    // A variant of another organisation is never reachable through this one.
    await batches(owner, org, foreign).expect(404);
    await addBatch(owner, org, foreign, { batchCode: 'F1', quantity: 1, enterStock: true }).expect(404);
    expect(await stockOf(foreign)).toBe(2);
    const fb = (await addBatch(stranger, other, foreign, { batchCode: 'F1', quantity: 1 }).expect(201)).body;
    await ctx.http.post(`/v1/orgs/${org}/variants/${tracked}/batches/${fb.id}/consume`).set(bearer(owner.token)).send({ quantity: 1 }).expect(404);
    await ctx.http.patch(`/v1/orgs/${org}/variants/${foreign}/batches/${fb.id}`).set(bearer(owner.token)).send({ note: 'x' }).expect(404);
    await batches(owner, org, 'not-a-uuid').expect(404);
  });
});

describe('expiry alerts', () => {
  it('notifies inventory.manage members once per batch and threshold, generically', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const [stock, employee] = [await user(), await user()];
    await addMember(org, owner, stock, 'stock');
    await addMember(org, owner, employee, 'employee');
    const v = await product(owner, org, 5);
    const soon = (await addBatch(owner, org, v, { batchCode: 'SOON', expiresOn: date(3), quantity: 5 }).expect(201)).body;
    await addBatch(owner, org, v, { batchCode: 'PAST', expiresOn: date(-1), quantity: 5 }).expect(201);
    await addBatch(owner, org, v, { batchCode: 'FAR', expiresOn: date(40), quantity: 5 }).expect(201);
    await addBatch(owner, org, v, { batchCode: 'EMPTY', expiresOn: date(1), quantity: 1 }).then(async (r) => {
      await ctx.http.post(`/v1/orgs/${org}/variants/${v}/batches/${r.body.id}/consume`).set(bearer(owner.token)).send({ quantity: 1 }).expect(200);
    });

    const count = async (userId: string) =>
      (await ctx.sql.query(`SELECT title, body, data FROM notifications WHERE user_id = $1 AND data->>'orgId' = $2 AND data->>'type' LIKE 'stock.batches_%'`, [userId, org])).rows;
    const maintenance = ctx.app.get(MaintenanceService);
    await maintenance.runOnce();
    const first = await count(owner.id);
    expect(first.map((r) => r.data.type).sort()).toEqual(['stock.batches_expired', 'stock.batches_soon']);
    expect((await count(stock.id)).length).toBe(2);
    expect(await count(employee.id)).toHaveLength(0);
    expect(JSON.stringify(first)).not.toMatch(/SOON|PAST|Savon-SECRET/);

    // Runs again (the maintenance is hourly): nothing new.
    await maintenance.runOnce();
    expect(await count(owner.id)).toHaveLength(2);

    // A new expiry date restarts the alerts of that batch; the other batches are not alerted again.
    await ctx.http.patch(`/v1/orgs/${org}/variants/${v}/batches/${soon.id}`).set(bearer(owner.token)).send({ expiresOn: date(2) }).expect(200);
    await maintenance.runOnce();
    expect((await count(owner.id)).filter((r) => r.data.type === 'stock.batches_soon')).toHaveLength(2);
    expect((await count(owner.id)).filter((r) => r.data.type === 'stock.batches_expired')).toHaveLength(1);
  });
});

describe('physical inventory', () => {
  it('opens one count, freezes system quantities, computes variances and applies exact adjustments', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const stranger = await user();
    const other = await createOrg(stranger);
    const [v1, v2, v3] = [await product(owner, org, 9), await product(owner, org, 12), await product(owner, org, 5)];
    const untracked = await product(owner, org, 0, { trackStock: false });
    const foreign = await product(stranger, other, 3);
    const counts = `/v1/orgs/${org}/inventory-counts`;

    const c = (await ctx.http.post(counts).set(bearer(owner.token)).send({ note: 'Fin de mois' }).expect(201)).body;
    expect(c).toMatchObject({ status: 'open', note: 'Fin de mois', lines: [], lineCount: 0, applied: false });
    expect((await ctx.http.post(counts).set(bearer(owner.token)).send({}).expect(409)).body.error.details.reason).toBe('count_already_open');
    // Another organisation can have its own.
    await ctx.http.post(`/v1/orgs/${other}/inventory-counts`).set(bearer(stranger.token)).send({}).expect(201);

    const put = (lines: unknown) => ctx.http.put(`${counts}/${c.id}/lines`).set(bearer(owner.token)).send({ lines });
    await put([{ variantId: foreign, countedQuantity: 1 }]).expect(404);
    await put([{ variantId: untracked, countedQuantity: 1 }]).expect(409);
    await put([{ variantId: v1, countedQuantity: -1 }]).expect(400);
    await put([{ variantId: v1, countedQuantity: 1 }, { variantId: v1, countedQuantity: 2 }]).expect(400);
    await put([]).expect(400);
    // A failed request leaves nothing behind (the foreign variant came with a valid one).
    await put([{ variantId: v1, countedQuantity: 1 }, { variantId: foreign, countedQuantity: 1 }]).expect(404);
    expect((await ctx.http.get(`${counts}/${c.id}`).set(bearer(owner.token)).expect(200)).body.lines).toHaveLength(0);

    const d1 = (await put([{ variantId: v1, countedQuantity: 8 }, { variantId: v2, countedQuantity: 15 }, { variantId: v3, countedQuantity: 5 }]).expect(200)).body;
    expect(d1).toMatchObject({ lineCount: 3, discrepancyCount: 2, netVariance: 2 });
    const byId = (d: typeof d1, id: string) => d.lines.find((l: { variantId: string }) => l.variantId === id);
    expect(byId(d1, v1)).toMatchObject({ systemQuantity: 9, countedQuantity: 8, variance: -1, productTitle: 'Savon-SECRET' });
    expect(byId(d1, v2)).toMatchObject({ systemQuantity: 12, countedQuantity: 15, variance: 3 });
    expect(byId(d1, v3)).toMatchObject({ systemQuantity: 5, variance: 0 });

    // Stock moves during the count, then the line is counted again: the recount re-reads the stock of that moment (counting after the movement must not subtract it twice).
    await ctx.http.post(`/v1/orgs/${org}/variants/${v1}/stock`).set(bearer(owner.token)).send({ delta: -4, reason: 'damage' }).expect(200);
    const d2 = (await put([{ variantId: v1, countedQuantity: 7 }]).expect(200)).body;
    expect(byId(d2, v1)).toMatchObject({ systemQuantity: 5, countedQuantity: 7, variance: 2 });
    // The line that was not recounted keeps the stock photographed when it was entered.
    expect(byId(d2, v2)).toMatchObject({ systemQuantity: 12, countedQuantity: 15, variance: 3 });
    expect(await stockOf(v1)).toBe(5);

    // Not the org's count: 404; employees: 403.
    await ctx.http.get(`${counts}/${c.id}`).set(bearer(stranger.token)).expect(404);
    await ctx.http.put(`/v1/orgs/${other}/inventory-counts/${c.id}/lines`).set(bearer(stranger.token)).send({ lines: [{ variantId: foreign, countedQuantity: 1 }] }).expect(404);
    await ctx.http.post(`/v1/orgs/${other}/inventory-counts/${c.id}/close`).set(bearer(stranger.token)).send({ apply: true }).expect(404);

    // Applying: stock 5 + 2 = 7 for v1 (what was counted), 12 + 3 = 15 for v2, v3 untouched, one adjustment per variance.
    const closed = (await ctx.http.post(`${counts}/${c.id}/close`).set(bearer(owner.token)).send({ apply: true }).expect(200)).body;
    expect(closed).toMatchObject({ status: 'closed', applied: true, discrepancyCount: 2 });
    expect(closed.closedAt).not.toBeNull();
    expect(await stockOf(v1)).toBe(7);
    expect(await stockOf(v2)).toBe(15);
    expect(await stockOf(v3)).toBe(5);
    expect((await movements(v1)).at(-1)).toEqual({ delta: 2, stock_after: 7, reason: 'adjustment' });
    expect((await movements(v2)).at(-1)).toEqual({ delta: 3, stock_after: 15, reason: 'adjustment' });
    expect((await movements(v3)).filter((m) => m.reason === 'adjustment')).toHaveLength(0);

    // Closed: no more entries, no second closing, a new count can be opened.
    expect((await put([{ variantId: v1, countedQuantity: 1 }]).expect(409)).body.error.details.reason).toBe('count_not_open');
    await ctx.http.post(`${counts}/${c.id}/close`).set(bearer(owner.token)).send({ apply: true }).expect(409);
    await ctx.http.post(`${counts}/${c.id}/cancel`).set(bearer(owner.token)).expect(409);
    const c2 = (await ctx.http.post(counts).set(bearer(owner.token)).send({}).expect(201)).body;

    // Closing without applying leaves the stock alone.
    await ctx.http.put(`${counts}/${c2.id}/lines`).set(bearer(owner.token)).send({ lines: [{ variantId: v3, countedQuantity: 1 }] }).expect(200);
    const noApply = (await ctx.http.post(`${counts}/${c2.id}/close`).set(bearer(owner.token)).send({ apply: false }).expect(200)).body;
    expect(noApply).toMatchObject({ status: 'closed', applied: false, discrepancyCount: 1 });
    expect(await stockOf(v3)).toBe(5);
    expect((await movements(v3)).filter((m) => m.reason === 'adjustment')).toHaveLength(0);

    // The list keeps history, newest first.
    const list = (await ctx.http.get(counts).set(bearer(owner.token)).expect(200)).body.items;
    expect(list.map((x: { id: string }) => x.id)).toEqual([c2.id, c.id]);

    // Audit: counts only, no product name or note.
    const { rows } = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE action LIKE 'inventory.count_%' AND metadata->>'orgId' = $1 ORDER BY id`, [org]);
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['inventory.count_opened', 'inventory.count_lines_saved', 'inventory.count_lines_saved', 'inventory.count_closed', 'inventory.count_opened', 'inventory.count_lines_saved', 'inventory.count_closed']);
    expect(rows[3].metadata).toMatchObject({ apply: true, discrepancies: 2, movements: 2 });
    expect(JSON.stringify(rows)).not.toMatch(/Savon-SECRET|Fin de mois/);
  });

  it('never lets the stock go negative: a closing that would is refused whole, and an open count can be cancelled', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const employee = await user();
    await addMember(org, owner, employee, 'employee');
    const [a, b] = [await product(owner, org, 5), await product(owner, org, 5)];
    const counts = `/v1/orgs/${org}/inventory-counts`;
    await ctx.http.post(counts).set(bearer(employee.token)).send({}).expect(403);
    const c = (await ctx.http.post(counts).set(bearer(owner.token)).send({}).expect(201)).body;
    // Variant a: counted 8 (+3, fine); variant b: counted 0 (-5), but meanwhile 4 units go out.
    await ctx.http.put(`${counts}/${c.id}/lines`).set(bearer(owner.token)).send({ lines: [{ variantId: a, countedQuantity: 8 }, { variantId: b, countedQuantity: 0 }] }).expect(200);
    await ctx.http.post(`/v1/orgs/${org}/variants/${b}/stock`).set(bearer(owner.token)).send({ delta: -4, reason: 'damage' }).expect(200);
    const before = [(await movements(a)).length, (await movements(b)).length];

    const refused = await ctx.http.post(`${counts}/${c.id}/close`).set(bearer(owner.token)).send({ apply: true }).expect(409);
    expect(refused.body.error.details).toMatchObject({ reason: 'stock_negative', variantId: b });
    expect(await stockOf(a)).toBe(5);
    expect(await stockOf(b)).toBe(1);
    expect([(await movements(a)).length, (await movements(b)).length]).toEqual(before);
    expect((await ctx.http.get(`${counts}/${c.id}`).set(bearer(owner.token)).expect(200)).body.status).toBe('open');

    // Fix the count and close, or cancel.
    await ctx.http.put(`${counts}/${c.id}/lines`).set(bearer(owner.token)).send({ lines: [{ variantId: b, countedQuantity: 1 }] }).expect(200);
    const cancelled = (await ctx.http.post(`${counts}/${c.id}/cancel`).set(bearer(owner.token)).expect(200)).body;
    expect(cancelled).toMatchObject({ status: 'cancelled', applied: false });
    expect(await stockOf(a)).toBe(5);
    // Cancelled counts free the slot.
    await ctx.http.post(counts).set(bearer(owner.token)).send({}).expect(201);
    await ctx.http.get(`${counts}/not-a-uuid`).set(bearer(owner.token)).expect(404);
  });
});

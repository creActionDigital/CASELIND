import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function upload(u: TU, purpose: string): Promise<string> {
  const up = await ctx.http.post('/v1/media/uploads').set(bearer(u.token)).send({ purpose, mime: 'image/png', sizeBytes: PNG.length }).expect(201);
  await ctx.http.put(up.body.uploadUrl).set(bearer(u.token)).set('X-Upload-Token', up.body.uploadToken).set('Content-Type', 'application/octet-stream').send(PNG).expect(200);
  return up.body.assetId as string;
}

/** A seller with a published product, and a buyer holding an order of it in the given status (rows inserted directly: the checkout is covered elsewhere). */
async function setup(status = 'delivered') {
  const owner = await user();
  const buyer = await user();
  const org = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: uniq('shop'), name: 'Boutique', kind: 'shop' }).expect(201)).body;
  const product = (
    await ctx.http
      .post(`/v1/orgs/${org.id}/products`)
      .set(bearer(owner.token))
      .send({ title: 'Guide PDF', status: 'published', variants: [{ sku: uniq('SKU'), options: {}, priceMinor: 500, currency: 'USD', stock: 5, trackStock: false }] })
      .expect(201)
  ).body as { id: string; variants: { id: string }[] };
  const orderId = randomUUID();
  await ctx.sql.query(
    `INSERT INTO orders (id, number, buyer_id, org_id, client_id, currency, status, subtotal_minor, total_minor, payment_method)
     VALUES ($1, $2, $3, $4, $5, 'USD', $6, 500, 500, 'cash_on_delivery')`,
    [orderId, uniq('N'), buyer.id, org.id, randomUUID(), status],
  );
  await ctx.sql.query(
    `INSERT INTO order_items (order_id, variant_id, product_id, title, unit_price_minor, quantity, line_total_minor) VALUES ($1, $2, $3, 'Guide PDF', 500, 1, 500)`,
    [orderId, product.variants[0]!.id, product.id],
  );
  return { owner, buyer, org, product, orderId };
}

const putFiles = (u: TU, orgId: string, productId: string, ids: string[]) => ctx.http.put(`/v1/orgs/${orgId}/products/${productId}/files`).set(bearer(u.token)).send({ assetIds: ids });
const read = (u: TU, url: string) => ctx.http.get(url).set(bearer(u.token));

describe('digital products', () => {
  it('the seller attaches files; a buyer reads them only once the order is delivered', async () => {
    const s = await setup('shipped');
    const file = await upload(s.owner, 'digital_file');
    const set = await putFiles(s.owner, s.org.id, s.product.id, [file]).expect(200);
    expect(set.body.items.map((f: { id: string }) => f.id)).toEqual([file]);
    const url = set.body.items[0].contentUrl as string;

    // Not delivered yet: no download, no content for the buyer; a stranger never.
    expect((await ctx.http.get('/v1/me/downloads').set(bearer(s.buyer.token)).expect(200)).body.items).toEqual([]);
    await read(s.buyer, url).expect(404);
    await read(await user(), url).expect(404);
    await read(s.owner, url).expect(200);

    await ctx.sql.query(`UPDATE orders SET status = 'delivered' WHERE id = $1`, [s.orderId]);
    const dl = (await ctx.http.get('/v1/me/downloads').set(bearer(s.buyer.token)).expect(200)).body.items;
    expect(dl).toHaveLength(1);
    expect(dl[0]).toMatchObject({ orderId: s.orderId, productId: s.product.id, title: 'Guide PDF' });
    expect(dl[0].files.map((f: { id: string }) => f.id)).toEqual([file]);
    const res = await read(s.buyer, url).expect(200);
    expect(res.headers['cache-control']).toContain('no-store');
    // Another buyer without an order still gets nothing.
    await read(await user(), url).expect(404);
  });

  it('replaces and removes files (dropped ones are deleted) and refuses bad input', async () => {
    const s = await setup();
    const [a, b] = [await upload(s.owner, 'digital_file'), await upload(s.owner, 'digital_file')];
    await putFiles(s.owner, s.org.id, s.product.id, [a]).expect(200);
    const second = await putFiles(s.owner, s.org.id, s.product.id, [b]).expect(200);
    expect(second.body.items.map((f: { id: string }) => f.id)).toEqual([b]);
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM media_assets WHERE id = $1`, [a])).rows[0].n).toBe(0);

    await putFiles(s.owner, s.org.id, s.product.id, [await upload(s.owner, 'product')]).expect(400); // wrong purpose
    await putFiles(s.owner, s.org.id, s.product.id, [await upload(s.buyer, 'digital_file')]).expect(400); // someone else's upload
    await putFiles(s.owner, s.org.id, s.product.id, Array.from({ length: 6 }, () => randomUUID())).expect(400); // more than 5
    await putFiles(s.buyer, s.org.id, s.product.id, [b]).expect(404); // not a member
    const other = await setup();
    await putFiles(s.owner, s.org.id, other.product.id, []).expect(404); // product of another organisation

    await putFiles(s.owner, s.org.id, s.product.id, []).expect(200);
    expect((await ctx.http.get(`/v1/orgs/${s.org.id}/products/${s.product.id}/files`).set(bearer(s.owner.token)).expect(200)).body.items).toEqual([]);
    expect((await ctx.http.get('/v1/me/downloads').set(bearer(s.buyer.token)).expect(200)).body.items).toEqual([]);
  });

  it('audits the change without file details', async () => {
    const s = await setup();
    await putFiles(s.owner, s.org.id, s.product.id, [await upload(s.owner, 'digital_file')]).expect(200);
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'catalog.product_files_set' AND actor_user_id = $1`, [s.owner.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toMatchObject({ count: 1, productId: s.product.id });
  });
});

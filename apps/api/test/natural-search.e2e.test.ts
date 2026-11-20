import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

interface Call {
  body: any;
}

let ctx: TestContext;
const calls: Call[] = [];
/** What the fake model answers (the refinement JSON); null = a provider failure. */
let modelAnswer: string | null = '{}';

const fakeFetch = async (_url: string, init: RequestInit): Promise<Response> => {
  calls.push({ body: JSON.parse(String(init.body)) });
  if (modelAnswer === null) return new Response('boom', { status: 500 });
  return Response.json({ choices: [{ message: { role: 'assistant', content: modelAnswer }, finish_reason: 'stop' }], usage: {} });
};

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
const uniq = (p: string) => `${p}${Date.now().toString(36)}${++n}`.replace(/[^a-z0-9]/gi, '');
async function org(owner: TU, kind: string, city: string, name = 'Boutique'): Promise<string> {
  const id = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: uniq('o'), name, kind }).expect(201)).body.id;
  await ctx.sql.query(`UPDATE organizations SET city = $1 WHERE id = $2`, [city, id]);
  return id;
}
async function product(owner: TU, orgId: string, title: string, priceMinor: number, currency = 'USD'): Promise<void> {
  await ctx.http
    .post(`/v1/orgs/${orgId}/products`)
    .set(bearer(owner.token))
    .send({ title, status: 'published', variants: [{ sku: uniq('sku'), options: {}, priceMinor, currency, stock: 5 }] })
    .expect(201);
}
const natural = (u: TU, q: string) => ctx.http.get(`/v1/search/natural?q=${encodeURIComponent(q)}`).set(bearer(u.token));

beforeAll(async () => {
  ctx = await createTestContext({ GROQ_API_KEY: 'q-key', AI_RATE_LIMIT_PER_MINUTE: '1000', AI_DAILY_MESSAGES: '100', SEARCH_RATE_LIMIT_PER_MINUTE: '1000' }, { aiFetch: fakeFetch });
  const admin = await user();
  await ctx.sql.query(`UPDATE users SET roles = ARRAY['user','admin'] WHERE id = $1`, [admin.id]);
  await ctx.http.patch('/v1/admin/ai/models/groq-llama').set(bearer(admin.token)).send({ enabled: true }).expect(200);
});
afterAll(async () => {
  await ctx.close();
});

describe('natural-language search', () => {
  let seller: TU;
  beforeAll(async () => {
    seller = await user();
    const goma = await org(seller, 'shop', 'Goma', 'Chez Amani');
    const bukavu = await org(seller, 'shop', 'Bukavu', 'Chez Zawadi');
    await org(seller, 'restaurant', 'Goma', 'Resto du lac');
    await org(seller, 'pharmacy', 'Goma', 'Pharmacie centrale');
    await product(seller, goma, 'Sandales cuir', 1500);
    await product(seller, goma, 'Sandales luxe', 9000);
    await product(seller, goma, 'Sandales en CDF', 1000, 'CDF');
    await product(seller, bukavu, 'Sandales Bukavu', 1200);
  });

  it('applies the deterministic filters: keywords, price, currency, city, cheapest first', async () => {
    const u = await user();
    const res = await natural(u, 'sandales pas chères moins de 20 $ près de Goma').expect(200);
    expect(res.body.interpretation.refinedByAi).toBe(false);
    expect(res.body.interpretation.filters).toMatchObject({ keywords: 'sandales', maxPriceMinor: 2000, currency: 'USD', city: 'Goma', cheapFirst: true });
    expect(res.body.results.products.map((p: any) => p.title)).toEqual(['Sandales cuir']);
    expect(res.body.results.places).toEqual([]);
    expect(calls).toHaveLength(0); // no consent: the rules alone

    const all = await natural(u, 'sandales pas cher').expect(200);
    expect(all.body.results.products.map((p: any) => p.minPriceMinor)).toEqual([1000, 1200, 1500, 9000]);
    // A price without a currency is read in USD and says so; CDF is excluded.
    const priced = await natural(u, 'sandales moins de 100').expect(200);
    expect(priced.body.interpretation.filters.currency).toBe('USD');
    expect(priced.body.results.products.map((p: any) => p.title).sort()).toEqual(['Sandales Bukavu', 'Sandales cuir', 'Sandales luxe']);
  });

  it('filters on the effective price: a promotion brings a product under the maximum', async () => {
    const owner = await user();
    const orgId = await org(owner, 'shop', 'Uvira', 'Chez Promo');
    const p = (await ctx.http.post(`/v1/orgs/${orgId}/products`).set(bearer(owner.token)).send({ title: 'Tongs soldes', status: 'published', variants: [{ sku: uniq('sku'), options: {}, priceMinor: 5000, currency: 'USD', stock: 5 }] }).expect(201)).body;
    const u = await user();
    expect((await natural(u, 'tongs soldes moins de 30 $ à Uvira').expect(200)).body.results.products).toEqual([]);
    await ctx.http.post(`/v1/orgs/${orgId}/promotions`).set(bearer(owner.token)).send({ productId: p.id, kind: 'percent', value: 50, label: 'Soldes', endsAt: new Date(Date.now() + 36e5).toISOString() }).expect(201);
    const hits = (await natural(u, 'tongs soldes moins de 30 $ à Uvira').expect(200)).body.results.products;
    expect(hits.map((h: any) => h.minPriceMinor)).toEqual([2500]);
  });

  it('finds places by type and city, and runs again with filters edited by the user', async () => {
    const u = await user();
    const res = await natural(u, 'restaurant à Goma').expect(200);
    expect(res.body.interpretation.filters).toMatchObject({ placeKind: 'restaurant', city: 'Goma' });
    expect(res.body.results.places.map((p: any) => p.name)).toEqual(['Resto du lac']);
    expect(res.body.results.products).toEqual([]);

    const edited = await ctx.http
      .post('/v1/search/natural/filters')
      .set(bearer(u.token))
      .send({ filters: { ...res.body.interpretation.filters, placeKind: 'pharmacy' } })
      .expect(200);
    expect(edited.body.results.places.map((p: any) => p.name)).toEqual(['Pharmacie centrale']);
    expect(edited.body.interpretation.refinedByAi).toBe(false);
    await ctx.http.post('/v1/search/natural/filters').set(bearer(u.token)).send({ filters: { ...res.body.interpretation.filters, placeKind: 'nope' } }).expect(400);
  });

  it('validates the phrase and needs a session', async () => {
    const u = await user();
    await natural(u, 'x').expect(400);
    await natural(u, 'y'.repeat(201)).expect(400);
    await ctx.http.get('/v1/search/natural?q=sandales').expect(401);
  });

  it('refines with the model only with the ai_processing consent, sending the phrase alone and validating the answer', async () => {
    const u = await user();
    await ctx.http.put('/v1/me/consents/ai_processing').set(bearer(u.token)).send({ granted: true }).expect(200);
    modelAnswer = '```json\n{"keywords":"sandales","categorySlug":"mode","city":"Goma","maxPriceMinor":999999}\n```';
    const phrase = 'des sandales confortables chez Goma';
    const res = await natural(u, phrase).expect(200);
    expect(res.body.interpretation.refinedByAi).toBe(true);
    expect(res.body.interpretation.filters).toMatchObject({ keywords: 'sandales', categorySlug: 'mode', city: 'Goma', maxPriceMinor: 999999 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.messages.at(-1)).toEqual({ role: 'user', content: phrase });
    expect(JSON.stringify(calls[0]!.body)).not.toContain(u.id);

    // The rules win over the model on what they found.
    modelAnswer = '{"maxPriceMinor":1,"city":"Paris"}';
    const kept = await natural(u, 'sandales moins de 20 $ à Bukavu').expect(200);
    expect(kept.body.interpretation.filters).toMatchObject({ maxPriceMinor: 2000, city: 'Bukavu' });

    // Anything outside the schema, or a provider failure, leaves the rules' interpretation.
    modelAnswer = '{"sql":"DROP TABLE users"}';
    const bad = await natural(u, 'sandales pas chères').expect(200);
    expect(bad.body.interpretation).toMatchObject({ refinedByAi: false, filters: { keywords: 'sandales', cheapFirst: true } });
    modelAnswer = null;
    const down = await natural(u, 'sandales pas chères').expect(200);
    expect(down.body.interpretation.refinedByAi).toBe(false);
    expect(down.body.results.products.length).toBeGreaterThan(0);

    // Withdrawing the consent stops the model calls.
    modelAnswer = '{}';
    await ctx.http.put('/v1/me/consents/ai_processing').set(bearer(u.token)).send({ granted: false }).expect(200);
    const before = calls.length;
    await natural(u, 'sandales').expect(200);
    expect(calls.length).toBe(before);
  });
});

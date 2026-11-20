import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

interface Call {
  body: any;
}

let ctx: TestContext;
const calls: Call[] = [];
/** What the fake model answers next (consumed once; default is a plain sentence). */
let nextReply: string | null = null;

const fakeFetch = async (_url: string, init: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init.body));
  calls.push({ body });
  const content = nextReply ?? 'Réponse simple';
  nextReply = null;
  return Response.json({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: {} });
};

interface TU {
  token: string;
  id: string;
}
async function user(consent = true): Promise<TU> {
  const s = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(s.tokens.accessToken)).expect(200);
  const u = { token: s.tokens.accessToken, id: me.body.id as string };
  if (consent) await ctx.http.put('/v1/me/consents/ai_processing').set(bearer(u.token)).send({ granted: true }).expect(200);
  return u;
}
async function conversation(u: TU): Promise<string> {
  return (await ctx.http.post('/v1/ai/conversations').set(bearer(u.token)).send({}).expect(201)).body.id;
}
const ask = (u: TU, id: string, content: string, reply?: string) => {
  if (reply !== undefined) nextReply = reply;
  return ctx.http.post(`/v1/ai/conversations/${id}/messages`).set(bearer(u.token)).send({ content });
};
const block = (actions: unknown) => `Voici.\n<actions>${JSON.stringify(actions)}</actions>`;
const confirm = (u: TU, id: string) => ctx.http.post(`/v1/ai/actions/${id}/confirm`).set(bearer(u.token));
const dismiss = (u: TU, id: string) => ctx.http.post(`/v1/ai/actions/${id}/dismiss`).set(bearer(u.token));
const logOf = async (u: TU) => (await ctx.sql.query(`SELECT tool, status FROM ai_action_log WHERE user_id = $1 ORDER BY created_at, id`, [u.id])).rows as { tool: string; status: string }[];

let n = 0;
async function seedProduct(title: string, priceMinor: number): Promise<string> {
  const owner = await user(false);
  const org = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `shop-${Date.now().toString(36)}-${++n}`, name: 'Boutique', kind: 'shop' }).expect(201)).body.id;
  const p = await ctx.http
    .post(`/v1/orgs/${org}/products`)
    .set(bearer(owner.token))
    .send({ title, status: 'published', variants: [{ sku: `SKU-${n}`, options: {}, priceMinor, currency: 'USD', stock: 10 }] })
    .expect(201);
  return p.body.variants[0].id;
}

beforeAll(async () => {
  ctx = await createTestContext({ GROQ_API_KEY: 'q-key', AI_RATE_LIMIT_PER_MINUTE: '1000', AI_DAILY_MESSAGES: '100' }, { aiFetch: fakeFetch });
  const admin = await user(false);
  await ctx.sql.query(`UPDATE users SET roles = ARRAY['user','admin'] WHERE id = $1`, [admin.id]);
  await ctx.http.patch('/v1/admin/ai/models/groq-llama').set(bearer(admin.token)).send({ enabled: true }).expect(200);
});
afterAll(async () => {
  await ctx.close();
});

describe('AI consent', () => {
  it('sends nothing to the provider without the ai_processing consent', async () => {
    const u = await user(false);
    const id = await conversation(u);
    const before = calls.length;
    const res = await ask(u, id, 'bonjour').expect(409);
    expect(res.body.error.code).toBe('consent_required');
    expect(res.body.error.details).toEqual({ kind: 'ai_processing' });
    // The translation consent is another purpose.
    await ctx.http.put('/v1/me/consents/translation').set(bearer(u.token)).send({ granted: true }).expect(200);
    await ask(u, id, 'bonjour').expect(409);
    expect(calls.length).toBe(before);
    await ctx.http.put('/v1/me/consents/ai_processing').set(bearer(u.token)).send({ granted: true }).expect(200);
    await ask(u, id, 'bonjour').expect(201);
    await ctx.http.put('/v1/me/consents/ai_processing').set(bearer(u.token)).send({ granted: false }).expect(200);
    await ask(u, id, 'encore').expect(409);
  });
});

describe('assistant actions', () => {
  it('keeps only whitelisted, valid proposals checked against what the user wrote, and strips the block', async () => {
    const u = await user();
    const id = await conversation(u);
    const text = 'Résume ceci : le marché ouvre à 7 h et ferme à 18 h.';
    const res = await ask(u, id, text, block([
      { tool: 'search_products', args: { q: 'sandales', maxPriceMinor: 2000, currency: 'USD' }, label: 'Chercher des sandales' },
      { tool: 'delete_account', args: {} },
      { tool: 'open_screen', args: { path: '/admin' } },
      { tool: 'search_products', args: { q: 'x', extra: 1 } },
      { tool: 'summarize_text', args: { text: 'un texte que personne n’a écrit' } },
      { tool: 'summarize_text', args: { text: 'le marché ouvre à 7 h et ferme à 18 h.' } },
      { tool: 'search_places', args: { lat: 10, lng: 10 } },
    ])).expect(201);
    expect(res.body.reply.content).toBe('Voici.');
    expect(res.body.actions.map((a: any) => a.tool)).toEqual(['search_products', 'summarize_text']);
    expect(res.body.actions[0]).toMatchObject({ label: 'Chercher des sandales', status: 'proposed' });
    expect(new Date(res.body.actions[0].expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    // The prompt told the model about the tools; the stored reply has no block.
    expect(calls.at(-1)!.body.messages[0].content).toContain('<actions>');
    const stored = (await ctx.http.get(`/v1/ai/conversations/${id}/messages`).set(bearer(u.token)).expect(200)).body.items;
    expect(JSON.stringify(stored)).not.toContain('delete_account');

    const log = await logOf(u);
    expect(log.filter((l) => l.status === 'proposed')).toHaveLength(2);
    expect(log.filter((l) => l.status === 'ignored').map((l) => l.tool).sort()).toEqual(['open_screen', 'search_places', 'search_products', 'summarize_text', 'unknown']);
    // The journal never holds arguments.
    expect(JSON.stringify(log)).not.toContain('sandales');

    const pending = (await ctx.http.get(`/v1/ai/conversations/${id}/actions`).set(bearer(u.token)).expect(200)).body.items;
    expect(pending).toHaveLength(2);
    expect(res.body.actions).toHaveLength(2); // never more than 3, and unusable JSON is ignored
    const junk = await ask(u, id, 'ok', '<actions>pas du json</actions>').expect(201);
    expect(junk.body.actions).toEqual([]);
  });

  it('confirms once with the caller rights (search, screen), idempotently', async () => {
    const u = await user();
    await seedProduct('Sandales cuir', 1500);
    const id = await conversation(u);
    const res = await ask(u, id, 'cherche des sandales', block([{ tool: 'search_products', args: { q: 'sandales' } }, { tool: 'open_screen', args: { path: '/cart' } }])).expect(201);
    const [search, screen] = res.body.actions;
    const done = await confirm(u, search.id).expect(200);
    expect(done.body.action.status).toBe('confirmed');
    expect(done.body.result.kind).toBe('products');
    expect(done.body.result.items.map((i: any) => i.title)).toContain('Sandales cuir');
    const again = await confirm(u, search.id).expect(200);
    expect(again.body.result).toEqual(done.body.result);
    expect((await logOf(u)).filter((l) => l.status === 'confirmed' && l.tool === 'search_products')).toHaveLength(1);
    expect((await confirm(u, screen.id).expect(200)).body.result).toEqual({ kind: 'open_screen', path: '/cart' });

    // Not mine: 404 for confirm, dismiss and the list; malformed id too.
    const other = await user();
    await confirm(other, search.id).expect(404);
    await dismiss(other, search.id).expect(404);
    await ctx.http.get(`/v1/ai/conversations/${id}/actions`).set(bearer(other.token)).expect(404);
    await confirm(u, 'nope').expect(404);
    await confirm(u, randomUUID()).expect(404);
    await ctx.http.post(`/v1/ai/actions/${search.id}/confirm`).expect(401);
  });

  it('prepares a cart from real variants and adds nothing before the confirmation', async () => {
    const u = await user();
    const variantId = await seedProduct('Pagne wax rouge', 2500);
    const id = await conversation(u);
    const res = await ask(u, id, 'je veux un pagne', block([{ tool: 'prepare_cart', args: { items: [{ q: 'pagne wax', quantity: 2 }, { q: 'introuvable-xyz', quantity: 1 }] } }])).expect(201);
    const action = res.body.actions[0];
    expect(action.args.lines).toEqual([{ variantId, quantity: 2, title: 'Pagne wax rouge', priceMinor: 2500, currency: 'USD' }]);
    expect(action.label).toContain('Pagne wax rouge');
    const empty = (await ctx.http.get('/v1/cart').set(bearer(u.token)).expect(200)).body;
    expect(empty.itemCount).toBe(0);

    await confirm(u, action.id).expect(200);
    await confirm(u, action.id).expect(200); // idempotent: no second addition
    const cart = (await ctx.http.get('/v1/cart').set(bearer(u.token)).expect(200)).body;
    expect(cart.itemCount).toBe(2);

    // A wish that matches nothing yields no proposal at all.
    const none = await ask(u, id, 'autre', block([{ tool: 'prepare_cart', args: { items: [{ q: 'introuvable-xyz', quantity: 1 }] } }])).expect(201);
    expect(none.body.actions).toEqual([]);
  });

  it('summarises only the text the user wrote, with the consent checked again at confirmation', async () => {
    const u = await user();
    const id = await conversation(u);
    const text = 'Le conseil de classe se réunit mardi à 9 h pour valider les bulletins.';
    const res = await ask(u, id, `Résume : ${text}`, block([{ tool: 'summarize_text', args: { text } }])).expect(201);
    nextReply = 'Réunion mardi à 9 h.';
    const done = await confirm(u, res.body.actions[0].id).expect(200);
    expect(done.body.result).toEqual({ kind: 'summary', text: 'Réunion mardi à 9 h.' });
    expect(calls.at(-1)!.body.messages.at(-1)).toEqual({ role: 'user', content: text });

    const again = await ask(u, id, `Résume : ${text}`, block([{ tool: 'summarize_text', args: { text } }])).expect(201);
    await ctx.http.put('/v1/me/consents/ai_processing').set(bearer(u.token)).send({ granted: false }).expect(200);
    const before = calls.length;
    expect((await confirm(u, again.body.actions[0].id).expect(409)).body.error.code).toBe('consent_required');
    expect(calls.length).toBe(before);
    expect((await logOf(u)).at(-1)).toMatchObject({ tool: 'summarize_text', status: 'failed' });
  });

  it('expires after ten minutes and can be dismissed', async () => {
    const u = await user();
    const id = await conversation(u);
    const res = await ask(u, id, 'ouvre mon panier', block([{ tool: 'open_screen', args: { path: '/cart' } }, { tool: 'open_screen', args: { path: '/orders' } }, { tool: 'open_screen', args: { path: '/wallet' } }])).expect(201);
    const [a, b, c] = res.body.actions;
    await ctx.sql.query(`UPDATE ai_actions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [a.id]);
    const late = await confirm(u, a.id).expect(409);
    expect(late.body.error.details.reason).toBe('action_expired');
    expect((await ctx.sql.query(`SELECT status FROM ai_actions WHERE id = $1`, [a.id])).rows[0].status).toBe('expired');
    expect((await logOf(u)).some((l) => l.status === 'expired')).toBe(true);
    const pending = (await ctx.http.get(`/v1/ai/conversations/${id}/actions`).set(bearer(u.token)).expect(200)).body.items;
    expect(pending.map((p: any) => p.id).sort()).toEqual([b.id, c.id].sort());

    expect((await dismiss(u, b.id).expect(200)).body.status).toBe('dismissed');
    await dismiss(u, b.id).expect(200); // idempotent
    expect((await confirm(u, b.id).expect(409)).body.error.details.reason).toBe('action_not_pending');
    expect((await dismiss(u, a.id).expect(409)).body.error.details.reason).toBe('action_not_pending');
    expect((await ctx.http.get(`/v1/ai/conversations/${id}/actions`).set(bearer(u.token)).expect(200)).body.items).toHaveLength(1);
  });

  it('only searches places around coordinates the user typed', async () => {
    const u = await user();
    const id = await conversation(u);
    const res = await ask(u, id, 'Je suis à -1.6585, 29.2205, une pharmacie ?', block([
      { tool: 'search_places', args: { lat: -1.6585, lng: 29.2205, kind: 'pharmacy' } },
      { tool: 'search_places', args: { lat: 48.85, lng: 2.35 } },
    ])).expect(201);
    expect(res.body.actions).toHaveLength(1);
    const done = await confirm(u, res.body.actions[0].id).expect(200);
    expect(done.body.result).toEqual({ kind: 'places', items: [] });
  });

  it('removes the proposals with the conversation and exports the journal without arguments', async () => {
    const u = await user();
    const id = await conversation(u);
    await ask(u, id, 'ouvre mon panier', block([{ tool: 'open_screen', args: { path: '/cart' } }])).expect(201);
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(u.token)).expect(200)).body;
    expect(exp.aiActionLog).toEqual([{ tool: 'open_screen', status: 'proposed', createdAt: expect.any(String) }]);
    await ctx.http.delete(`/v1/ai/conversations/${id}`).set(bearer(u.token)).expect(204);
    expect((await ctx.sql.query(`SELECT 1 FROM ai_actions WHERE user_id = $1`, [u.id])).rows).toHaveLength(0);
    expect((await ctx.sql.query(`SELECT 1 FROM ai_action_log WHERE user_id = $1`, [u.id])).rows).toHaveLength(1);
  });
});

describe('emergency stop', () => {
  it('AI_ACTIONS_ENABLED=false: no tools in the prompt, no proposals kept, nothing confirmable', async () => {
    const off = await createTestContext({ GROQ_API_KEY: 'q-key', AI_ACTIONS_ENABLED: 'false', AI_RATE_LIMIT_PER_MINUTE: '1000' }, { aiFetch: fakeFetch });
    try {
      const s = await signUp(off);
      const t = { Authorization: `Bearer ${s.tokens.accessToken}` };
      const me = (await off.http.get('/v1/me').set(t).expect(200)).body;
      await off.sql.query(`UPDATE users SET roles = ARRAY['user','admin'] WHERE id = $1`, [me.id]);
      await off.http.patch('/v1/admin/ai/models/groq-llama').set(t).send({ enabled: true }).expect(200);
      await off.http.put('/v1/me/consents/ai_processing').set(t).send({ granted: true }).expect(200);
      const id = (await off.http.post('/v1/ai/conversations').set(t).send({}).expect(201)).body.id;
      nextReply = block([{ tool: 'open_screen', args: { path: '/cart' } }]);
      const res = await off.http.post(`/v1/ai/conversations/${id}/messages`).set(t).send({ content: 'ouvre le panier' }).expect(201);
      expect(res.body.actions).toEqual([]);
      expect(res.body.reply.content).not.toContain('<actions>');
      expect(calls.at(-1)!.body.messages[0].content).not.toContain('<actions>');
      expect((await off.sql.query(`SELECT 1 FROM ai_actions`)).rows).toHaveLength(0);
      const refused = await off.http.post(`/v1/ai/actions/${randomUUID()}/confirm`).set(t).expect(503);
      expect(refused.body.error.details).toEqual({ reason: 'ai_actions_disabled' });
    } finally {
      await off.close();
    }
  });
});

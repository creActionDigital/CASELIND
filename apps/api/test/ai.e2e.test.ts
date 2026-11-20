import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scrubLogUrl } from '../src/common/log-scrub.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { GeminiProvider } from '../src/ai/gemini.provider.js';
import { LlmProviderError } from '../src/ai/llm-provider.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: any;
}

let ctx: TestContext;
const calls: Call[] = [];
/** Per host behaviour; default is a normal answer. */
const failing = new Set<string>();
let echoPromptInError = false;

const SENTINEL = 'sentinelzx9 secret question';

const fakeFetch = async (url: string, init: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init.body));
  calls.push({ url, headers: init.headers as Record<string, string>, body });
  const host = new URL(url).host;
  if (failing.has(host)) {
    return new Response(echoPromptInError ? JSON.stringify({ error: { message: `bad prompt: ${JSON.stringify(body)}` } }) : 'boom', { status: 500 });
  }
  if (host.includes('googleapis')) {
    return Response.json({
      candidates: [{ content: { parts: [{ text: 'Réponse Gemini' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
    });
  }
  return Response.json({
    choices: [{ message: { role: 'assistant', content: `Réponse ${host}` }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
};

beforeAll(async () => {
  ctx = await createTestContext(
    { GEMINI_API_KEY: 'g-key', GROQ_API_KEY: 'q-key', AI_DAILY_MESSAGES: '5', AI_RATE_LIMIT_PER_MINUTE: '1000' },
    { aiFetch: fakeFetch },
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
async function user(roles?: string[]): Promise<TU> {
  const s = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(s.tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query(`UPDATE users SET roles = $1::text[] WHERE id = $2`, [roles, me.body.id]);
  // Nothing goes to a provider without the ai_processing consent.
  await ctx.http.put('/v1/me/consents/ai_processing').set(bearer(s.tokens.accessToken)).send({ granted: true }).expect(200);
  return { token: s.tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

const patchSettings = (u: TU, body: object) => ctx.http.patch('/v1/me/ai-settings').set(bearer(u.token)).send(body);
async function conversation(u: TU): Promise<string> {
  return (await ctx.http.post('/v1/ai/conversations').set(bearer(u.token)).send({}).expect(201)).body.id;
}
const ask = (u: TU, id: string, content: string) =>
  ctx.http.post(`/v1/ai/conversations/${id}/messages`).set(bearer(u.token)).send({ content });

let admin: TU;

describe('AI assistant (lot 12)', () => {
  it('has no available model until an admin enables one with a configured key', async () => {
    admin = await user(['user', 'admin']);
    const u = await user();
    expect((await ctx.http.get('/v1/ai/models').set(bearer(u.token)).expect(200)).body).toEqual({ items: [], defaultModelId: null });
    const id = await conversation(u);
    const res = await ask(u, id, 'bonjour').expect(503);
    expect(res.body.error.code).toBe('ai_unavailable');
    expect(calls).toHaveLength(0);

    await ctx.http.get('/v1/admin/ai/models').set(bearer(u.token)).expect(403);
    const list = (await ctx.http.get('/v1/admin/ai/models').set(bearer(admin.token)).expect(200)).body.items;
    expect(list.find((m: any) => m.id === 'mistral-small')).toMatchObject({ providerConfigured: false, enabled: false, available: false });
    expect(list.find((m: any) => m.id === 'gemini-flash')).toMatchObject({ providerConfigured: true, enabled: false, available: false });
    expect(JSON.stringify(list)).not.toContain('g-key');

    await ctx.http.patch('/v1/admin/ai/models/gemini-flash').set(bearer(u.token)).send({ enabled: true }).expect(403);
    await ctx.http.patch('/v1/admin/ai/models/nope').set(bearer(admin.token)).send({ enabled: true }).expect(404);
    for (const m of ['gemini-flash', 'groq-llama', 'mistral-small']) {
      await ctx.http.patch(`/v1/admin/ai/models/${m}`).set(bearer(admin.token)).send({ enabled: true }).expect(200);
    }
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'ai.model_toggled' AND actor_user_id = $1`, [admin.id]);
    expect(audit.rows).toHaveLength(3);

    // mistral is enabled but has no key: still unavailable.
    const models = (await ctx.http.get('/v1/ai/models').set(bearer(u.token)).expect(200)).body;
    expect(models.items.map((m: any) => m.id)).toEqual(['gemini-flash', 'groq-llama']);
    expect(models.defaultModelId).toBe('gemini-flash');
    expect(models.items[0]).toMatchObject({ free: true, trainsOnData: true });
    expect(models.items[1]).toMatchObject({ trainsOnData: false });
    expect(models.items[0]).not.toHaveProperty('model');
    await patchSettings(u, { modelId: 'mistral-small' }).expect(409);
    await patchSettings(u, { modelId: 'nope' }).expect(404);
  });

  it('requires the data notice for a model that trains on data, then speaks Gemini format', async () => {
    const u = await user();
    expect((await ctx.http.get('/v1/me/ai-settings').set(bearer(u.token)).expect(200)).body).toEqual({ modelId: null, allowFallback: false, acknowledgedDataNotice: false });
    const err = await patchSettings(u, { modelId: 'gemini-flash' }).expect(409);
    expect(err.body.error.code).toBe('data_notice_required');
    // The default model is Gemini: sending without acknowledgement is refused too.
    const id = await conversation(u);
    expect((await ask(u, id, 'salut').expect(409)).body.error.code).toBe('data_notice_required');
    expect(calls).toHaveLength(0);

    await patchSettings(u, { modelId: 'gemini-flash', acknowledgedDataNotice: true }).expect(200);
    const res = await ask(u, id, 'Comment payer ?').expect(201);
    expect(res.body).toMatchObject({ modelId: 'gemini-flash', fallbackUsed: false, aiGenerated: true });
    expect(res.body.reply).toMatchObject({ role: 'assistant', content: 'Réponse Gemini', modelId: 'gemini-flash' });
    const c = calls.at(-1)!;
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(c.headers['x-goog-api-key']).toBe('g-key');
    expect(c.body.systemInstruction.parts[0].text).toContain('CASELIND');
    expect(c.body.contents).toEqual([{ role: 'user', parts: [{ text: 'Comment payer ?' }] }]);
    expect(c.body.generationConfig).toMatchObject({ maxOutputTokens: 1024 });

    await ask(u, id, 'Et ensuite ?').expect(201);
    expect(calls.at(-1)!.body.contents.map((m: any) => m.role)).toEqual(['user', 'model', 'user']);
    const msgs = (await ctx.http.get(`/v1/ai/conversations/${id}/messages`).set(bearer(u.token)).expect(200)).body.items;
    expect(msgs.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const list = (await ctx.http.get('/v1/ai/conversations').set(bearer(u.token)).expect(200)).body.items;
    expect(list[0].title).toBe('Comment payer ?');
    await ask(u, id, 'x'.repeat(4001)).expect(400);
  });

  it('speaks the OpenAI-compatible format for Groq', async () => {
    const u = await user();
    await patchSettings(u, { modelId: 'groq-llama' }).expect(200);
    const id = await conversation(u);
    const res = await ask(u, id, 'Bonjour').expect(201);
    expect(res.body.modelId).toBe('groq-llama');
    const c = calls.at(-1)!;
    expect(c.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(c.headers.authorization).toBe('Bearer q-key');
    expect(c.body).toMatchObject({ model: 'llama-3.3-70b-versatile', max_tokens: 1024 });
    expect(c.body.messages[0]).toMatchObject({ role: 'system' });
    expect(c.body.messages[0].content).toContain('intelligence artificielle');
    expect(c.body.messages[1]).toEqual({ role: 'user', content: 'Bonjour' });
  });

  it('falls back to another model only when allowed, and never to a training model without the notice', async () => {
    const u = await user();
    await patchSettings(u, { modelId: 'groq-llama' }).expect(200);
    failing.add('api.groq.com');
    const id = await conversation(u);
    const before = calls.length;
    const res = await ask(u, id, 'Test').expect(502);
    expect(res.body.error.code).toBe('ai_provider_error');
    expect(res.body.error.details).toEqual({ reason: 'server' });
    expect(calls.length - before).toBe(1); // no fallback, no retry
    expect((await ctx.http.get(`/v1/ai/conversations/${id}/messages`).set(bearer(u.token))).body.items).toEqual([]);

    // Fallback allowed but Gemini trains on data and the notice is not accepted: still refused.
    await patchSettings(u, { allowFallback: true }).expect(200);
    await ask(u, id, 'Test').expect(502);

    await patchSettings(u, { acknowledgedDataNotice: true }).expect(200);
    const ok = await ask(u, id, 'Test').expect(201);
    expect(ok.body).toMatchObject({ modelId: 'gemini-flash', fallbackUsed: true });
    failing.delete('api.groq.com');
  });

  it('enforces the daily quota (429) without calling the provider, refunding failures', async () => {
    const u = await user();
    await patchSettings(u, { modelId: 'groq-llama' }).expect(200);
    const id = await conversation(u);
    failing.add('api.groq.com');
    await ask(u, id, 'a').expect(502);
    failing.delete('api.groq.com');
    for (let i = 0; i < 5; i++) await ask(u, id, `q${i}`).expect(201); // the failed one was refunded
    const before = calls.length;
    const res = await ask(u, id, 'one too many').expect(429);
    expect(res.body.error).toMatchObject({ code: 'rate_limited', details: { reason: 'ai_daily_quota', limit: 5 } });
    expect(calls.length).toBe(before);
  });

  it('keeps conversations private (404 for anyone else)', async () => {
    const a = await user();
    const b = await user();
    await patchSettings(a, { modelId: 'groq-llama' }).expect(200);
    const id = await conversation(a);
    await ask(a, id, 'privé').expect(201);
    await ctx.http.get(`/v1/ai/conversations/${id}/messages`).set(bearer(b.token)).expect(404);
    await ask(b, id, 'intrus').expect(404);
    await ctx.http.delete(`/v1/ai/conversations/${id}`).set(bearer(b.token)).expect(404);
    await ctx.http.get(`/v1/ai/conversations/not-a-uuid/messages`).set(bearer(a.token)).expect(404);
    expect((await ctx.http.get('/v1/ai/conversations').set(bearer(b.token)).expect(200)).body.items).toEqual([]);
    await ctx.http.delete(`/v1/ai/conversations/${id}`).set(bearer(a.token)).expect(204);
    await ctx.http.get(`/v1/ai/conversations/${id}/messages`).set(bearer(a.token)).expect(404);
  });

  it('never leaks prompts or replies into errors, audit rows or logged URLs', async () => {
    const u = await user();
    await patchSettings(u, { modelId: 'groq-llama' }).expect(200);
    const id = await conversation(u);
    failing.add('api.groq.com');
    echoPromptInError = true;
    const res = await ask(u, id, SENTINEL).expect(502);
    expect(JSON.stringify(res.body)).not.toContain('sentinelzx9');
    failing.delete('api.groq.com');
    echoPromptInError = false;
    await ask(u, id, SENTINEL).expect(201);

    const audit = await ctx.sql.query(`SELECT metadata::text AS m, action FROM audit_events`);
    expect(audit.rows.some((r) => r.m.includes('sentinelzx9'))).toBe(false);
    expect(scrubLogUrl('/v1/ai/conversations?q=sentinelzx9')).toBe('/v1/ai/conversations?[redacted]');
    expect(scrubLogUrl('/v1/me/ai-settings?x=1')).toBe('/v1/me/ai-settings?[redacted]');

    // Adapter errors carry a fixed kind only, even when the provider echoes the prompt.
    const provider = new GeminiProvider({
      apiKey: 'k',
      fetch: async () => new Response(`echo ${SENTINEL}`, { status: 400 }),
    });
    const err = await provider.chat({ model: 'm', messages: [{ role: 'user', content: SENTINEL }], maxTokens: 10, temperature: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(err.message).toBe('gemini: bad_request');
  });

  it('includes conversations in the export and deletes them on purge', async () => {
    const u = await user();
    await patchSettings(u, { modelId: 'groq-llama' }).expect(200);
    const id = await conversation(u);
    await ask(u, id, 'à exporter').expect(201);
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(u.token)).expect(200)).body;
    expect(exp.aiConversations).toHaveLength(1);
    expect(exp.aiConversations[0].messages.map((m: any) => m.content)).toEqual(['à exporter', 'Réponse api.groq.com']);
    expect(JSON.stringify(exp)).not.toContain('q-key');

    await ctx.http.post('/v1/me/deletion-request').set(bearer(u.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [u.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    for (const t of ['ai_conversations', 'ai_user_settings', 'ai_usage_daily']) {
      const n = (await ctx.sql.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [u.id])).rows[0].n;
      expect(n, t).toBe(0);
    }
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id = $1`, [id])).rows[0].n).toBe(0);
  });

  it('reserves seller help to members with catalog.manage, returns a flagged draft only', async () => {
    const owner = await user();
    const slug = `ai-${Date.now().toString(36)}`;
    const org = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: 'Boutique IA', kind: 'shop' }).expect(201)).body.id;
    const invite = async (u: TU, role: string) => {
      await ctx.http.post(`/v1/orgs/${org}/invitations`).set(bearer(owner.token)).send({ handle: u.handle, role }).expect(201);
      await ctx.http.post(`/v1/me/org-invitations/${org}/accept`).set(bearer(u.token)).expect(200);
    };
    const sales = await user();
    const stock = await user();
    const outsider = await user();
    await invite(sales, 'sales');
    await invite(stock, 'stock');
    const url = `/v1/orgs/${org}/ai/product-description`;
    const body = { title: 'Sac en cuir', facts: ['Fait main à Goma', 'Couleur marron'] };

    // The seller's own settings apply: Gemini by default needs the notice.
    expect((await ctx.http.post(url).set(bearer(owner.token)).send(body).expect(409)).body.error.code).toBe('data_notice_required');
    await patchSettings(owner, { modelId: 'groq-llama' }).expect(200);
    const res = await ctx.http.post(url).set(bearer(owner.token)).send(body).expect(200);
    expect(res.body).toMatchObject({ aiGenerated: true, modelId: 'groq-llama', description: 'Réponse api.groq.com' });
    const sent = JSON.stringify(calls.at(-1)!.body);
    expect(sent).toContain('Sac en cuir');
    expect(sent).toContain('Fait main à Goma');
    expect(sent).not.toContain(owner.handle);

    await patchSettings(sales, { modelId: 'groq-llama' }).expect(200);
    await ctx.http.post(url).set(bearer(sales.token)).send(body).expect(200);
    await ctx.http.post(url).set(bearer(stock.token)).send(body).expect(403);
    await ctx.http.post(url).set(bearer(outsider.token)).send(body).expect(404);
    await ctx.http.post(url).set(bearer(owner.token)).send({ title: 'x', facts: [] }).expect(400);
  });

  it('is off when the ai flag is off', async () => {
    const u = await user();
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'ai'`);
    try {
      expect((await ctx.http.get('/v1/ai/models').set(bearer(u.token)).expect(403)).body.error.code).toBe('feature_disabled');
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'ai'`);
    }
  });
});

describe('AI input and rights guards', () => {
  it('rejects anonymous callers, empty or invalid input, and keeps model administration to admins', async () => {
    const u = await user();
    await ctx.http.get('/v1/ai/models').expect(401);
    await ctx.http.post('/v1/ai/conversations').send({}).expect(401);
    await patchSettings(u, {}).expect(400);
    await patchSettings(u, { allowFallback: 'yes' }).expect(400);
    await patchSettings(u, { modelId: '' }).expect(400);
    const id = await conversation(u);
    await ask(u, id, '').expect(400);
    await ask(u, id, '   ').expect(400);
    await ctx.http.post('/v1/ai/conversations').set(bearer(u.token)).send({ title: 'x'.repeat(81) }).expect(400);
    // Model administration: 403 for a plain user, whatever the model id.
    await ctx.http.get('/v1/admin/ai/models').set(bearer(u.token)).expect(403);
    await ctx.http.patch('/v1/admin/ai/models/groq-llama').set(bearer(u.token)).send({ enabled: true }).expect(403);
    // Nothing was stored by the refused calls.
    expect((await ctx.http.get(`/v1/ai/conversations/${id}/messages`).set(bearer(u.token)).expect(200)).body.items).toEqual([]);
  });
});

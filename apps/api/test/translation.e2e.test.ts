import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

interface Call {
  url: string;
  body: any;
}

let ctx: TestContext;
const calls: Call[] = [];

/** OpenAI-compatible fake: "[en] <text>" so the test sees what was sent. */
const fakeFetch = async (url: string, init: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init.body));
  calls.push({ url, body });
  const user = body.messages.at(-1).content as string;
  return Response.json({ choices: [{ message: { role: 'assistant', content: `[tr] ${user}` }, finish_reason: 'stop' }], usage: {} });
};

interface TU {
  token: string;
  id: string;
}
async function user(roles?: string[]): Promise<TU> {
  const s = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(s.tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query(`UPDATE users SET roles = $1::text[] WHERE id = $2`, [roles, me.body.id]);
  return { token: s.tokens.accessToken, id: me.body.id };
}
const consent = (u: TU, kind: string, granted: boolean) => ctx.http.put(`/v1/me/consents/${kind}`).set(bearer(u.token)).send({ granted }).expect(200);
const translate = (u: TU, messageId: string, body: object = { target: 'en', informed: true }) =>
  ctx.http.post(`/v1/messages/${messageId}/translate`).set(bearer(u.token)).send(body);
async function group(owner: TU, members: TU[]): Promise<string> {
  return (await ctx.http.post('/v1/conversations').set(bearer(owner.token)).send({ kind: 'group', title: 'Equipe', memberIds: members.map((m) => m.id) }).expect(201)).body.id;
}
async function say(u: TU, conv: string, body: string): Promise<string> {
  return (await ctx.http.post(`/v1/conversations/${conv}/messages`).set(bearer(u.token)).send({ clientId: randomUUID(), kind: 'text', body }).expect(201)).body.id;
}

beforeAll(async () => {
  ctx = await createTestContext({ GROQ_API_KEY: 'q-key', AI_RATE_LIMIT_PER_MINUTE: '1000', AI_DAILY_MESSAGES: '100' }, { aiFetch: fakeFetch });
  const admin = await user(['user', 'admin']);
  await ctx.http.patch('/v1/admin/ai/models/groq-llama').set(bearer(admin.token)).send({ enabled: true }).expect(200);
});
afterAll(async () => {
  await ctx.close();
});

describe('message translation', () => {
  it('needs the translation consent and the on-screen notice, then sends only the message text', async () => {
    const [a, b, outsider] = [await user(), await user(), await user()];
    const conv = await group(a, [b]);
    const text = 'Bonjour, rendez-vous à 15 h devant la gare.';
    const msg = await say(a, conv, text);

    const refused = await translate(b, msg).expect(409);
    expect(refused.body.error.code).toBe('consent_required');
    expect(refused.body.error.details).toEqual({ kind: 'translation' });
    // The ai_processing consent is another purpose: it does not unlock the translation.
    await consent(b, 'ai_processing', true);
    await translate(b, msg).expect(409);
    expect(calls).toHaveLength(0);

    await consent(b, 'translation', true);
    await translate(b, msg, { target: 'en' }).expect(400); // the notice must have been shown
    await translate(b, msg, { target: 'de', informed: true }).expect(400);
    expect(calls).toHaveLength(0);

    const ok = await translate(b, msg).expect(200);
    expect(ok.body).toEqual({ text: `[tr] ${text}`, targetLocale: 'en', machineTranslated: true, provider: 'groq-llama', cached: false });
    expect(calls).toHaveLength(1);
    // Only the text (and the fixed instruction): no name, id or context.
    expect(calls[0]!.body.messages).toHaveLength(2);
    expect(calls[0]!.body.messages[1]).toEqual({ role: 'user', content: text });
    const sent = JSON.stringify(calls[0]!.body);
    for (const secret of [a.id, b.id, conv, msg, 'Equipe', 'Test User']) expect(sent).not.toContain(secret);

    // Cached per (message, language): no new provider call, also for the author.
    await consent(a, 'translation', true);
    const again = await translate(a, msg).expect(200);
    expect(again.body).toMatchObject({ text: `[tr] ${text}`, cached: true, machineTranslated: true });
    expect(calls).toHaveLength(1);
    await translate(b, msg, { target: 'sw', informed: true }).expect(200);
    expect(calls).toHaveLength(2);

    // Rights: a non-member and a malformed id both get 404, before any consent matter.
    await consent(outsider, 'translation', true);
    await translate(outsider, msg).expect(404);
    await translate(b, 'not-a-uuid').expect(404);
    await translate(b, randomUUID()).expect(404);
    await ctx.http.post(`/v1/messages/${msg}/translate`).send({ target: 'en', informed: true }).expect(401);

    // Audit: ids, language and provider; never a text.
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'message.translated' AND actor_user_id = $1`, [b.id]);
    expect(audit.rows).toHaveLength(2);
    expect(JSON.stringify(audit.rows)).not.toContain('gare');

    // Withdrawing the consent closes the door at once, even for a cached translation.
    await consent(b, 'translation', false);
    expect((await translate(b, msg).expect(409)).body.error.code).toBe('consent_required');
  });

  it('refuses system, recalled, hidden, empty and too long messages, and drops the cache on recall', async () => {
    const [a, b] = [await user(), await user()];
    await consent(a, 'translation', true);
    await consent(b, 'translation', true);
    const conv = await group(a, [b]);
    const list = (await ctx.http.get(`/v1/conversations/${conv}/messages`).set(bearer(b.token)).expect(200)).body.items as { id: string; kind: string }[];
    const system = list.find((m) => m.kind === 'system')!;
    expect((await translate(b, system.id).expect(400)).body.error.code).toBe('validation_failed');

    const long = await say(a, conv, 'x'.repeat(2001));
    const tooLong = await translate(b, long).expect(409);
    expect(tooLong.body.error.details.reason).toBe('message_too_long');

    const recallable = await say(a, conv, 'à rappeler');
    await translate(b, recallable).expect(200);
    expect((await ctx.sql.query(`SELECT 1 FROM message_translations WHERE message_id = $1`, [recallable])).rows).toHaveLength(1);
    await ctx.http.delete(`/v1/messages/${recallable}?scope=all`).set(bearer(a.token)).expect(204);
    expect((await ctx.sql.query(`SELECT 1 FROM message_translations WHERE message_id = $1`, [recallable])).rows).toHaveLength(0);
    const recalled = await translate(b, recallable).expect(409);
    expect(recalled.body.error.details.reason).toBe('recalled');

    const hidden = await say(a, conv, 'masqué pour moi');
    await ctx.http.delete(`/v1/messages/${hidden}?scope=me`).set(bearer(b.token)).expect(204);
    await translate(b, hidden).expect(404);
    await translate(a, hidden).expect(200);
  });

  it('answers 503 without an available model and 502 when the provider fails, storing nothing', async () => {
    const [a, b] = [await user(), await user()];
    await consent(b, 'translation', true);
    const conv = await group(a, [b]);
    const msg = await say(a, conv, 'ça va ?');
    const admin = await user(['user', 'admin']);
    await ctx.http.patch('/v1/admin/ai/models/groq-llama').set(bearer(admin.token)).send({ enabled: false }).expect(200);
    try {
      expect((await translate(b, msg).expect(503)).body.error.code).toBe('ai_unavailable');
    } finally {
      await ctx.http.patch('/v1/admin/ai/models/groq-llama').set(bearer(admin.token)).send({ enabled: true }).expect(200);
    }
    expect((await ctx.sql.query(`SELECT 1 FROM message_translations WHERE message_id = $1`, [msg])).rows).toHaveLength(0);
  });
});

describe('message translation rate limit', () => {
  it('has its own budget', async () => {
    const limited = await createTestContext({ GROQ_API_KEY: 'q-key', AI_TRANSLATE_RATE_LIMIT_PER_MINUTE: '2' }, { aiFetch: fakeFetch });
    try {
      const s = await signUp(limited);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        statuses.push((await limited.http.post(`/v1/messages/${randomUUID()}/translate`).set(bearer(s.tokens.accessToken)).send({ target: 'en', informed: true })).status);
      }
      expect(statuses).toEqual([404, 404, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});

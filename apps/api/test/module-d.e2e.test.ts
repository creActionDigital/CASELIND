import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';
import { manifestFor } from './miniapps-kit.js';

/** Module D : messages epingles, demandes d'aide (support), categories et favoris des mini-apps. */
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

interface TU { token: string; id: string }
async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id };
}
const say = async (u: TU, conv: string, body = 'Bonjour') =>
  (await ctx.http.post(`/v1/conversations/${conv}/messages`).set(bearer(u.token)).send({ clientId: randomUUID(), kind: 'text', body }).expect(201)).body.id as string;

describe('messages epingles', () => {
  it('epingler, lister, desepingler ; reserve aux membres ; plafond de 10', async () => {
    const a = await user();
    const b = await user();
    const outsider = await user();
    const conv = (await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id })).body.id as string;
    const m1 = await say(a, conv, 'Adresse : 12 rue du Lac');
    await ctx.http.put(`/v1/messages/${m1}/pin`).set(bearer(outsider.token)).expect(404);
    await ctx.http.get(`/v1/conversations/${conv}/pins`).set(bearer(outsider.token)).expect(404);
    await ctx.http.put(`/v1/messages/${m1}/pin`).set(bearer(b.token)).expect(204);
    await ctx.http.put(`/v1/messages/${m1}/pin`).set(bearer(b.token)).expect(204); // idempotent
    const list = await ctx.http.get(`/v1/conversations/${conv}/pins`).set(bearer(a.token)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].message.body).toBe('Adresse : 12 rue du Lac');
    await ctx.http.delete(`/v1/messages/${m1}/pin`).set(bearer(outsider.token)).expect(404);
    await ctx.http.delete(`/v1/messages/${m1}/pin`).set(bearer(a.token)).expect(204);
    expect((await ctx.http.get(`/v1/conversations/${conv}/pins`).set(bearer(a.token))).body.items).toHaveLength(0);
    for (let i = 0; i < 10; i++) await ctx.http.put(`/v1/messages/${await say(a, conv, `m${i}`)}/pin`).set(bearer(a.token)).expect(204);
    const extra = await say(a, conv, 'onzieme');
    const over = await ctx.http.put(`/v1/messages/${extra}/pin`).set(bearer(a.token)).expect(409);
    expect(over.body.error.details).toMatchObject({ reason: 'pin_limit' });
  });
});

describe('demandes d\'aide', () => {
  it('creation validee, liste personnelle, traitement reserve aux administrateurs', async () => {
    const u = await user();
    const other = await user();
    const admin = await user(['user', 'admin']);
    const body = { category: 'payment', subject: 'Paiement bloque', body: 'Mon paiement reste en attente.' };
    await ctx.http.post('/v1/me/help-requests').set(bearer(u.token)).send({ ...body, subject: 'x' }).expect(400);
    await ctx.http.post('/v1/me/help-requests').set(bearer(u.token)).send({ ...body, category: 'nope' }).expect(400);
    const t = (await ctx.http.post('/v1/me/help-requests').set(bearer(u.token)).send(body).expect(201)).body;
    expect(t).toMatchObject({ status: 'open', reply: null });
    expect((await ctx.http.get('/v1/me/help-requests').set(bearer(u.token)).expect(200)).body.items).toHaveLength(1);
    expect((await ctx.http.get('/v1/me/help-requests').set(bearer(other.token)).expect(200)).body.items).toHaveLength(0);
    await ctx.http.get('/v1/admin/help-requests').set(bearer(u.token)).expect(403);
    await ctx.http.post(`/v1/admin/help-requests/${t.id}/resolve`).set(bearer(u.token)).send({ reply: 'Fait' }).expect(403);
    const queue = (await ctx.http.get('/v1/admin/help-requests').set(bearer(admin.token)).expect(200)).body.items as { id: string; userId: string }[];
    expect(queue.find((q) => q.id === t.id)?.userId).toBe(u.id);
    await ctx.http.post(`/v1/admin/help-requests/${t.id}/resolve`).set(bearer(admin.token)).send({ reply: '' }).expect(400);
    const done = await ctx.http.post(`/v1/admin/help-requests/${t.id}/resolve`).set(bearer(admin.token)).send({ reply: 'Reglé, merci.' }).expect(200);
    expect(done.body).toMatchObject({ status: 'resolved', reply: 'Reglé, merci.' });
    await ctx.http.post(`/v1/admin/help-requests/${t.id}/resolve`).set(bearer(admin.token)).send({ reply: 'Encore' }).expect(404);
    expect((await ctx.http.get('/v1/me/help-requests').set(bearer(u.token))).body.items[0].reply).toBe('Reglé, merci.');
  });
});

describe('mini-apps : categories et favoris', () => {
  it('filtre par categorie, favoris personnels, categorie inconnue refusee', async () => {
    const owner = await user();
    const admin = await user(['user', 'admin']);
    const fan = await user();
    const org = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `cat-${Date.now().toString(36)}`, name: 'Resto Cat', kind: 'shop' }).expect(201)).body.id as string;
    const scopes = ['profile.basic'];
    const mk = (extra: Record<string, unknown>) =>
      ctx.http.post(`/v1/orgs/${org}/miniapps`).set(bearer(owner.token)).send({ name: 'Table Pro', launchUrl: 'https://app.example.test/', redirectUris: ['https://app.example.test/cb'], scopes, manifest: manifestFor(scopes), ...extra });
    await mk({ category: 'jardin' }).expect(400);
    const app = (await mk({ category: 'restaurants' }).expect(201)).body;
    expect(app.category).toBe('restaurants');
    await ctx.http.post(`/v1/orgs/${org}/miniapps/${app.id}/submit`).set(bearer(owner.token)).expect(200);
    await ctx.http.post(`/v1/admin/miniapps/${app.id}/review`).set(bearer(admin.token)).send({ decision: 'approve' }).expect(200);
    const ids = async (qs: string) => ((await ctx.http.get(`/v1/miniapps${qs}`).set(bearer(fan.token)).expect(200)).body.items as { id: string }[]).map((x) => x.id);
    expect(await ids('?category=restaurants')).toContain(app.id);
    expect(await ids('?category=hotels')).not.toContain(app.id);
    await ctx.http.put(`/v1/me/miniapp-favorites/${app.id}`).set(bearer(fan.token)).expect(204);
    await ctx.http.put(`/v1/me/miniapp-favorites/${randomUUID()}`).set(bearer(fan.token)).expect(404);
    expect((await ctx.http.get('/v1/me/miniapp-favorites').set(bearer(fan.token)).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([app.id]);
    expect((await ctx.http.get('/v1/me/miniapp-favorites').set(bearer(owner.token)).expect(200)).body.items).toHaveLength(0);
    await ctx.http.delete(`/v1/me/miniapp-favorites/${app.id}`).set(bearer(fan.token)).expect(204);
    expect((await ctx.http.get('/v1/me/miniapp-favorites').set(bearer(fan.token))).body.items).toHaveLength(0);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENV, type Env } from '../src/config/env.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Paramètres par pays et ville : liste blanche, validation par clé, double validation, lecture publique (CDC §26). */
let ctx: TestContext;
let env: Env;
beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.app.get<Env>(ENV);
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  env.ADMIN_DUAL_APPROVAL = undefined;
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
const admin = () => user(['user', 'admin']);
const put = (a: TU, body: Record<string, unknown>) => ctx.http.put('/v1/admin/settings').set(bearer(a.token)).send({ reason: 'réglage de test', ...body });
const stored = async (key: string, scope = 'global') => (await ctx.sql.query('SELECT value FROM platform_settings WHERE key = $1 AND scope = $2', [key, scope])).rows[0]?.value;

describe('liste blanche et validation', () => {
  it('réservé aux administrateurs ; une clé inconnue, une valeur ou une portée invalide sont refusées', async () => {
    const a = await admin();
    const u = await user();
    await put(u, { key: 'support.contact', value: { email: 'aide@caselind.test' } }).expect(403);
    await ctx.http.get('/v1/admin/settings').set(bearer(u.token)).expect(403);

    await put(a, { key: 'payments.secret', value: 1 }).expect(400);
    await put(a, { key: 'commission.defaultBps', value: 3001 }).expect(400);
    await put(a, { key: 'commission.defaultBps', value: -1 }).expect(400);
    await put(a, { key: 'commission.defaultBps', value: 1.5 }).expect(400);
    await put(a, { key: 'support.contact', value: { hours: '8h-17h' } }).expect(400);
    await put(a, { key: 'support.contact', value: { email: 'pas-un-email' } }).expect(400);
    await put(a, { key: 'support.contact', value: { email: 'a@b.test', extra: 1 } }).expect(400);
    await put(a, { key: 'currencies.enabled', value: ['EUR'] }).expect(400);
    await put(a, { key: 'currencies.enabled', value: [] }).expect(400);
    await put(a, { key: 'cities.pilot', scope: 'city:CD:Goma', value: ['Goma'] }).expect(400); // portée non admise pour cette clé
    await put(a, { key: 'support.contact', scope: 'pays:CD', value: { email: 'a@b.test' } }).expect(400);
    await put(a, { key: 'limits.maxOrderMinor', value: { USD: 0 } }).expect(400);
    await put(a, { key: 'limits.maxOrderMinor', value: 5_000_000 }).expect(400); // un nombre seul : devise inconnue
    await put(a, { key: 'limits.maxOrderMinor', value: {} }).expect(400);
    await put(a, { key: 'support.contact', value: { email: 'a@b.test' }, reason: 'x' }).expect(400);
    expect(await stored('commission.defaultBps')).toBeUndefined();
  });

  it('écrit, remplace, liste, et audite avec la clé et la portée', async () => {
    const a = await admin();
    await put(a, { key: 'support.contact', value: { email: 'aide@caselind.test', phone: '+243810000000' } }).expect(200);
    await put(a, { key: 'support.contact', scope: 'country:CD', value: { whatsapp: '+243820000000' } }).expect(200);
    await put(a, { key: 'support.contact', scope: 'city:CD:Goma', value: { phone: '+243830000000', hours: '8h-17h' } }).expect(200);
    await put(a, { key: 'cities.pilot', value: ['Kinshasa', 'Goma'] }).expect(200);
    await put(a, { key: 'currencies.enabled', value: ['USD', 'CDF'] }).expect(200);
    await put(a, { key: 'support.contact', value: { email: 'nouveau@caselind.test' } }).expect(200);
    expect(await stored('support.contact')).toEqual({ email: 'nouveau@caselind.test' });

    const all = (await ctx.http.get('/v1/admin/settings').set(bearer(a.token)).expect(200)).body.items;
    expect(all.length).toBeGreaterThanOrEqual(5);
    const one = (await ctx.http.get('/v1/admin/settings').query({ key: 'support.contact' }).set(bearer(a.token)).expect(200)).body.items;
    expect(one.map((x: { scope: string }) => x.scope).sort()).toEqual(['city:CD:Goma', 'country:CD', 'global']);
    await ctx.http.get('/v1/admin/settings').query({ key: 'nope' }).set(bearer(a.token)).expect(400);

    const ev = await ctx.sql.query(`SELECT actor_user_id, metadata FROM audit_events WHERE action = 'admin.setting_changed' AND metadata->>'key' = 'cities.pilot'`);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].actor_user_id).toBe(a.id);
    expect(ev.rows[0].metadata.scope).toBe('global');
  });
});

describe('lecture publique', () => {
  it('sans authentification, seulement les clés non sensibles, la portée précise d\'abord', async () => {
    const a = await admin();
    await put(a, { key: 'support.contact', value: { email: 'aide@caselind.test' } }).expect(200);
    await put(a, { key: 'support.contact', scope: 'country:CD', value: { whatsapp: '+243820000000' } }).expect(200);
    await put(a, { key: 'support.contact', scope: 'city:CD:Goma', value: { phone: '+243830000000' } }).expect(200);
    await put(a, { key: 'cities.pilot', value: ['Kinshasa'] }).expect(200);
    await put(a, { key: 'limits.maxOrderMinor', value: { USD: 5_000_000 } }).expect(200);
    await put(a, { key: 'commission.defaultBps', value: 250 }).expect(200);

    const g = (await ctx.http.get('/v1/config/public').expect(200)).body;
    expect(Object.keys(g).sort()).toEqual(['currenciesEnabled', 'pilotCities', 'supportContact']);
    expect(g).toMatchObject({ supportContact: { email: 'aide@caselind.test' }, pilotCities: ['Kinshasa'] });
    expect(JSON.stringify(g)).not.toContain('5000000');
    expect((await ctx.http.get('/v1/config/public').query({ country: 'CD' }).expect(200)).body.supportContact).toEqual({ whatsapp: '+243820000000' });
    expect((await ctx.http.get('/v1/config/public').query({ country: 'CD', city: 'Goma' }).expect(200)).body.supportContact).toEqual({ phone: '+243830000000' });
    expect((await ctx.http.get('/v1/config/public').query({ country: 'KE' }).expect(200)).body.supportContact).toEqual({ email: 'aide@caselind.test' });
    await ctx.http.get('/v1/config/public').query({ country: 'congo' }).expect(400);
  });
});

describe('double validation', () => {
  it('commission.defaultBps et limits.* attendent un second administrateur ; les autres clés passent directement', async () => {
    const a = await admin();
    const b = await admin();
    env.ADMIN_DUAL_APPROVAL = 'true';

    await put(a, { key: 'support.contact', value: { email: 'direct@caselind.test' } }).expect(200);
    expect(await stored('support.contact')).toEqual({ email: 'direct@caselind.test' });

    const p1 = (await put(a, { key: 'commission.defaultBps', value: 400 }).expect(202)).body;
    const p2 = (await put(a, { key: 'limits.maxOrderMinor', scope: 'country:CD', value: { CDF: 9_000_000 } }).expect(202)).body;
    expect(p1.status).toBe('pending');
    expect(await stored('commission.defaultBps')).toBe(250); // valeur d'avant : rien n'est appliqué
    expect(await stored('limits.maxOrderMinor', 'country:CD')).toBeUndefined();

    await ctx.http.post(`/v1/admin/approvals/${p1.approvalId}/approve`).set(bearer(a.token)).expect(403); // pas sa propre demande
    await ctx.http.post(`/v1/admin/approvals/${p1.approvalId}/approve`).set(bearer(b.token)).expect(200);
    await ctx.http.post(`/v1/admin/approvals/${p2.approvalId}/reject`).set(bearer(b.token)).expect(200);
    expect(await stored('commission.defaultBps')).toBe(400);
    expect(await stored('limits.maxOrderMinor', 'country:CD')).toBeUndefined();

    // Mode inactif : appliqué tout de suite.
    env.ADMIN_DUAL_APPROVAL = 'false';
    await put(a, { key: 'commission.defaultBps', value: 300 }).expect(200);
    expect(await stored('commission.defaultBps')).toBe(300);
  });
});

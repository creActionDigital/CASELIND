import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, PASSWORD, type TestContext } from './helpers.js';
import { type Dev, miniappKit, type TU } from './miniapps-kit.js';

let ctx: TestContext;
const kit = miniappKit(() => ctx);
const PIN = '482916';

beforeAll(async () => {
  ctx = await createTestContext({ OAUTH_TOKEN_RATE_LIMIT_PER_MINUTE: '1000', MINIAPP_RATE_LIMIT_PER_MINUTE: '1000' });
  await ctx.sql.query(
    `INSERT INTO feature_flags (key, description, enabled) VALUES ('wallet.sandbox', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`,
  );
});
afterAll(async () => {
  await ctx.close();
});

const get = (path: string, token: string) => ctx.http.get(path).set(bearer(token));
const payRequest = (access: string, body: Record<string, unknown>) => ctx.http.post('/v1/miniapp-api/payment-requests').set(bearer(access)).send(body);
const usageToday = async (appId: string) =>
  (await ctx.sql.query(`SELECT * FROM miniapp_usage_daily WHERE miniapp_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date`, [appId])).rows[0];

describe('usage statistics, access journal and export', () => {
  let dev: Dev;
  let u1: TU;
  let u2: TU;
  let u3: TU;
  let c1: { access: string };
  let c2: { access: string };
  let c3: { access: string };

  beforeAll(async () => {
    dev = await kit.publishedApp();
    u1 = await kit.user();
    u2 = await kit.user();
    u3 = await kit.user();
    await ctx.http.put('/v1/me/payment-pin').set(bearer(u1.token)).send({ pin: PIN, password: PASSWORD }).expect(204);
    await ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(u1.token)).send({ clientId: randomUUID(), amountMinor: 50_00, currency: 'USD' }).expect(201);
    c1 = await kit.connect(u1, dev);
    c2 = await kit.connect(u2, dev);
    c3 = await kit.connect(u3, dev, ['profile.basic']);
  });

  it('counts exactly: authorizations, calls, active users, payments and errors', async () => {
    for (let i = 0; i < 3; i++) await get('/v1/miniapp-api/me', c1.access).expect(200);
    for (let i = 0; i < 2; i++) await get('/v1/miniapp-api/orders', c1.access).expect(200);
    await get('/v1/miniapp-api/me', c2.access).expect(200);
    await get('/v1/miniapp-api/orders', c3.access).expect(403); // refused: an error, not a call
    await payRequest(c1.access, { clientRef: '', amountMinor: 5 }).expect(400); // reached the handler: a call and an error
    const created = await payRequest(c1.access, { clientRef: 'o-1', amountMinor: 12_00, currency: 'USD' }).expect(201);
    await payRequest(c1.access, { clientRef: 'o-1', amountMinor: 12_00, currency: 'USD' }).expect(200); // same request: not counted twice
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${created.body.id}/confirm`).set(bearer(u1.token)).send({ pin: PIN }).expect(200);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${created.body.id}/confirm`).set(bearer(u1.token)).send({ pin: PIN }).expect(200);

    const stats = await get(`/v1/miniapps/${dev.appId}/stats?days=7`, dev.owner.token).expect(200);
    expect(stats.body.days).toBe(7);
    expect(stats.body.items).toHaveLength(7);
    const today = stats.body.items.at(-1);
    expect(today).toEqual({ day: today.day, authorizations: 3, activeUsers: 2, apiCalls: 9, paymentRequests: 1, paymentsConfirmed: 1, errors: 2 });
    for (const d of stats.body.items.slice(0, -1)) expect(d).toMatchObject({ authorizations: 0, apiCalls: 0, errors: 0 });
    const days = stats.body.items.map((d: { day: string }) => d.day);
    expect(new Set(days).size).toBe(7);
    expect([...days].sort()).toEqual(days);
    expect(stats.body.totals).toEqual({ authorizations: 3, apiCalls: 9, paymentRequests: 1, paymentsConfirmed: 1, errors: 2 });
    expect(stats.body.quota).toMatchObject({ perMinute: 1000, overridden: false });

    expect((await get(`/v1/miniapps/${dev.appId}/stats?days=90`, dev.owner.token).expect(200)).body.items).toHaveLength(90);
    expect((await get(`/v1/miniapps/${dev.appId}/stats`, dev.owner.token).expect(200)).body.items).toHaveLength(30);
    await get(`/v1/miniapps/${dev.appId}/stats?days=15`, dev.owner.token).expect(400);
    // Counters only: no user identifier in the table.
    const cols = (await ctx.sql.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'miniapp_usage_daily'`)).rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).not.toContain('user_id');
  });

  it('journals every read for the user, who alone sees it', async () => {
    // u1 made 3 + 2 + 3 calls on resources (the rejected body counts: the guard let it in); u2 one.
    const log = (await ctx.sql.query(`SELECT scope, resource FROM miniapp_access_log WHERE miniapp_id = $1 AND user_id = $2`, [dev.appId, u1.id])).rows;
    expect(log).toHaveLength(8);
    expect(log.filter((r: { resource: string }) => r.resource === 'profile')).toHaveLength(3);
    expect(log.filter((r: { resource: string }) => r.resource === 'orders')).toHaveLength(2);
    expect(log.filter((r: { resource: string }) => r.resource === 'payment')).toHaveLength(3);
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM miniapp_access_log WHERE miniapp_id = $1 AND user_id = $2`, [dev.appId, u3.id])).rows[0].n).toBe(0);

    const first = await get(`/v1/me/miniapps/${dev.appId}/activity?limit=3`, u1.token).expect(200);
    expect(first.body.items).toHaveLength(3);
    expect(Object.keys(first.body.items[0]).sort()).toEqual(['at', 'id', 'resource', 'scope']);
    const seen = new Set<string>(first.body.items.map((i: { id: string }) => i.id));
    let cursor: string | null = first.body.nextCursor;
    while (cursor) {
      const next = await get(`/v1/me/miniapps/${dev.appId}/activity?limit=3&cursor=${encodeURIComponent(cursor)}`, u1.token).expect(200);
      for (const i of next.body.items) seen.add(i.id);
      cursor = next.body.nextCursor;
    }
    expect(seen.size).toBe(8);

    expect((await get(`/v1/me/miniapps/${dev.appId}/activity`, u2.token).expect(200)).body.items).toHaveLength(1);
    // The developer is not the user: they see nothing of the users' activity; a user who never authorized the app gets a 404.
    await get(`/v1/me/miniapps/${dev.appId}/activity`, dev.owner.token).expect(404);
    await get(`/v1/me/miniapps/${dev.appId}/activity`, (await kit.user()).token).expect(404);
    await get(`/v1/me/miniapps/not-a-uuid/activity`, u1.token).expect(404);
  });

  it('keeps 90 days of activity, then purges; the export lists the reads without content; deletion erases them', async () => {
    await ctx.sql.query(`INSERT INTO miniapp_access_log (miniapp_id, user_id, scope, resource, at) VALUES ($1, $2, 'profile.basic', 'profile', now() - interval '91 days')`, [dev.appId, u2.id]);
    await ctx.sql.query(`INSERT INTO miniapp_usage_daily (miniapp_id, day, api_calls) VALUES ($1, (now() AT TIME ZONE 'UTC')::date - 401, 5)`, [dev.appId]);
    expect((await get(`/v1/me/miniapps/${dev.appId}/activity`, u2.token).expect(200)).body.items).toHaveLength(1);

    const exported = await get('/v1/me/export', u1.token).expect(200);
    expect(exported.body.miniappAccess).toHaveLength(8);
    expect(exported.body.miniappAccess[0]).toMatchObject({ appId: dev.appId, appName: 'Mon App' });
    expect(Object.keys(exported.body.miniappAccess[0]).sort()).toEqual(['appId', 'appName', 'at', 'scope']);

    await ctx.app.get(MaintenanceService).runOnce();
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM miniapp_access_log WHERE user_id = $1 AND at < now() - interval '90 days'`, [u2.id])).rows[0].n).toBe(0);
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM miniapp_usage_daily WHERE miniapp_id = $1 AND day < (now() AT TIME ZONE 'UTC')::date - 400`, [dev.appId])).rows[0].n).toBe(0);
    expect((await usageToday(dev.appId)).api_calls).toBe(9);

    await ctx.http.post('/v1/me/deletion-request').set(bearer(u2.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [u2.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM miniapp_access_log WHERE user_id = $1`, [u2.id])).rows[0].n).toBe(0);
  });
});

describe('quota per application', () => {
  it('answers 429 with Retry-After past the per-minute budget; the admin override applies at once and can be lifted', async () => {
    const dev = await kit.publishedApp(['profile.basic']);
    const mod = await kit.adminUser();
    const u = await kit.user();
    const c = await kit.connect(u, dev, ['profile.basic']);

    await ctx.http.patch(`/v1/admin/miniapps/${dev.appId}/quota`).set(bearer(dev.owner.token)).send({ rateLimitPerMinute: 2 }).expect(403);
    await ctx.http.patch(`/v1/admin/miniapps/${dev.appId}/quota`).set(bearer(mod.token)).send({ rateLimitPerMinute: 0 }).expect(400);
    const set = await ctx.http.patch(`/v1/admin/miniapps/${dev.appId}/quota`).set(bearer(mod.token)).send({ rateLimitPerMinute: 2 }).expect(200);
    expect(set.body.rateLimitPerMinute).toBe(2);

    await get('/v1/miniapp-api/me', c.access).expect(200);
    await get('/v1/miniapp-api/me', c.access).expect(200);
    const refused = await get('/v1/miniapp-api/me', c.access).expect(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(refused.body.error?.code ?? refused.body.code).toBe('rate_limited');

    // Refused calls are neither journaled nor counted as calls, but they count as errors.
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM miniapp_access_log WHERE miniapp_id = $1`, [dev.appId])).rows[0].n).toBe(2);
    expect(await usageToday(dev.appId)).toMatchObject({ api_calls: 2, errors: 1 });
    const stats = await get(`/v1/miniapps/${dev.appId}/stats?days=7`, dev.owner.token).expect(200);
    expect(stats.body.quota).toEqual({ perMinute: 2, perDay: 50_000, overridden: true });

    // One app's budget does not touch another app's.
    const other = await kit.publishedApp(['profile.basic']);
    const oc = await kit.connect(await kit.user(), other, ['profile.basic']);
    await get('/v1/miniapp-api/me', oc.access).expect(200);

    const lifted = await ctx.http.patch(`/v1/admin/miniapps/${dev.appId}/quota`).set(bearer(mod.token)).send({ rateLimitPerMinute: null }).expect(200);
    expect(lifted.body.rateLimitPerMinute).toBeNull();
    await get('/v1/miniapp-api/me', c.access).expect(200);
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'miniapp.quota_set' AND metadata->>'appId' = $1`, [dev.appId]);
    expect(audit.rows).toHaveLength(2);
  });
});

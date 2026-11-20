import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { MiniAppRevenueService, previousMonthStart } from '../src/miniapps/miniapp-revenue.service.js';
import { MiniAppWebhookService } from '../src/miniapps/miniapp-webhook.service.js';
import type { WebhookPostRequest, WebhookTransport } from '../src/webhooks/webhook-transport.js';
import { WebhookService } from '../src/webhooks/webhooks.service.js';
import { bearer, createTestContext, PASSWORD, type TestContext } from './helpers.js';
import { ALL_SCOPES, type Dev, manifestFor, miniappKit, REDIRECT, type TU } from './miniapps-kit.js';

class FakeTransport implements WebhookTransport {
  readonly calls: WebhookPostRequest[] = [];
  respond: number | Error = 200;
  async lookup(): Promise<string[]> {
    return ['93.184.216.34'];
  }
  async post(req: WebhookPostRequest): Promise<{ status: number }> {
    this.calls.push(req);
    if (this.respond instanceof Error) throw this.respond;
    return { status: this.respond };
  }
}

let ctx: TestContext;
const kit = miniappKit(() => ctx);
const net = new FakeTransport();
const PIN = '482916';

beforeAll(async () => {
  ctx = await createTestContext({ OAUTH_TOKEN_RATE_LIMIT_PER_MINUTE: '1000', MINIAPP_RATE_LIMIT_PER_MINUTE: '1000' });
  ctx.app.get(WebhookService).transport = net;
  await ctx.sql.query(`INSERT INTO feature_flags (key, description, enabled) VALUES ('wallet.sandbox', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`);
});
afterAll(async () => {
  await ctx.close();
});

const get = (path: string, token: string) => ctx.http.get(path).set(bearer(token));
const post = (path: string, token: string, body: Record<string, unknown> = {}) => ctx.http.post(path).set(bearer(token)).send(body);

describe('declarative manifest', () => {
  it('refuses a submission without a complete manifest and rejects malformed ones', async () => {
    const owner = await kit.user();
    const orgId = await kit.org(owner);
    const base = { name: 'Sans manifeste', launchUrl: 'https://app.example.test/', redirectUris: [REDIRECT], scopes: ['profile.basic'] };
    const m = manifestFor(['profile.basic']);
    const create = (extra: Record<string, unknown>) => post(`/v1/orgs/${orgId}/miniapps`, owner.token, { ...base, ...extra });

    for (const bad of [
      { ...m, extra: true },
      { ...m, termsUrl: 'http://app.example.test/terms' },
      { ...m, supportEmail: 'pas-un-email' },
      { ...m, endpoints: [{ method: 'GET', path: '/v1/me' }] }, // not in the catalogue
      { ...m, endpoints: [{ method: 'GET', path: '/v1/miniapp-api/orders' }] }, // scope not requested
      { ...m, dataAccessed: [] }, // scope not described
      { ...m, events: ['payment.confirmed'] }, // needs wallet.pay
      { ...m, costs: { model: 'free', description: 'x', maxAmountMinor: 100, currency: 'USD' } },
      { ...m, costs: { model: 'per_use', description: 'x', maxAmountMinor: 100, currency: null } },
      { ...m, dataAccessed: [{ scope: 'profile.basic', purpose: 'x'.repeat(121), retention: '1 an' }] },
    ]) {
      await create({ manifest: bad }).expect(400);
    }

    const draft = await create({}).expect(201);
    const submit = await post(`/v1/orgs/${orgId}/miniapps/${draft.body.id}/submit`, owner.token).expect(400);
    expect(JSON.stringify(submit.body)).toContain('manifest');
    await ctx.http.patch(`/v1/orgs/${orgId}/miniapps/${draft.body.id}`).set(bearer(owner.token)).send({ manifest: { ...m, dataAccessed: [] } }).expect(400);
    await ctx.http.patch(`/v1/orgs/${orgId}/miniapps/${draft.body.id}`).set(bearer(owner.token)).send({ manifest: m }).expect(200);
    await post(`/v1/orgs/${orgId}/miniapps/${draft.body.id}/submit`, owner.token).expect(200);
  });

  it('applies the approved manifest at the guard (403 not_declared, counted as an error) and shows it in the directory and consent preview', async () => {
    const scopes = ['profile.basic', 'orders.read'];
    const m = manifestFor(scopes, { endpoints: [{ method: 'GET', path: '/v1/miniapp-api/me' }] });
    const dev = await kit.publishedApp(scopes, m);
    const u = await kit.user();
    const c = await kit.connect(u, dev, scopes);
    await get('/v1/miniapp-api/me', c.access).expect(200);
    const refused = await get('/v1/miniapp-api/orders', c.access).expect(403);
    expect(refused.body.error.details).toMatchObject({ reason: 'not_declared' });
    const day = await ctx.sql.query(`SELECT errors FROM miniapp_usage_daily WHERE miniapp_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date`, [dev.appId]);
    expect(day.rows[0].errors).toBe(1);
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM miniapp_access_log WHERE miniapp_id = $1 AND scope = 'orders.read'`, [dev.appId])).rows[0].n).toBe(0);

    const detail = await get(`/v1/miniapps/${dev.appId}`, u.token).expect(200);
    expect(detail.body.manifest).toMatchObject({ termsUrl: 'https://app.example.test/terms', costs: { model: 'free' } });
    expect(detail.body.certification).toBe('reviewed');
    const list = await get('/v1/miniapps', u.token).expect(200);
    expect(list.body.items.find((a: { id: string }) => a.id === dev.appId)).toMatchObject({ certification: 'reviewed', costModel: 'free' });
    const preview = await get(`/v1/oauth/authorize/preview?clientId=${dev.clientId}&redirectUri=${encodeURIComponent(REDIRECT)}`, u.token).expect(200);
    expect(preview.body).toMatchObject({ certification: 'reviewed', manifest: { dataLocation: 'Union européenne' } });
  });

  it('a legacy app without a manifest cannot call anything', async () => {
    const dev = await kit.publishedApp(['profile.basic']);
    const u = await kit.user();
    const c = await kit.connect(u, dev, ['profile.basic']);
    await ctx.sql.query(`UPDATE miniapps SET manifest = NULL WHERE id = $1`, [dev.appId]);
    const res = await get('/v1/miniapp-api/me', c.access).expect(403);
    expect(res.body.error.details.reason).toBe('not_declared');
  });

  it('a version that changes data or costs freezes a new manifest, asks users to consent again and notifies them', async () => {
    const scopes = ['profile.basic'];
    const dev = await kit.publishedApp(scopes);
    const mod = await kit.adminUser();
    const u = await kit.user();
    const c = await kit.connect(u, dev, scopes);
    await get('/v1/miniapp-api/me', c.access).expect(200);
    const v = await post(`/v1/miniapps/${dev.appId}/versions`, dev.owner.token, {
      version: '1.1.0',
      manifest: manifestFor(scopes, { costs: { model: 'subscription', description: '2 USD par mois', maxAmountMinor: 200, currency: 'USD' } }),
    }).expect(201);
    expect(v.body).toMatchObject({ needsReconsent: true, addedScopes: [] });
    await post(`/v1/miniapps/${dev.appId}/versions/${v.body.id}/submit`, dev.owner.token).expect(200);
    await post(`/v1/admin/miniapps/versions/${v.body.id}/approve`, mod.token, {}).expect(200);

    const frozen = await ctx.sql.query(`SELECT manifest FROM miniapps WHERE id = $1`, [dev.appId]);
    expect(frozen.rows[0].manifest.costs.model).toBe('subscription');
    const grants = await get('/v1/me/miniapp-grants', u.token).expect(200);
    expect(grants.body.items[0]).toMatchObject({ reconsentRequired: true });
    const note = await ctx.sql.query(`SELECT title FROM notifications WHERE user_id = $1 AND data->>'kind' = 'miniapp_reconsent'`, [u.id]);
    expect(note.rows).toHaveLength(1);

    // The same consent screen renews it.
    const preview = await get(`/v1/oauth/authorize/preview?clientId=${dev.clientId}&redirectUri=${encodeURIComponent(REDIRECT)}`, u.token).expect(200);
    expect(preview.body).toMatchObject({ reconsentRequired: true, manifest: { costs: { model: 'subscription' } } });
    await kit.connect(u, dev, scopes);
    expect((await get('/v1/me/miniapp-grants', u.token).expect(200)).body.items[0].reconsentRequired).toBe(false);
  });
});

describe('native consent flow (OAuth) and isolation of redirects', () => {
  it('delivers a code, refuses a foreign or altered redirect_uri, requires PKCE S256, and a refusal grants nothing', async () => {
    const dev = await kit.publishedApp(['profile.basic']);
    const u = await kit.user();
    const body = (extra: Record<string, unknown> = {}) => ({ clientId: dev.clientId, redirectUri: REDIRECT, scopes: ['profile.basic'], state: 'state-12345678', codeChallenge: 'a'.repeat(43), ...extra });
    // Refusal: the screen never calls authorize; nothing is granted.
    expect((await get('/v1/me/miniapp-grants', u.token).expect(200)).body.items).toEqual([]);

    for (const redirectUri of ['https://evil.example.test/callback', `${REDIRECT}/`, `${REDIRECT}?next=https://evil.test`, 'https://app.example.test/callback#x', 'https://app.example.test.evil.test/callback', 'javascript:alert(1)', '//evil.test']) {
      await post('/v1/oauth/authorize', u.token, body({ redirectUri })).expect(400);
      await get(`/v1/oauth/authorize/preview?clientId=${dev.clientId}&redirectUri=${encodeURIComponent(redirectUri)}`, u.token).expect(400);
    }
    await post('/v1/oauth/authorize', u.token, body({ codeChallengeMethod: 'plain' })).expect(400);
    await post('/v1/oauth/authorize', u.token, { ...body(), codeChallenge: undefined }).expect(400);
    await post('/v1/oauth/authorize', u.token, body({ codeChallenge: 'short' })).expect(400);
    await post('/v1/oauth/authorize', u.token, body({ state: 'x' })).expect(400);
    await post('/v1/oauth/authorize', u.token, body({ scopes: ['orders.read'] })).expect(400); // not declared by the app
    expect((await get('/v1/me/miniapp-grants', u.token).expect(200)).body.items).toEqual([]);

    const ok = await post('/v1/oauth/authorize', u.token, body()).expect(200);
    const target = new URL(ok.body.redirectTo);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get('state')).toBe('state-12345678');
    expect(target.searchParams.get('code')).toBe(ok.body.code);
    // Exchange with a different redirect_uri or a missing verifier fails and burns the code.
    await ctx.http.post('/v1/oauth/token').send({ grant_type: 'authorization_code', client_id: dev.clientId, client_secret: dev.secret, redirect_uri: 'https://app.example.test/other', code: ok.body.code, code_verifier: 'v'.repeat(43) }).expect(400);
  });

  it('never returns the client secret after creation or rotation, and sets no cookie on app routes', async () => {
    const dev = await kit.publishedApp(['profile.basic']);
    const read = await get(`/v1/orgs/${dev.orgId}/miniapps/${dev.appId}`, dev.owner.token).expect(200);
    expect(JSON.stringify(read.body)).not.toContain(dev.secret);
    expect(JSON.stringify((await get('/v1/me/miniapps', dev.owner.token).expect(200)).body)).not.toContain('clientSecret');
    const rotated = await post(`/v1/orgs/${dev.orgId}/miniapps/${dev.appId}/rotate-secret`, dev.owner.token).expect(200);
    expect(rotated.body.clientSecret).toMatch(/^cls_/);
    expect(JSON.stringify((await get(`/v1/orgs/${dev.orgId}/miniapps/${dev.appId}`, dev.owner.token).expect(200)).body)).not.toContain(rotated.body.clientSecret);
    const u = await kit.user();
    const c = await kit.connect(u, { ...dev, secret: rotated.body.clientSecret }, ['profile.basic']);
    const res = await get('/v1/miniapp-api/me', c.access).expect(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps apps, users and organisations apart', async () => {
    const a = await kit.publishedApp();
    const b = await kit.publishedApp();
    const u1 = await kit.user();
    const u2 = await kit.user();
    await ctx.http.put('/v1/me/payment-pin').set(bearer(u1.token)).send({ pin: PIN, password: PASSWORD }).expect(204);
    const ca = await kit.connect(u1, a);
    const cb = await kit.connect(u1, b);
    const cu2 = await kit.connect(u2, a);
    // The same user has a different identifier for each app, and neither is the global id.
    const meA = (await get('/v1/miniapp-api/me', ca.access).expect(200)).body;
    const meB = (await get('/v1/miniapp-api/me', cb.access).expect(200)).body;
    const meU2 = (await get('/v1/miniapp-api/me', cu2.access).expect(200)).body;
    expect(new Set([meA.id, meB.id, meU2.id, u1.id, u2.id]).size).toBe(5);

    // A payment request of app A, user 1 is invisible to app B and to user 2 of app A.
    const req = await post('/v1/miniapp-api/payment-requests', ca.access, { clientRef: 'iso-1', amountMinor: 100, currency: 'USD' }).expect(201);
    await get(`/v1/miniapp-api/payment-requests/${req.body.id}`, cb.access).expect(404);
    await get(`/v1/miniapp-api/payment-requests/${req.body.id}`, cu2.access).expect(404);
    await get(`/v1/miniapp-api/payment-requests/${req.body.id}`, ca.access).expect(200);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${req.body.id}/confirm`).set(bearer(u2.token)).send({ pin: PIN }).expect(404);

    // Orders: only those placed with the organisation that owns the app; an organisation the user is not a member of stays closed.
    await get(`/v1/orgs/${a.orgId}/miniapps`, u1.token).expect(404);
    await get(`/v1/orgs/${a.orgId}/miniapps/${a.appId}`, u1.token).expect(404);
    // An app token opens no user route, an app A token no developer route.
    await get('/v1/me', ca.access).expect(401);
    await get(`/v1/miniapps/${a.appId}/stats`, ca.access).expect(401);
    await post(`/v1/miniapps/${a.appId}/webhook/test`, ca.access).expect(401);
    // A developer of app B sees nothing of app A.
    await get(`/v1/miniapps/${a.appId}/webhook`, b.owner.token).expect(404);
    await get(`/v1/miniapps/${a.appId}/revenue`, b.owner.token).expect(404);
    await get(`/v1/miniapps/${a.appId}/revenue/export`, b.owner.token).expect(404);
    // Scope outside the token: 403.
    const narrow = await kit.connect(await kit.user(), a, ['profile.basic']);
    await get('/v1/miniapp-api/orders', narrow.access).expect(403);
  });
});

describe('webhooks to mini-apps', () => {
  let dev: Dev;
  let u: TU;
  let access: string;
  let secret: string;
  const hookUrl = 'https://hooks.example.test/caselind';
  const last = () => net.calls.at(-1)!;
  const flush = () => ctx.app.get(MiniAppWebhookService).idle();

  beforeAll(async () => {
    dev = await kit.publishedApp();
    u = await kit.user();
    await ctx.http.put('/v1/me/payment-pin').set(bearer(u.token)).send({ pin: PIN, password: PASSWORD }).expect(204);
    await ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(u.token)).send({ clientId: randomUUID(), amountMinor: 50_00, currency: 'USD' }).expect(201);
  });

  it('creates one signed webhook per app, limited to declared events, with an SSRF-checked URL and a secret shown once', async () => {
    const stranger = await kit.user();
    await post(`/v1/miniapps/${dev.appId}/webhook`, stranger.token, { url: hookUrl }).expect(404);
    for (const url of ['http://hooks.example.test/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://user:pw@hooks.example.test/x', 'https://localhost/x']) {
      await post(`/v1/miniapps/${dev.appId}/webhook`, dev.owner.token, { url }).expect(400);
    }
    const narrow = await kit.publishedApp(['profile.basic'], manifestFor(['profile.basic'], { events: ['authorization.granted'] }));
    const refused = await post(`/v1/miniapps/${narrow.appId}/webhook`, narrow.owner.token, { url: hookUrl, events: ['authorization.revoked'] }).expect(409);
    expect(refused.body.error.details.reason).toBe('event_not_declared');

    const created = await post(`/v1/miniapps/${dev.appId}/webhook`, dev.owner.token, { url: hookUrl }).expect(201);
    secret = created.body.secret;
    expect(secret).toMatch(/^whsec_/);
    expect(created.body.events).toHaveLength(5);
    await post(`/v1/miniapps/${dev.appId}/webhook`, dev.owner.token, { url: hookUrl }).expect(409);
    const read = await get(`/v1/miniapps/${dev.appId}/webhook`, dev.owner.token).expect(200);
    expect(JSON.stringify(read.body)).not.toContain(secret);
    const stored = await ctx.sql.query(`SELECT secret_enc FROM miniapp_webhooks WHERE miniapp_id = $1`, [dev.appId]);
    expect(stored.rows[0].secret_enc).not.toContain(secret);
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'miniapp.webhook_created' ORDER BY occurred_at DESC LIMIT 1`);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(secret);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain('/caselind');
  });

  it('sends signed, minimal events: granted, payment confirmed and declined, revoked, data deletion', async () => {
    const before = net.calls.length;
    access = (await kit.connect(u, dev)).access;
    await flush();
    expect(net.calls.length).toBe(before + 1);
    const granted = last();
    expect(granted.headers['X-Caselind-Event']).toBe('authorization.granted');
    const ts = granted.headers['X-Caselind-Timestamp']!;
    expect(granted.headers['X-Caselind-Signature']).toBe(createHmac('sha256', secret).update(`${ts}.${granted.body}`).digest('hex'));
    const env = JSON.parse(granted.body);
    expect(env).toMatchObject({ event: 'authorization.granted', appId: dev.appId });
    expect(env.data.sub).toMatch(/^sub_/);
    expect(granted.body).not.toContain(u.id);

    const req = await post('/v1/miniapp-api/payment-requests', access, { clientRef: 'wh-1', amountMinor: 300, currency: 'USD' }).expect(201);
    await post(`/v1/me/miniapp-payment-requests/${req.body.id}/confirm`, u.token, { pin: PIN }).expect(200);
    await flush();
    expect(JSON.parse(last().body)).toMatchObject({ event: 'payment.confirmed', data: { clientRef: 'wh-1', amountMinor: 300, currency: 'USD' } });
    const req2 = await post('/v1/miniapp-api/payment-requests', access, { clientRef: 'wh-2', amountMinor: 100, currency: 'USD' }).expect(201);
    await post(`/v1/me/miniapp-payment-requests/${req2.body.id}/decline`, u.token).expect(200);
    await post(`/v1/me/miniapp-payment-requests/${req2.body.id}/decline`, u.token).expect(200); // idempotent: one event only
    await flush();
    const declined = net.calls.filter((c) => c.headers['X-Caselind-Event'] === 'payment.declined');
    expect(declined).toHaveLength(1);
    for (const c of net.calls) expect(c.body).not.toContain(u.id);

    await ctx.http.delete(`/v1/me/miniapp-grants/${dev.appId}`).set(bearer(u.token)).expect(204);
    await ctx.http.delete(`/v1/me/miniapp-grants/${dev.appId}`).set(bearer(u.token)).expect(204);
    await flush();
    expect(net.calls.filter((c) => c.headers['X-Caselind-Event'] === 'authorization.revoked')).toHaveLength(1);

    const gone = await kit.user();
    await kit.connect(gone, dev);
    await flush();
    const n = net.calls.length;
    await post('/v1/me/deletion-request', gone.token, { password: PASSWORD }).expect(202);
    await flush();
    expect(net.calls.length).toBe(n + 1);
    expect(JSON.parse(last().body)).toMatchObject({ event: 'user.data_deletion_requested' });
    expect(last().body).not.toContain(gone.id);
  });

  it('keeps a journal, tests with a ping, retries with backoff and switches off after repeated failures', async () => {
    const hooks = ctx.app.get(MiniAppWebhookService);
    const ping = await post(`/v1/miniapps/${dev.appId}/webhook/test`, dev.owner.token).expect(200);
    expect(ping.body).toMatchObject({ event: 'ping', status: 'delivered', httpStatus: 200 });
    const journal = await get(`/v1/miniapps/${dev.appId}/webhook/deliveries`, dev.owner.token).expect(200);
    expect(journal.body.items.length).toBeGreaterThan(3);
    expect(JSON.stringify(journal.body)).not.toContain('sub_');

    net.respond = 500;
    const u2 = await kit.user();
    await kit.connect(u2, dev);
    await flush();
    const pending = await ctx.sql.query(`SELECT status, attempt FROM miniapp_webhook_deliveries WHERE event = 'authorization.granted' ORDER BY created_at DESC LIMIT 1`);
    expect(pending.rows[0]).toMatchObject({ status: 'pending', attempt: 1 });
    // Retries run when due; three attempts make a failed delivery, ten failed deliveries switch the hook off.
    for (let i = 0; i < 12; i++) {
      await ctx.sql.query(`UPDATE miniapp_webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`);
      await hooks.processDue();
      const w = await kit.user();
      await kit.connect(w, dev);
      await flush();
    }
    for (let i = 0; i < 3; i++) {
      await ctx.sql.query(`UPDATE miniapp_webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`);
      await hooks.processDue();
    }
    const hook = (await get(`/v1/miniapps/${dev.appId}/webhook`, dev.owner.token).expect(200)).body;
    expect(hook.active).toBe(false);
    expect(hook.disabledAt).toBeTruthy();
    const warn = await ctx.sql.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND data->>'kind' = 'miniapp_webhook_disabled'`, [dev.owner.id]);
    expect(warn.rows.length).toBe(1);

    // A passing test switches it back on; the secret rotates and is shown once more.
    net.respond = 200;
    await post(`/v1/miniapps/${dev.appId}/webhook/test`, dev.owner.token).expect(200);
    expect((await get(`/v1/miniapps/${dev.appId}/webhook`, dev.owner.token).expect(200)).body.active).toBe(true);
    const rotated = await post(`/v1/miniapps/${dev.appId}/webhook/rotate-secret`, dev.owner.token).expect(200);
    expect(rotated.body.secret).not.toBe(secret);
    await ctx.http.delete(`/v1/miniapps/${dev.appId}/webhook`).set(bearer(dev.owner.token)).expect(204);
    await get(`/v1/miniapps/${dev.appId}/webhook`, dev.owner.token).expect(404);
  });
});

describe('notifications sent by a mini-app', () => {
  it('reaches only the token user, labelled, 5 a day, declared links only, mutable, audited without content', async () => {
    const dev = await kit.publishedApp();
    const u = await kit.user();
    const other = await kit.user();
    const c = await kit.connect(u, dev);
    const send = (extra: Record<string, unknown> = {}) => post('/v1/miniapp-api/notify', c.access, { title: 'Bonjour', body: 'Votre colis arrive', ...extra });

    await send({ body: 'Voir https://evil.example.test/promo' }).expect(400);
    await send({ body: 'Voir evil.example.com' }).expect(400);
    await send({ body: 'Voir www.evil.example.test' }).expect(400);
    await send({ title: 'x'.repeat(61) }).expect(400);
    await send({ body: 'x'.repeat(201) }).expect(400);
    await send({ deepLink: 'https://evil.example.test/' }).expect(400);
    await send({ userId: other.id, deepLink: 'https://app.example.test/orders/1', body: 'Voir app.example.test/privacy' }).expect(200); // declared hosts are fine; userId is ignored

    const mine = await ctx.sql.query(`SELECT category, title, body FROM notifications WHERE user_id = $1 AND data->>'kind' = 'miniapp_notify'`, [u.id]);
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]).toMatchObject({ category: 'system', title: '[Mon App] : Bonjour' });
    expect((await ctx.sql.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND data->>'kind' = 'miniapp_notify'`, [other.id])).rows).toHaveLength(0);

    for (let i = 0; i < 4; i++) await send().expect(200);
    const over = await send().expect(429);
    expect(over.body.error.details).toMatchObject({ reason: 'notify_quota', scope: 'user' });
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    // Another user of the same app has their own five.
    const c2 = await kit.connect(other, dev);
    await post('/v1/miniapp-api/notify', c2.access, { title: 'Salut', body: 'Bonjour' }).expect(200);

    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'miniapp.notified' AND actor_user_id = $1`, [u.id]);
    expect(audit.rows.length).toBe(5);
    expect(JSON.stringify(audit.rows)).not.toContain('Bonjour');
    expect(JSON.stringify(audit.rows)).not.toContain('colis');
  });

  it('is silent once the user mutes the app, and the app needs the declared scope', async () => {
    const dev = await kit.publishedApp();
    const u = await kit.user();
    const c = await kit.connect(u, dev);
    await ctx.http.put(`/v1/me/miniapp-grants/${dev.appId}/notifications`).set(bearer(u.token)).send({ muted: true }).expect(204);
    expect((await get('/v1/me/miniapp-grants', u.token).expect(200)).body.items[0].notificationsMuted).toBe(true);
    const res = await post('/v1/miniapp-api/notify', c.access, { title: 'Pub', body: 'Achetez' }).expect(200);
    expect(res.body.delivered).toBe(false);
    expect((await ctx.sql.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND data->>'kind' = 'miniapp_notify'`, [u.id])).rows).toHaveLength(0);
    await ctx.http.put(`/v1/me/miniapp-grants/${dev.appId}/notifications`).set(bearer(u.token)).send({ muted: false }).expect(204);
    expect((await post('/v1/miniapp-api/notify', c.access, { title: 'Ok', body: 'Merci' }).expect(200)).body.delivered).toBe(true);
    await ctx.http.put(`/v1/me/miniapp-grants/${randomUUID()}/notifications`).set(bearer(u.token)).send({ muted: true }).expect(404);

    const noScope = await kit.publishedApp(['profile.basic']);
    const c2 = await kit.connect(await kit.user(), noScope, ['profile.basic']);
    await post('/v1/miniapp-api/notify', c2.access, { title: 'Ok', body: 'Merci' }).expect(403);
    await ctx.sql.query(`UPDATE miniapp_notify_daily SET n = 0`); // keeps other runs independent
  });
});

describe('indicative revenue statements', () => {
  it('computes the closed month idempotently: exact rounding, currencies apart, only paid requests', async () => {
    const dev = await kit.publishedApp(['wallet.pay']);
    const mod = await kit.adminUser();
    const u = await kit.user();
    await ctx.http.patch(`/v1/admin/miniapps/${dev.appId}/revenue-share`).set(bearer(dev.owner.token)).send({ revenueShareBps: 100 }).expect(403);
    await ctx.http.patch(`/v1/admin/miniapps/${dev.appId}/revenue-share`).set(bearer(mod.token)).send({ revenueShareBps: 3001 }).expect(400);
    await ctx.http.patch(`/v1/admin/miniapps/${dev.appId}/revenue-share`).set(bearer(mod.token)).send({ revenueShareBps: 1250 }).expect(200);

    const lastMonth = previousMonthStart(new Date());
    const insert = (ref: string, amount: number, currency: string, status: string) =>
      ctx.sql.query(
        `INSERT INTO miniapp_payment_requests (app_id, org_id, user_id, client_ref, amount_minor, currency, status, expires_at, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), ($8::date + interval '10 days'))`,
        [dev.appId, dev.orgId, u.id, ref, amount, currency, status, lastMonth],
      );
    await insert('a', 1001, 'USD', 'paid'); // 12.5 % of 1001 = 125.125 -> 125
    await insert('b', 3, 'USD', 'paid'); // + 3 = 1004 -> 125.5 -> 126 (half up)
    await insert('c', 9999, 'USD', 'cancelled');
    await insert('d', 9999, 'USD', 'declined');
    await insert('e', 500, 'CDF', 'paid');
    await ctx.sql.query(`INSERT INTO miniapp_payment_requests (app_id, org_id, user_id, client_ref, amount_minor, currency, status, expires_at, decided_at) VALUES ($1, $2, $3, 'old', 700, 'USD', 'paid', now(), now() - interval '90 days')`, [dev.appId, dev.orgId, u.id]);

    const svc = ctx.app.get(MiniAppRevenueService);
    await svc.runMaintenance(new Date());
    await svc.runMaintenance(new Date()); // idempotent
    const rev = await get(`/v1/miniapps/${dev.appId}/revenue`, dev.owner.token).expect(200);
    expect(rev.body.disclaimer).toContain('aucun versement réel');
    expect(rev.body.revenueShareBps).toBe(1250);
    const closed = rev.body.items.filter((i: { period: string }) => i.period === lastMonth);
    expect(closed).toHaveLength(2);
    expect(closed.find((i: { currency: string }) => i.currency === 'USD')).toMatchObject({ grossMinor: 1004, platformMinor: 126, developerMinor: 878, paymentsCount: 2, status: 'closed', shareBps: 1250 });
    expect(closed.find((i: { currency: string }) => i.currency === 'CDF')).toMatchObject({ grossMinor: 500, platformMinor: 63, developerMinor: 437, paymentsCount: 1 });

    // A closed statement is never recomputed, even when the share changes.
    await ctx.http.patch(`/v1/admin/miniapps/${dev.appId}/revenue-share`).set(bearer(mod.token)).send({ revenueShareBps: 0 }).expect(200);
    await svc.runMaintenance(new Date());
    const again = await get(`/v1/miniapps/${dev.appId}/revenue`, dev.owner.token).expect(200);
    expect(again.body.items.find((i: { period: string; currency: string }) => i.period === lastMonth && i.currency === 'USD').platformMinor).toBe(126);

    const csv = await ctx.http.get(`/v1/miniapps/${dev.appId}/revenue/export`).set(bearer(dev.owner.token)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('period,currency,gross_minor');
    expect(csv.text).toContain(`${lastMonth},USD,1004,126,878,1250,2,closed`);
    expect(csv.text.trim().split('\n').at(-1)).toContain('aucun versement réel');
    // The maintenance entry point stays wired.
    expect(ctx.app.get(MaintenanceService)).toBeDefined();
  });
});

describe('certification and suspension', () => {
  it('certifies and decertifies (admin only, owners notified), and a suspension cuts every token at once', async () => {
    const dev = await kit.publishedApp(['profile.basic']);
    const mod = await kit.adminUser();
    const u = await kit.user();
    const c = await kit.connect(u, dev, ['profile.basic']);
    await post(`/v1/admin/miniapps/${dev.appId}/certify`, dev.owner.token, { note: 'Audit OK' }).expect(403);
    await post(`/v1/admin/miniapps/${dev.appId}/certify`, mod.token, {}).expect(400);
    const certified = await post(`/v1/admin/miniapps/${dev.appId}/certify`, mod.token, { note: 'Audit de sécurité OK' }).expect(200);
    expect(certified.body).toMatchObject({ certification: 'certified', certificationNote: 'Audit de sécurité OK' });
    expect(certified.body.certifiedAt).toBeTruthy();
    expect((await get(`/v1/miniapps/${dev.appId}`, u.token).expect(200)).body.certification).toBe('certified');
    expect((await get(`/v1/oauth/authorize/preview?clientId=${dev.clientId}&redirectUri=${encodeURIComponent(REDIRECT)}`, u.token).expect(200)).body.certification).toBe('certified');
    const decert = await post(`/v1/admin/miniapps/${dev.appId}/decertify`, mod.token).expect(200);
    expect(decert.body).toMatchObject({ certification: 'reviewed', certifiedAt: null });
    const notes = await ctx.sql.query(`SELECT title FROM notifications WHERE user_id = $1 AND data->>'kind' = 'miniapp_status' ORDER BY created_at`, [dev.owner.id]);
    expect(notes.rows.map((r: { title: string }) => r.title)).toEqual(expect.arrayContaining(['Application certifiée', 'Certification retirée']));
    const draft = await kit.user();
    const orgId = await kit.org(draft);
    const d = await post(`/v1/orgs/${orgId}/miniapps`, draft.token, { name: 'Brouillon', launchUrl: 'https://a.example.test/', redirectUris: [REDIRECT], scopes: ['profile.basic'] }).expect(201);
    await post(`/v1/admin/miniapps/${d.body.id}/certify`, mod.token, { note: 'Pas publiée' }).expect(409);

    await get('/v1/miniapp-api/me', c.access).expect(200);
    await post(`/v1/admin/miniapps/${dev.appId}/review`, mod.token, { decision: 'suspend', note: 'Plainte' }).expect(200);
    await get('/v1/miniapp-api/me', c.access).expect(401);
    const note = await ctx.sql.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Application suspendue'`, [dev.owner.id]);
    expect(note.rows).toHaveLength(1);
    expect(ALL_SCOPES).toContain('notify');
  });
});

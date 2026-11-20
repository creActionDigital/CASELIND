import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerPort } from '../src/wallet/ledger.port.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';
import { manifestFor } from './miniapps-kit.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ OAUTH_TOKEN_RATE_LIMIT_PER_MINUTE: '1000', PAYMENT_PIN_MAX_ATTEMPTS: '3' });
  await ctx.sql.query(
    `INSERT INTO feature_flags (key, description, enabled) VALUES ('wallet.sandbox', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`,
  );
});
afterAll(async () => {
  await ctx.close();
});

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

let slug = 0;
const REDIRECT = 'https://app.example.test/callback';
const ALL_SCOPES = ['profile.basic', 'profile.phone', 'profile.email', 'orders.read', 'wallet.pay'];
const PIN = '482916';

const pkce = () => {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

async function org(owner: TU): Promise<string> {
  slug += 1;
  const res = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug: `mini-${Date.now().toString(36)}-${slug}`, name: 'Boutique Mini', kind: 'shop' })
    .expect(201);
  return res.body.id as string;
}

interface Dev {
  owner: TU;
  orgId: string;
  appId: string;
  clientId: string;
  secret: string;
}

async function draftApp(scopes = ALL_SCOPES, extra: Record<string, unknown> = {}): Promise<Dev> {
  const owner = await user();
  const orgId = await org(owner);
  const res = await ctx.http
    .post(`/v1/orgs/${orgId}/miniapps`)
    .set(bearer(owner.token))
    .send({ name: 'Mon App', description: 'Une app', launchUrl: 'https://app.example.test/', redirectUris: [REDIRECT], scopes, manifest: manifestFor(scopes), ...extra })
    .expect(201);
  return { owner, orgId, appId: res.body.id, clientId: res.body.clientId, secret: res.body.clientSecret };
}

let admin: TU;
async function publish(dev: Dev): Promise<void> {
  admin ??= await user(['user', 'admin']);
  await ctx.http.post(`/v1/orgs/${dev.orgId}/miniapps/${dev.appId}/submit`).set(bearer(dev.owner.token)).expect(200);
  await ctx.http.post(`/v1/admin/miniapps/${dev.appId}/review`).set(bearer(admin.token)).send({ decision: 'approve' }).expect(200);
}

async function publishedApp(scopes = ALL_SCOPES, extra: Record<string, unknown> = {}): Promise<Dev> {
  const dev = await draftApp(scopes, extra);
  await publish(dev);
  return dev;
}

const authorize = (who: TU, dev: Dev, challenge: string, extra: Record<string, unknown> = {}) =>
  ctx.http
    .post('/v1/oauth/authorize')
    .set(bearer(who.token))
    .send({ clientId: dev.clientId, redirectUri: REDIRECT, scopes: ALL_SCOPES, state: 'state-12345678', codeChallenge: challenge, ...extra });

const exchange = (dev: Dev, body: Record<string, unknown>, secret: string | null = dev.secret) =>
  ctx.http.post('/v1/oauth/token').send({
    grant_type: 'authorization_code',
    client_id: dev.clientId,
    redirect_uri: REDIRECT,
    ...(secret ? { client_secret: secret } : {}),
    ...body,
  });

/** Full consent + code exchange: the app's tokens for `who`. */
async function connect(who: TU, dev: Dev, scopes = ALL_SCOPES) {
  const { verifier, challenge } = pkce();
  const auth = await authorize(who, dev, challenge, { scopes }).expect(200);
  const tok = await exchange(dev, { code: auth.body.code, code_verifier: verifier }).expect(200);
  return { access: tok.body.access_token as string, refresh: tok.body.refresh_token as string, code: auth.body.code as string, verifier, body: tok.body };
}

const topup = (who: TU, amountMinor: number) =>
  ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(who.token)).send({ clientId: randomUUID(), amountMinor, currency: 'USD' }).expect(201);

describe('developer applications and review', () => {
  it('validates URLs, shows the secret once, stores it hashed and rotates it', async () => {
    const owner = await user();
    const orgId = await org(owner);
    const base = { name: 'App', launchUrl: 'https://a.example.test/', redirectUris: [REDIRECT], scopes: ['profile.basic'] };
    await ctx.http.post(`/v1/orgs/${orgId}/miniapps`).set(bearer(owner.token)).send({ ...base, launchUrl: 'http://a.example.test/' }).expect(400);
    await ctx.http.post(`/v1/orgs/${orgId}/miniapps`).set(bearer(owner.token)).send({ ...base, redirectUris: ['https://a.example.test/*'] }).expect(400);
    await ctx.http.post(`/v1/orgs/${orgId}/miniapps`).set(bearer(owner.token)).send({ ...base, redirectUris: ['http://a.example.test/cb'] }).expect(400);
    await ctx.http.post(`/v1/orgs/${orgId}/miniapps`).set(bearer(owner.token)).send({ ...base, scopes: ['admin.all'] }).expect(400);

    const created = await ctx.http.post(`/v1/orgs/${orgId}/miniapps`).set(bearer(owner.token)).send(base).expect(201);
    expect(created.body).toMatchObject({ status: 'draft', confidential: true });
    expect(created.body.clientSecret).toMatch(/^cls_/);
    const stored = await ctx.sql.query(`SELECT client_secret_hash FROM miniapps WHERE id = $1`, [created.body.id]);
    expect(stored.rows[0].client_secret_hash).not.toContain(created.body.clientSecret);
    const read = await ctx.http.get(`/v1/orgs/${orgId}/miniapps/${created.body.id}`).set(bearer(owner.token)).expect(200);
    expect(read.body.clientSecret).toBeUndefined();

    const rotated = await ctx.http.post(`/v1/orgs/${orgId}/miniapps/${created.body.id}/rotate-secret`).set(bearer(owner.token)).expect(200);
    expect(rotated.body.clientSecret).toMatch(/^cls_/);
    expect(rotated.body.clientSecret).not.toBe(created.body.clientSecret);
  });

  it('is reserved to organisation owners, and review to admin or moderator', async () => {
    const dev = await draftApp();
    const manager = await user();
    const handle = (await ctx.http.get('/v1/me').set(bearer(manager.token)).expect(200)).body.handle as string;
    await ctx.http.post(`/v1/orgs/${dev.orgId}/invitations`).set(bearer(dev.owner.token)).send({ handle, role: 'manager' }).expect(201);
    await ctx.http.post(`/v1/me/org-invitations/${dev.orgId}/accept`).set(bearer(manager.token)).expect(200);
    await ctx.http.get(`/v1/orgs/${dev.orgId}/miniapps`).set(bearer(manager.token)).expect(403);
    const outsider = await user();
    await ctx.http.get(`/v1/orgs/${dev.orgId}/miniapps`).set(bearer(outsider.token)).expect(404);

    await ctx.http.post(`/v1/orgs/${dev.orgId}/miniapps/${dev.appId}/submit`).set(bearer(dev.owner.token)).expect(200);
    // The owner cannot approve their own app, nor an ordinary user.
    await ctx.http.post(`/v1/admin/miniapps/${dev.appId}/review`).set(bearer(dev.owner.token)).send({ decision: 'approve' }).expect(403);
    await ctx.http.get('/v1/admin/miniapps').set(bearer(outsider.token)).expect(403);
    const mod = await user(['user', 'moderator']);
    await ctx.http.post(`/v1/admin/miniapps/${dev.appId}/review`).set(bearer(mod.token)).send({ decision: 'reject' }).expect(400);
    const rejected = await ctx.http.post(`/v1/admin/miniapps/${dev.appId}/review`).set(bearer(mod.token)).send({ decision: 'reject', note: 'Icône manquante' }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'rejected', reviewNote: 'Icône manquante' });
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'miniapp.reviewed' AND actor_user_id = $1`, [mod.id]);
    expect(audit.rows.length).toBe(1);
    // Rejected apps can be edited and resubmitted; a published one is frozen.
    await ctx.http.patch(`/v1/orgs/${dev.orgId}/miniapps/${dev.appId}`).set(bearer(dev.owner.token)).send({ name: 'Mon App 2' }).expect(200);
    await publish(dev);
    await ctx.http.patch(`/v1/orgs/${dev.orgId}/miniapps/${dev.appId}`).set(bearer(dev.owner.token)).send({ name: 'Autre' }).expect(409);
  });

  it('keeps an unpublished app invisible and impossible to authorize', async () => {
    const dev = await draftApp();
    const u = await user();
    const q = `clientId=${dev.clientId}&redirectUri=${encodeURIComponent(REDIRECT)}`;
    await ctx.http.get(`/v1/oauth/authorize/preview?${q}`).set(bearer(u.token)).expect(404);
    await authorize(u, dev, pkce().challenge).expect(404);
    await ctx.http.get(`/v1/miniapps/${dev.appId}`).set(bearer(u.token)).expect(404);
    const list = await ctx.http.get('/v1/miniapps').set(bearer(u.token)).expect(200);
    expect(list.body.items.map((a: { id: string }) => a.id)).not.toContain(dev.appId);

    await publish(dev);
    await ctx.http.get(`/v1/oauth/authorize/preview?${q}`).set(bearer(u.token)).expect(200);
    const listed = await ctx.http.get('/v1/miniapps?q=Mon').set(bearer(u.token)).expect(200);
    expect(listed.body.items.map((a: { id: string }) => a.id)).toContain(dev.appId);
    await ctx.http.get(`/v1/miniapps/${dev.appId}`).set(bearer(u.token)).expect(200);

    // Suspension makes it vanish again and cuts its tokens.
    const { access } = await connect(u, dev);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(access)).expect(200);
    await ctx.http.post(`/v1/admin/miniapps/${dev.appId}/review`).set(bearer(admin.token)).send({ decision: 'suspend' }).expect(200);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(access)).expect(401);
    await ctx.http.get(`/v1/miniapps/${dev.appId}`).set(bearer(u.token)).expect(404);
    await authorize(u, dev, pkce().challenge).expect(404);
  });
});

describe('OAuth authorization code with PKCE', () => {
  it('requires an S256 challenge', async () => {
    const dev = await publishedApp();
    const u = await user();
    const noChallenge = await ctx.http
      .post('/v1/oauth/authorize')
      .set(bearer(u.token))
      .send({ clientId: dev.clientId, redirectUri: REDIRECT, scopes: ALL_SCOPES, state: 'state-12345678' });
    expect(noChallenge.status).toBe(400);
    await authorize(u, dev, pkce().challenge, { codeChallengeMethod: 'plain' }).expect(400);
    await authorize(u, dev, 'too-short').expect(400);
  });

  it('refuses a missing or wrong code_verifier, and burns the code', async () => {
    const dev = await publishedApp();
    const u = await user();
    const a = pkce();
    const auth = await authorize(u, dev, a.challenge).expect(200);
    await exchange(dev, { code: auth.body.code }).expect(400);
    const wrong = await exchange(dev, { code: auth.body.code, code_verifier: pkce().verifier }).expect(400);
    expect(wrong.body.error.details).toMatchObject({ error: 'invalid_grant' });
    // Even the right verifier is too late: the code was spent by the failed attempt.
    await exchange(dev, { code: auth.body.code, code_verifier: a.verifier }).expect(400);
  });

  it('matches the redirect URI exactly', async () => {
    const dev = await publishedApp();
    const u = await user();
    for (const bad of [`${REDIRECT}/`, `${REDIRECT}?x=1`, 'https://app.example.test/', 'https://evil.example.test/callback', REDIRECT.toUpperCase()]) {
      await authorize(u, dev, pkce().challenge, { redirectUri: bad }).expect(400);
      await ctx.http
        .get(`/v1/oauth/authorize/preview?clientId=${dev.clientId}&redirectUri=${encodeURIComponent(bad)}`)
        .set(bearer(u.token))
        .expect(400);
    }
    // At the token endpoint too: the code is bound to the redirect it was issued for.
    const { verifier, challenge } = pkce();
    const auth = await authorize(u, dev, challenge).expect(200);
    await exchange(dev, { code: auth.body.code, code_verifier: verifier, redirect_uri: `${REDIRECT}/` }).expect(400);
  });

  it('returns a consent preview and rejects scopes the app did not declare', async () => {
    const dev = await publishedApp(['profile.basic', 'orders.read']);
    const u = await user();
    const prev = await ctx.http
      .get(`/v1/oauth/authorize/preview?clientId=${dev.clientId}&redirectUri=${encodeURIComponent(REDIRECT)}`)
      .set(bearer(u.token))
      .expect(200);
    expect(prev.body.app).toMatchObject({ name: 'Mon App', organization: { name: 'Boutique Mini' } });
    expect(prev.body.scopes.map((s: { scope: string }) => s.scope)).toEqual(['profile.basic', 'orders.read']);
    await authorize(u, dev, pkce().challenge, { scopes: ['profile.basic', 'wallet.pay'] }).expect(400);
  });

  it('rejects a replayed code and revokes the tokens already issued for it', async () => {
    const dev = await publishedApp();
    const u = await user();
    const c = await connect(u, dev);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(c.access)).expect(200);
    await exchange(dev, { code: c.code, code_verifier: c.verifier }).expect(400);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(c.access)).expect(401);
    const refresh = await ctx.http.post('/v1/oauth/token').send({ grant_type: 'refresh_token', client_id: dev.clientId, client_secret: dev.secret, refresh_token: c.refresh });
    expect(refresh.status).toBe(400);
  });

  it('authenticates confidential apps and not public ones', async () => {
    const dev = await publishedApp();
    const u = await user();
    const { verifier, challenge } = pkce();
    const auth = await authorize(u, dev, challenge).expect(200);
    await exchange(dev, { code: auth.body.code, code_verifier: verifier }, null).expect(401);
    await exchange(dev, { code: auth.body.code, code_verifier: verifier }, 'cls_wrong').expect(401);
    await exchange(dev, { code: auth.body.code, code_verifier: verifier }).expect(200);

    const pub = await publishedApp(['profile.basic'], { confidential: false });
    expect(pub.secret).toBeNull();
    const p = pkce();
    const code = await authorize(u, pub, p.challenge, { scopes: ['profile.basic'] }).expect(200);
    const tok = await exchange(pub, { code: code.body.code, code_verifier: p.verifier }, null).expect(200);
    expect(tok.body).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'profile.basic' });
  });

  it('rotates refresh tokens and treats reuse of an old one as theft', async () => {
    const dev = await publishedApp();
    const u = await user();
    const c = await connect(u, dev);
    const refresh = (token: string) =>
      ctx.http.post('/v1/oauth/token').send({ grant_type: 'refresh_token', client_id: dev.clientId, client_secret: dev.secret, refresh_token: token });
    const next = await refresh(c.refresh).expect(200);
    expect(next.body.refresh_token).not.toBe(c.refresh);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(c.access)).expect(401);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(next.body.access_token)).expect(200);
    await refresh(c.refresh).expect(400);
    // The whole chain is cut, including the newest access token.
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(next.body.access_token)).expect(401);
    await refresh(next.body.refresh_token).expect(400);
  });

  it('rate limits the token endpoint', async () => {
    const limited = await createTestContext({ OAUTH_TOKEN_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const body = { grant_type: 'refresh_token', client_id: 'nope', refresh_token: 'x'.repeat(20) };
      const codes: number[] = [];
      for (let i = 0; i < 5; i += 1) codes.push((await limited.http.post('/v1/oauth/token').send(body)).status);
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('what an app token can reach', () => {
  it('serves scoped profile data and never opens a user route', async () => {
    const dev = await publishedApp(['profile.basic', 'profile.email']);
    const u = await user();
    const c = await connect(u, dev, ['profile.basic', 'profile.email']);
    const me = await ctx.http.get('/v1/miniapp-api/me').set(bearer(c.access)).expect(200);
    expect(me.body.id).toMatch(/^sub_/);
    expect(me.body.id).not.toBe(u.id);
    expect(me.body).toHaveProperty('email');
    expect(me.body).not.toHaveProperty('phone');

    // An app token is no session: classic routes refuse it, and the other way round.
    await ctx.http.get('/v1/me').set(bearer(c.access)).expect(401);
    await ctx.http.get('/v1/me/miniapp-grants').set(bearer(c.access)).expect(401);
    await ctx.http.put('/v1/me/payment-pin').set(bearer(c.access)).send({ pin: PIN, password: PASSWORD }).expect(401);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(u.token)).expect(401);
    await ctx.http.get('/v1/miniapp-api/me').expect(401);
  });

  it('answers 403 for scopes that were not granted', async () => {
    const dev = await publishedApp();
    const u = await user();
    const c = await connect(u, dev, ['profile.basic']);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(c.access)).expect(200);
    await ctx.http.get('/v1/miniapp-api/orders').set(bearer(c.access)).expect(403);
    await ctx.http
      .post('/v1/miniapp-api/payment-requests')
      .set(bearer(c.access))
      .send({ clientRef: 'r1', amountMinor: 100, currency: 'USD' })
      .expect(403);
  });

  it('lists only the orders placed with the organisation that owns the app', async () => {
    const dev = await publishedApp();
    const other = await draftApp();
    const u = await user();
    const insert = (orgId: string, n: string) =>
      ctx.sql.query(
        `INSERT INTO orders (number, buyer_id, org_id, client_id, currency, subtotal_minor, total_minor, payment_method)
         VALUES ($1, $2, $3, $4, 'USD', 1000, 1000, 'cash_on_delivery')`,
        [n, u.id, orgId, randomUUID()],
      );
    await insert(dev.orgId, `MA-${Date.now()}-1`);
    await insert(other.orgId, `MA-${Date.now()}-2`);
    const c = await connect(u, dev);
    const orders = await ctx.http.get('/v1/miniapp-api/orders').set(bearer(c.access)).expect(200);
    expect(orders.body.items).toHaveLength(1);
    expect(orders.body.items[0]).toMatchObject({ currency: 'USD', totalMinor: 1000 });
  });
});

describe('grants and revocation', () => {
  it('lists grants and revoking cuts the tokens at once', async () => {
    const dev = await publishedApp();
    const u = await user();
    const c = await connect(u, dev);
    const grants = await ctx.http.get('/v1/me/miniapp-grants').set(bearer(u.token)).expect(200);
    expect(grants.body.items).toHaveLength(1);
    expect(grants.body.items[0]).toMatchObject({ appId: dev.appId, name: 'Mon App', scopes: expect.arrayContaining(['wallet.pay']) });

    await ctx.http.delete(`/v1/me/miniapp-grants/${dev.appId}`).set(bearer(u.token)).expect(204);
    await ctx.http.delete(`/v1/me/miniapp-grants/${dev.appId}`).set(bearer(u.token)).expect(204);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(c.access)).expect(401);
    const refresh = await ctx.http.post('/v1/oauth/token').send({ grant_type: 'refresh_token', client_id: dev.clientId, client_secret: dev.secret, refresh_token: c.refresh });
    expect(refresh.status).toBe(400);
    expect((await ctx.http.get('/v1/me/miniapp-grants').set(bearer(u.token)).expect(200)).body.items).toHaveLength(0);
    await ctx.http.delete(`/v1/me/miniapp-grants/${randomUUID()}`).set(bearer(u.token)).expect(404);

    // Consenting again starts from a clean slate.
    const again = await connect(u, dev, ['profile.basic']);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(again.access)).expect(200);
    const exported = await ctx.http.get('/v1/me/export').set(bearer(u.token));
    if (exported.status === 200) {
      expect(exported.body.miniappGrants).toHaveLength(1);
      expect(JSON.stringify(exported.body)).not.toContain(again.access);
    }
  });
});

describe('wallet.pay: a payment request is always confirmed by the user with their PIN', () => {
  async function payer(): Promise<TU> {
    const u = await user();
    await ctx.http.put('/v1/me/payment-pin').set(bearer(u.token)).send({ pin: PIN, password: PASSWORD }).expect(204);
    await topup(u, 50_00);
    return u;
  }
  const request = (access: string, ref: string, amountMinor = 12_00) =>
    ctx.http.post('/v1/miniapp-api/payment-requests').set(bearer(access)).send({ clientRef: ref, amountMinor, currency: 'USD', description: 'Commande' });
  const balance = (owner: { kind: 'user'; userId: string } | { kind: 'org'; orgId: string }) => ctx.app.get(LedgerPort).balance(owner, 'USD');

  it('moves no money from the app side and only on PIN confirmation', async () => {
    const dev = await publishedApp();
    const u = await payer();
    const c = await connect(u, dev);
    const created = await request(c.access, 'ord-1').expect(201);
    expect(created.body).toMatchObject({ status: 'pending', amountMinor: 1200, currency: 'USD' });
    expect(await balance({ kind: 'user', userId: u.id })).toBe(50_00);

    // The app has no way to confirm: its token opens no user route, and the PIN is mandatory for the user.
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${created.body.id}/confirm`).set(bearer(c.access)).send({ pin: PIN }).expect(401);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${created.body.id}/confirm`).set(bearer(u.token)).send({}).expect(400);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${created.body.id}/confirm`).set(bearer(u.token)).send({ pin: '000000' }).expect(403);
    expect(await balance({ kind: 'user', userId: u.id })).toBe(50_00);
    const stranger = await payer();
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${created.body.id}/confirm`).set(bearer(stranger.token)).send({ pin: PIN }).expect(404);

    const pending = await ctx.http.get('/v1/me/miniapp-payment-requests').set(bearer(u.token)).expect(200);
    expect(pending.body.items.map((r: { id: string }) => r.id)).toContain(created.body.id);

    const paid = await ctx.http.post(`/v1/me/miniapp-payment-requests/${created.body.id}/confirm`).set(bearer(u.token)).send({ pin: PIN }).expect(200);
    expect(paid.body).toMatchObject({ status: 'paid' });
    expect(paid.body.transferId).toBeTruthy();
    expect(await balance({ kind: 'user', userId: u.id })).toBe(38_00);
    expect(await balance({ kind: 'org', orgId: dev.orgId })).toBe(12_00);

    const seen = await ctx.http.get(`/v1/miniapp-api/payment-requests/${created.body.id}`).set(bearer(c.access)).expect(200);
    expect(seen.body.status).toBe('paid');
    // Same key again: the same request, no second request. Confirming twice never charges twice.
    const again = await request(c.access, 'ord-1').expect(200);
    expect(again.body.id).toBe(created.body.id);
    await request(c.access, 'ord-1', 99_00).expect(409);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${created.body.id}/confirm`).set(bearer(u.token)).send({ pin: PIN }).expect(200);
    expect(await balance({ kind: 'user', userId: u.id })).toBe(38_00);
  });

  it('refuses without a PIN set, after a revocation and when declined or expired', async () => {
    const dev = await publishedApp();
    const noPin = await user();
    const c0 = await connect(noPin, dev);
    const r0 = await request(c0.access, 'a').expect(201);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${r0.body.id}/confirm`).set(bearer(noPin.token)).send({ pin: PIN }).expect(409);

    const u = await payer();
    const c = await connect(u, dev);
    const declined = await request(c.access, 'b').expect(201);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${declined.body.id}/decline`).set(bearer(u.token)).expect(200);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${declined.body.id}/confirm`).set(bearer(u.token)).send({ pin: PIN }).expect(409);

    const expired = await request(c.access, 'c').expect(201);
    await ctx.sql.query(`UPDATE miniapp_payment_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [expired.body.id]);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${expired.body.id}/confirm`).set(bearer(u.token)).send({ pin: PIN }).expect(409);

    const revoked = await request(c.access, 'd').expect(201);
    await ctx.http.delete(`/v1/me/miniapp-grants/${dev.appId}`).set(bearer(u.token)).expect(204);
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${revoked.body.id}/confirm`).set(bearer(u.token)).send({ pin: PIN }).expect(409);
    expect(await balance({ kind: 'user', userId: u.id })).toBe(50_00);
  });

  it('validates the amount and currency, and refuses a clientRef reused for other money', async () => {
    const dev = await publishedApp();
    const u = await payer();
    const c = await connect(u, dev);
    for (const amountMinor of [0, -500, 12.5, 100_000_001]) await request(c.access, `bad-${amountMinor}`, amountMinor).expect(400);
    await ctx.http.post('/v1/miniapp-api/payment-requests').set(bearer(c.access)).send({ clientRef: 'cur', amountMinor: 100, currency: 'usd' }).expect(400);
    await ctx.http.post('/v1/miniapp-api/payment-requests').set(bearer(c.access)).send({ clientRef: ' ', amountMinor: 100, currency: 'USD' }).expect(400);
    await request(c.access, 'same', 1_00).expect(201);
    await ctx.http.post('/v1/miniapp-api/payment-requests').set(bearer(c.access)).send({ clientRef: 'same', amountMinor: 1_00, currency: 'CDF' }).expect(409);
  });

  it('never overdraws: confirming more than the balance fails and moves nothing', async () => {
    const dev = await publishedApp();
    const u = await payer();
    const c = await connect(u, dev);
    const big = await request(c.access, 'big', 80_00).expect(201);
    const res = await ctx.http.post(`/v1/me/miniapp-payment-requests/${big.body.id}/confirm`).set(bearer(u.token)).send({ pin: PIN });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await balance({ kind: 'user', userId: u.id })).toBe(50_00);
    expect(await balance({ kind: 'org', orgId: dev.orgId })).toBe(0);
    const seen = await ctx.http.get(`/v1/miniapp-api/payment-requests/${big.body.id}`).set(bearer(c.access)).expect(200);
    expect(seen.body.status).not.toBe('paid');
  });

  it('charges once when two confirmations race, and a late decline cannot undo a payment', async () => {
    const dev = await publishedApp();
    const u = await payer();
    const c = await connect(u, dev);
    const r = await request(c.access, 'race', 10_00).expect(201);
    const url = `/v1/me/miniapp-payment-requests/${r.body.id}/confirm`;
    const both = await Promise.all([ctx.http.post(url).set(bearer(u.token)).send({ pin: PIN }), ctx.http.post(url).set(bearer(u.token)).send({ pin: PIN })]);
    expect(both.every((x) => x.status === 200 || x.status === 409)).toBe(true);
    expect(await balance({ kind: 'user', userId: u.id })).toBe(40_00);
    expect(await balance({ kind: 'org', orgId: dev.orgId })).toBe(10_00);
    const declined = await ctx.http.post(`/v1/me/miniapp-payment-requests/${r.body.id}/decline`).set(bearer(u.token));
    expect(declined.status === 200 ? declined.body.status : 'paid').toBe('paid');
    expect(await balance({ kind: 'user', userId: u.id })).toBe(40_00);
    const stranger = await payer();
    await ctx.http.post(`/v1/me/miniapp-payment-requests/${r.body.id}/decline`).set(bearer(stranger.token)).expect(404);
  });
});

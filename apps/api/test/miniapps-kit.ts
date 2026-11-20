import { createHash, randomBytes } from 'node:crypto';
import { MINIAPP_API_ENDPOINTS, MINIAPP_EVENTS } from '@caselind/contracts';
import { bearer, signUp, type TestContext } from './helpers.js';

export interface TU {
  token: string;
  id: string;
}

export interface Dev {
  owner: TU;
  orgId: string;
  appId: string;
  clientId: string;
  secret: string;
}

export const REDIRECT = 'https://app.example.test/callback';
export const ALL_SCOPES = ['profile.basic', 'profile.phone', 'profile.email', 'orders.read', 'wallet.pay', 'notify'];

/** A complete, valid manifest for `scopes` (every scope described, every catalogued endpoint declared, every allowed event subscribed). */
export function manifestFor(scopes: string[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dataAccessed: scopes.map((scope) => ({ scope, purpose: `Usage de ${scope} pour le service`, retention: '30 jours' })),
    endpoints: MINIAPP_API_ENDPOINTS.filter((e) => scopes.includes(e.scope)).map((e) => ({ method: e.method, path: e.path })),
    events: MINIAPP_EVENTS.filter((e) => !e.startsWith('payment.') || scopes.includes('wallet.pay')),
    costs: { model: 'free', description: 'Gratuit', maxAmountMinor: null, currency: null },
    termsUrl: 'https://app.example.test/terms',
    privacyUrl: 'https://app.example.test/privacy',
    supportEmail: 'support@app.example.test',
    dataLocation: 'Union européenne',
    ...over,
  };
}

/** Shared fixtures of the mini-app e2e files (a context getter, because the context is created in beforeAll). */
export function miniappKit(getCtx: () => TestContext) {
  let slug = 0;
  let admin: TU | undefined;

  async function user(roles?: string[]): Promise<TU> {
    const ctx = getCtx();
    const s = await signUp(ctx);
    const me = await ctx.http.get('/v1/me').set(bearer(s.tokens.accessToken)).expect(200);
    if (roles) await ctx.sql.query(`UPDATE users SET roles = $1::text[] WHERE id = $2`, [roles, me.body.id]);
    return { token: s.tokens.accessToken, id: me.body.id };
  }

  const pkce = () => {
    const verifier = randomBytes(48).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  };

  async function org(owner: TU): Promise<string> {
    slug += 1;
    const res = await getCtx()
      .http.post('/v1/orgs')
      .set(bearer(owner.token))
      .send({ slug: `dev-${Date.now().toString(36)}-${slug}`, name: 'Boutique Dev', kind: 'shop' })
      .expect(201);
    return res.body.id as string;
  }

  async function adminUser(): Promise<TU> {
    admin ??= await user(['user', 'admin']);
    return admin;
  }

  async function publishedApp(scopes = ALL_SCOPES, manifest: Record<string, unknown> = manifestFor(scopes)): Promise<Dev> {
    const ctx = getCtx();
    const owner = await user();
    const orgId = await org(owner);
    const res = await ctx.http
      .post(`/v1/orgs/${orgId}/miniapps`)
      .set(bearer(owner.token))
      .send({ name: 'Mon App', description: 'Une app', launchUrl: 'https://app.example.test/', redirectUris: [REDIRECT], scopes, manifest })
      .expect(201);
    const dev: Dev = { owner, orgId, appId: res.body.id, clientId: res.body.clientId, secret: res.body.clientSecret };
    const mod = await adminUser();
    await ctx.http.post(`/v1/orgs/${orgId}/miniapps/${dev.appId}/submit`).set(bearer(owner.token)).expect(200);
    await ctx.http.post(`/v1/admin/miniapps/${dev.appId}/review`).set(bearer(mod.token)).send({ decision: 'approve' }).expect(200);
    return dev;
  }

  /** Full consent + code exchange: the app's tokens for `who`. */
  async function connect(who: TU, dev: Dev, scopes = ALL_SCOPES) {
    const ctx = getCtx();
    const { verifier, challenge } = pkce();
    const auth = await ctx.http
      .post('/v1/oauth/authorize')
      .set(bearer(who.token))
      .send({ clientId: dev.clientId, redirectUri: REDIRECT, scopes, state: 'state-12345678', codeChallenge: challenge })
      .expect(200);
    const tok = await ctx.http
      .post('/v1/oauth/token')
      .send({ grant_type: 'authorization_code', client_id: dev.clientId, client_secret: dev.secret, redirect_uri: REDIRECT, code: auth.body.code, code_verifier: verifier })
      .expect(200);
    return { access: tok.body.access_token as string, refresh: tok.body.refresh_token as string };
  }

  return { user, org, adminUser, publishedApp, connect };
}

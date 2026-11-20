import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AuthorizePreview,
  type AuthorizePreviewQuery,
  type AuthorizeRequest,
  type AuthorizeResponse,
  type ExportedMiniAppGrant,
  MINIAPP_SCOPES,
  type MiniAppGrantList,
  type MiniAppScope,
  SCOPE_DESCRIPTIONS,
  type TokenRequest,
  type TokenResponse,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { MiniAppUsageService } from './miniapp-usage.service.js';
import { MiniAppWebhookService } from './miniapp-webhook.service.js';
import {
  ACCESS_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  APP_COLUMNS,
  type AppRow,
  appNotFound,
  AUTH_CODE_TTL_SECONDS,
  certificationOf,
  invalidClient,
  iconUrlOf,
  iso,
  oauthError,
  randomToken,
  REFRESH_PREFIX,
  REFRESH_TOKEN_TTL_MS,
  safeEqual,
  sha256,
  textArray,
} from './miniapps.shared.js';

type Executor = Pick<Db, 'execute'>;
type PublishedApp = AppRow & { org_name: string; org_verification: string };

const isScope = (s: string): s is MiniAppScope => (MINIAPP_SCOPES as readonly string[]).includes(s);

/** OAuth 2.0 authorization code + PKCE (S256 only) for mini-apps, and the user's grants. See ADR-021. */
@Injectable()
export class OAuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly usage: MiniAppUsageService,
    private readonly hooks: MiniAppWebhookService,
  ) {}

  /** A published app of an active organisation by `client_id`; anything else is invisible (404). */
  private async publishedApp(tx: Executor, clientId: string): Promise<PublishedApp> {
    const res = await tx.execute<PublishedApp>(sql`
      SELECT ${sql.raw(APP_COLUMNS.split(', ').map((c) => `a.${c}`).join(', '))}, o.name AS org_name, o.verification_status AS org_verification
      FROM miniapps a JOIN organizations o ON o.id = a.org_id
      WHERE a.client_id = ${clientId} AND a.status = 'published' AND o.status = 'active'`);
    const row = res.rows[0];
    if (!row) throw appNotFound();
    return row;
  }

  /** Exact string match against the registered redirect URIs: no prefix, no normalisation, no wildcard. */
  private checkRedirect(app: AppRow, redirectUri: string): void {
    if (!app.redirect_uris.includes(redirectUri)) throw oauthError('invalid_redirect_uri', 'redirect_uri does not match a registered redirection');
  }

  private checkScopes(app: AppRow, scopes: string[]): MiniAppScope[] {
    const unique = [...new Set(scopes)];
    if (unique.length === 0 || !unique.every((s) => isScope(s) && app.scopes.includes(s))) {
      throw oauthError('invalid_scope', 'a requested scope is unknown or not declared by the application');
    }
    return unique as MiniAppScope[];
  }

  // ---- consent screen -----------------------------------------------------------------------------

  async preview(userId: string, q: AuthorizePreviewQuery): Promise<AuthorizePreview> {
    const app = await this.publishedApp(this.db, q.clientId);
    this.checkRedirect(app, q.redirectUri);
    const requested = q.scopes?.trim() ? q.scopes.trim().split(/\s+/) : app.scopes;
    const scopes = this.checkScopes(app, requested);
    const grant = await this.db.execute<{ scopes: string[]; reconsent_required: boolean }>(sql`
      SELECT scopes, reconsent_required FROM miniapp_grants WHERE user_id = ${userId}::uuid AND app_id = ${app.id}::uuid AND revoked_at IS NULL`);
    const granted = new Set(grant.rows[0]?.scopes ?? []);
    return {
      app: {
        id: app.id,
        name: app.name,
        description: app.description,
        iconUrl: iconUrlOf(app.icon_media_id),
        launchUrl: app.launch_url,
        organization: { id: app.org_id, name: app.org_name, verified: app.org_verification === 'verified' },
      },
      scopes: scopes.map((scope) => ({ scope, description: SCOPE_DESCRIPTIONS[scope], alreadyGranted: granted.has(scope) })),
      certification: certificationOf(app),
      manifest: app.manifest ?? null,
      reconsentRequired: grant.rows[0]?.reconsent_required ?? false,
    };
  }

  /** The user consented: record the grant and hand out a 60 s single-use code bound to user, app, redirection and challenge. */
  async authorize(userId: string, body: AuthorizeRequest, meta: RequestMeta): Promise<AuthorizeResponse> {
    const app = await this.publishedApp(this.db, body.clientId);
    this.checkRedirect(app, body.redirectUri);
    const scopes = this.checkScopes(app, body.scopes);
    const code = randomToken('clc_');
    await this.db.transaction(async (tx) => {
      // A grant that was revoked starts over with the scopes of this consent only; a live one is extended.
      await tx.execute(sql`
        INSERT INTO miniapp_grants (user_id, app_id, scopes) VALUES (${userId}::uuid, ${app.id}::uuid, ${textArray(scopes)})
        ON CONFLICT (user_id, app_id) DO UPDATE SET
          scopes = CASE WHEN miniapp_grants.revoked_at IS NULL
                        THEN ARRAY(SELECT DISTINCT unnest(miniapp_grants.scopes || EXCLUDED.scopes)) ELSE EXCLUDED.scopes END,
          revoked_at = NULL, updated_at = now(),
          created_at = CASE WHEN miniapp_grants.revoked_at IS NULL THEN miniapp_grants.created_at ELSE now() END`);
      await tx.execute(sql`
        INSERT INTO miniapp_auth_codes (code_hash, app_id, user_id, redirect_uri, scopes, code_challenge, expires_at)
        VALUES (${sha256(code)}, ${app.id}::uuid, ${userId}::uuid, ${body.redirectUri}, ${textArray(scopes)}, ${body.codeChallenge},
                now() + make_interval(secs => ${AUTH_CODE_TTL_SECONDS}))`);
      // A consent that now covers every scope the app declares ends a pending re-consent request.
      await tx.execute(sql`UPDATE miniapp_grants SET reconsent_required = NOT (${textArray(app.scopes)} <@ scopes) WHERE user_id = ${userId}::uuid AND app_id = ${app.id}::uuid`);
      await this.usage.bump(app.id, 'authorizations', tx);
      await this.audit.record({ action: 'miniapp.authorized', actorUserId: userId, meta, metadata: { appId: app.id, scopes } }, tx);
    });
    this.hooks.emit(app.id, userId, 'authorization.granted', { scopes });
    const target = new URL(body.redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', body.state);
    return { code, state: body.state, redirectTo: target.toString(), expiresIn: AUTH_CODE_TTL_SECONDS };
  }

  // ---- token endpoint -----------------------------------------------------------------------------

  /** Confidential apps must present their secret; public ones rely on PKCE alone. Unknown or unpublished: invalid_client. */
  private async authenticateClient(clientId: string, secret: string | undefined): Promise<AppRow> {
    const res = await this.db.execute<AppRow>(sql`
      SELECT ${sql.raw(APP_COLUMNS.split(', ').map((c) => `a.${c}`).join(', '))} FROM miniapps a JOIN organizations o ON o.id = a.org_id
      WHERE a.client_id = ${clientId} AND a.status = 'published' AND o.status = 'active'`);
    const app = res.rows[0];
    if (!app) throw invalidClient();
    if (app.confidential) {
      if (!secret || !app.client_secret_hash || !safeEqual(sha256(secret), app.client_secret_hash)) throw invalidClient();
    }
    return app;
  }

  async token(body: TokenRequest, meta: RequestMeta): Promise<TokenResponse> {
    const app = await this.authenticateClient(body.client_id, body.client_secret);
    return body.grant_type === 'authorization_code' ? this.exchangeCode(app, body, meta) : this.rotateRefresh(app, body.refresh_token, meta);
  }

  private async exchangeCode(app: AppRow, body: Extract<TokenRequest, { grant_type: 'authorization_code' }>, meta: RequestMeta): Promise<TokenResponse> {
    const found = await this.db.execute<{ id: string; user_id: string; redirect_uri: string; scopes: string[]; code_challenge: string; used: boolean; expired: boolean }>(sql`
      SELECT id, user_id, redirect_uri, scopes, code_challenge, used_at IS NOT NULL AS used, expires_at <= now() AS expired
      FROM miniapp_auth_codes WHERE code_hash = ${sha256(body.code)} AND app_id = ${app.id}::uuid`);
    const code = found.rows[0];
    if (!code) throw oauthError('invalid_grant', 'invalid authorization code');
    if (code.used) return this.replayed(app, code.id, meta);

    // Single use, atomically: of two concurrent exchanges only one gets the row. The code is burnt even if the checks
    // below fail, so a stolen code cannot be used to guess verifiers.
    const taken = await this.db.execute(sql`UPDATE miniapp_auth_codes SET used_at = now() WHERE id = ${code.id}::uuid AND used_at IS NULL RETURNING id`);
    if (taken.rows.length === 0) return this.replayed(app, code.id, meta);

    const challenge = createHash('sha256').update(body.code_verifier).digest('base64url');
    if (code.expired || body.redirect_uri !== code.redirect_uri || !safeEqual(challenge, code.code_challenge)) {
      throw oauthError('invalid_grant', 'invalid authorization code');
    }
    return this.db.transaction(async (tx) => {
      const live = await tx.execute<{ scopes: string[] }>(sql`
        SELECT g.scopes FROM miniapp_grants g JOIN users u ON u.id = g.user_id
        WHERE g.user_id = ${code.user_id}::uuid AND g.app_id = ${app.id}::uuid AND g.revoked_at IS NULL AND u.status = 'active'`);
      if (live.rows.length === 0) throw oauthError('invalid_grant', 'the authorization was revoked');
      return this.issue(tx, { familyId: code.id, appId: app.id, userId: code.user_id, scopes: code.scopes });
    });
  }

  /** A code presented twice: refuse, and cut every token that came out of the first exchange. */
  private async replayed(app: AppRow, codeId: string, meta: RequestMeta): Promise<never> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE miniapp_tokens SET revoked_at = now() WHERE family_id = ${codeId}::uuid AND revoked_at IS NULL`);
      await this.audit.record({ action: 'miniapp.token_replay', meta, metadata: { appId: app.id, kind: 'authorization_code' } }, tx);
    });
    throw oauthError('invalid_grant', 'invalid authorization code');
  }

  private async rotateRefresh(app: AppRow, refreshToken: string, meta: RequestMeta): Promise<TokenResponse> {
    const found = await this.db.execute<{ id: string; family_id: string; user_id: string; scopes: string[]; used: boolean; revoked: boolean; expired: boolean }>(sql`
      SELECT id, family_id, user_id, scopes, refresh_used_at IS NOT NULL AS used, revoked_at IS NOT NULL AS revoked, refresh_expires_at <= now() AS expired
      FROM miniapp_tokens WHERE refresh_hash = ${sha256(refreshToken)} AND app_id = ${app.id}::uuid`);
    const cur = found.rows[0];
    if (!cur) throw oauthError('invalid_grant', 'invalid refresh token');
    if (cur.used) {
      // Reuse of a rotated refresh token: the chain is compromised, so all of it goes.
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE miniapp_tokens SET revoked_at = now() WHERE family_id = ${cur.family_id}::uuid AND revoked_at IS NULL`);
        await this.audit.record({ action: 'miniapp.token_replay', meta, metadata: { appId: app.id, kind: 'refresh_token' } }, tx);
      });
      throw oauthError('invalid_grant', 'invalid refresh token');
    }
    if (cur.revoked || cur.expired) throw oauthError('invalid_grant', 'invalid refresh token');

    return this.db.transaction(async (tx) => {
      const taken = await tx.execute(sql`
        UPDATE miniapp_tokens SET refresh_used_at = now(), revoked_at = now()
        WHERE id = ${cur.id}::uuid AND refresh_used_at IS NULL AND revoked_at IS NULL RETURNING id`);
      if (taken.rows.length === 0) throw oauthError('invalid_grant', 'invalid refresh token');
      const live = await tx.execute<{ scopes: string[] }>(sql`
        SELECT g.scopes FROM miniapp_grants g JOIN users u ON u.id = g.user_id
        WHERE g.user_id = ${cur.user_id}::uuid AND g.app_id = ${app.id}::uuid AND g.revoked_at IS NULL AND u.status = 'active'`);
      const grant = live.rows[0];
      if (!grant) throw oauthError('invalid_grant', 'the authorization was revoked');
      const scopes = cur.scopes.filter((s) => grant.scopes.includes(s));
      return this.issue(tx, { familyId: cur.family_id, appId: app.id, userId: cur.user_id, scopes });
    });
  }

  private async issue(tx: Executor, t: { familyId: string; appId: string; userId: string; scopes: string[] }): Promise<TokenResponse> {
    const access = randomToken(ACCESS_PREFIX);
    const refresh = randomToken(REFRESH_PREFIX);
    await tx.execute(sql`
      INSERT INTO miniapp_tokens (family_id, app_id, user_id, scopes, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
      VALUES (${t.familyId}::uuid, ${t.appId}::uuid, ${t.userId}::uuid, ${textArray(t.scopes)}, ${sha256(access)},
              now() + make_interval(secs => ${ACCESS_TOKEN_TTL_SECONDS}), ${sha256(refresh)}, ${new Date(Date.now() + REFRESH_TOKEN_TTL_MS)})`);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refresh, scope: t.scopes.join(' ') };
  }

  // ---- the user's authorizations ------------------------------------------------------------------

  async listGrants(userId: string): Promise<MiniAppGrantList> {
    const res = await this.db.execute<{ app_id: string; name: string; icon_media_id: string | null; org_name: string; scopes: string[]; created_at: string | Date; reconsent_required: boolean; notifications_muted: boolean }>(sql`
      SELECT g.app_id, a.name, a.icon_media_id, o.name AS org_name, g.scopes, g.created_at, g.reconsent_required, g.notifications_muted
      FROM miniapp_grants g JOIN miniapps a ON a.id = g.app_id JOIN organizations o ON o.id = a.org_id
      WHERE g.user_id = ${userId}::uuid AND g.revoked_at IS NULL ORDER BY g.updated_at DESC, g.app_id`);
    return {
      items: res.rows.map((r) => ({
        appId: r.app_id,
        name: r.name,
        iconUrl: iconUrlOf(r.icon_media_id),
        organizationName: r.org_name,
        scopes: r.scopes as MiniAppScope[],
        grantedAt: iso(r.created_at),
        reconsentRequired: r.reconsent_required,
        notificationsMuted: r.notifications_muted,
      })),
    };
  }

  /** Cuts every token of the app for this user at once. Idempotent; an app the user never authorized is a 404. */
  async revokeGrant(userId: string, appId: string, meta: RequestMeta): Promise<void> {
    let revoked = false;
    await this.db.transaction(async (tx) => {
      const grant = await tx.execute<{ revoked_at: string | Date | null }>(sql`
        SELECT revoked_at FROM miniapp_grants WHERE user_id = ${userId}::uuid AND app_id = ${appId}::uuid FOR UPDATE`);
      if (grant.rows.length === 0) throw AppError.notFound('Authorization not found');
      if (grant.rows[0]!.revoked_at) return;
      await tx.execute(sql`UPDATE miniapp_grants SET revoked_at = now(), updated_at = now() WHERE user_id = ${userId}::uuid AND app_id = ${appId}::uuid`);
      await tx.execute(sql`UPDATE miniapp_tokens SET revoked_at = now() WHERE user_id = ${userId}::uuid AND app_id = ${appId}::uuid AND revoked_at IS NULL`);
      await tx.execute(sql`
        UPDATE miniapp_payment_requests SET status = 'cancelled', decided_at = now()
        WHERE user_id = ${userId}::uuid AND app_id = ${appId}::uuid AND status = 'pending'`);
      await this.audit.record({ action: 'miniapp.grant_revoked', actorUserId: userId, meta, metadata: { appId } }, tx);
      revoked = true;
    });
    // The app must purge what it holds about this user: tell it (opaque subject only).
    if (revoked) this.hooks.emit(appId, userId, 'authorization.revoked', { reason: 'user_revoked' });
  }

  /** The user silences (or re-enables) the notifications of one app without withdrawing its access. */
  async setMuted(userId: string, appId: string, muted: boolean, meta: RequestMeta): Promise<void> {
    const res = await this.db.execute(sql`UPDATE miniapp_grants SET notifications_muted = ${muted} WHERE user_id = ${userId}::uuid AND app_id = ${appId}::uuid AND revoked_at IS NULL RETURNING app_id`);
    if (res.rows.length === 0) throw AppError.notFound('Authorization not found');
    await this.audit.record({ action: 'miniapp.notifications_muted', actorUserId: userId, meta, metadata: { appId, muted } });
  }

  // ---- export and purge ---------------------------------------------------------------------------

  /** Grants including revoked ones; never a token. */
  async exportGrants(userId: string): Promise<ExportedMiniAppGrant[]> {
    const res = await this.db.execute<{ app_id: string; name: string; scopes: string[]; created_at: string | Date; revoked_at: string | Date | null; notifications_muted: boolean }>(sql`
      SELECT g.app_id, a.name, g.scopes, g.created_at, g.revoked_at, g.notifications_muted FROM miniapp_grants g JOIN miniapps a ON a.id = g.app_id
      WHERE g.user_id = ${userId}::uuid ORDER BY g.created_at, g.app_id`);
    return res.rows.map((r) => ({
      appId: r.app_id,
      appName: r.name,
      scopes: r.scopes,
      grantedAt: iso(r.created_at),
      revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
      notificationsMuted: r.notifications_muted,
    }));
  }
}

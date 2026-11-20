import { applyDecorators, type CanActivate, createParamDecorator, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { endpointKey, type MiniAppScope, readManifest } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import type { Response } from 'express';
import { ErrorCodes } from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { MiniAppUsageService } from './miniapp-usage.service.js';
import { ACCESS_PREFIX, sha256 } from './miniapps.shared.js';

/** Who is calling with an app token: the app, its owning organisation, the user who authorized it, and the scopes still alive. */
export interface MiniAppPrincipal {
  appId: string;
  orgId: string;
  userId: string;
  scopes: MiniAppScope[];
}

declare module 'express' {
  interface Request {
    miniapp?: MiniAppPrincipal;
  }
}

const REQUIRED_SCOPE = 'caselind:miniappScope';
const ENDPOINT = 'caselind:miniappEndpoint';

/**
 * The route needs this scope in the app token (403 otherwise) and is the catalogued endpoint `method` + `path` (path template as
 * in the manifest, e.g. `/v1/miniapp-api/payment-requests/{id}`): the approved manifest of the app must declare it.
 */
export const RequireMiniAppScope = (scope: MiniAppScope, method: 'GET' | 'POST', path: string) =>
  applyDecorators(SetMetadata(REQUIRED_SCOPE, scope), SetMetadata(ENDPOINT, endpointKey(method, path)));

export const CurrentMiniApp = createParamDecorator((_: unknown, ctx: ExecutionContext): MiniAppPrincipal => {
  const p = ctx.switchToHttp().getRequest<Request>().miniapp;
  if (!p) throw AppError.unauthenticated();
  return p;
});

/**
 * Guard of the `miniapp-api` routes, which are @Public() for the session AuthGuard (an app token is not a session and
 * `SessionVerifier` refuses it). Every call re-reads the database: a revoked grant, a revoked token, a suspended app or
 * organisation and a deactivated user cut access immediately. Scopes are those of the token that still stand in the grant.
 */
@Injectable()
export class MiniAppTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
    private readonly usage: MiniAppUsageService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return false;
    const req = ctx.switchToHttp().getRequest<Request>();
    // Bearer-only API: never cached, never a cookie.
    ctx.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token || !token.startsWith(ACCESS_PREFIX)) throw AppError.unauthenticated();

    const res = await this.db.execute<{ app_id: string; org_id: string; user_id: string; token_scopes: string[]; grant_scopes: string[]; app_scopes: string[]; rate_limit_per_minute: number | null; manifest: unknown }>(sql`
      SELECT t.app_id, a.org_id, t.user_id, t.scopes AS token_scopes, g.scopes AS grant_scopes, a.scopes AS app_scopes, a.rate_limit_per_minute, a.manifest
      FROM miniapp_tokens t
      JOIN miniapps a ON a.id = t.app_id AND a.status = 'published'
      JOIN organizations o ON o.id = a.org_id AND o.status = 'active'
      JOIN miniapp_grants g ON g.user_id = t.user_id AND g.app_id = t.app_id AND g.revoked_at IS NULL
      JOIN users u ON u.id = t.user_id AND u.status = 'active'
      WHERE t.access_hash = ${sha256(token)} AND t.revoked_at IS NULL AND t.access_expires_at > now()`);
    const row = res.rows[0];
    if (!row) throw AppError.unauthenticated('Invalid, expired or revoked token');

    // Quota per application (OAuth client), before anything is served; a refused call is counted as an error, not as a call.
    const verdict = this.usage.checkRate(row.app_id, row.rate_limit_per_minute);
    if (!verdict.ok) {
      ctx.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(verdict.retryAfterSeconds));
      await this.usage.bumpQuietly(row.app_id, 'errors');
      throw new AppError(429, ErrorCodes.rateLimited, 'Application rate limit exceeded', { retryAfterSeconds: verdict.retryAfterSeconds });
    }

    // Scopes the user consented to, still declared by the approved version of the app, and carried by this token.
    const scopes = row.token_scopes.filter((s) => row.grant_scopes.includes(s) && row.app_scopes.includes(s)) as MiniAppScope[];
    const required = this.reflector.getAllAndOverride<MiniAppScope | undefined>(REQUIRED_SCOPE, [ctx.getHandler(), ctx.getClass()]);
    if (required && !scopes.includes(required)) {
      await this.usage.bumpQuietly(row.app_id, 'errors');
      throw AppError.forbidden('The token does not carry the required scope');
    }
    // The approved manifest is the contract: what it does not declare (endpoint, scope) is refused and counted as an error.
    if (required) {
      const endpoint = this.reflector.getAllAndOverride<string | undefined>(ENDPOINT, [ctx.getHandler(), ctx.getClass()]);
      const manifest = readManifest(row.manifest);
      const declared = !!manifest && !!endpoint && manifest.dataAccessed.some((d) => d.scope === required) && manifest.endpoints.some((e) => endpointKey(e.method, e.path) === endpoint);
      if (!declared) {
        await this.usage.bumpQuietly(row.app_id, 'errors');
        throw new AppError(403, ErrorCodes.forbidden, 'The approved manifest of the application does not declare this endpoint or scope', { reason: 'not_declared', endpoint: endpoint ?? null });
      }
    }
    // Every read or action by an app is journaled for the user (scope, resource, date; never the content) and counted.
    if (required) await this.usage.recordAccess(row.app_id, row.user_id, required);
    req.miniapp = { appId: row.app_id, orgId: row.org_id, userId: row.user_id, scopes };
    return true;
  }
}

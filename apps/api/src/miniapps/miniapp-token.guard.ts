import { type CanActivate, createParamDecorator, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MiniAppScope } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
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

/** The route needs this scope in the app token (403 otherwise). */
export const RequireMiniAppScope = (scope: MiniAppScope) => SetMetadata(REQUIRED_SCOPE, scope);

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
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return false;
    const req = ctx.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token || !token.startsWith(ACCESS_PREFIX)) throw AppError.unauthenticated();

    const res = await this.db.execute<{ app_id: string; org_id: string; user_id: string; token_scopes: string[]; grant_scopes: string[] }>(sql`
      SELECT t.app_id, a.org_id, t.user_id, t.scopes AS token_scopes, g.scopes AS grant_scopes
      FROM miniapp_tokens t
      JOIN miniapps a ON a.id = t.app_id AND a.status = 'published'
      JOIN organizations o ON o.id = a.org_id AND o.status = 'active'
      JOIN miniapp_grants g ON g.user_id = t.user_id AND g.app_id = t.app_id AND g.revoked_at IS NULL
      JOIN users u ON u.id = t.user_id AND u.status = 'active'
      WHERE t.access_hash = ${sha256(token)} AND t.revoked_at IS NULL AND t.access_expires_at > now()`);
    const row = res.rows[0];
    if (!row) throw AppError.unauthenticated('Invalid, expired or revoked token');

    const scopes = row.token_scopes.filter((s) => row.grant_scopes.includes(s)) as MiniAppScope[];
    const required = this.reflector.getAllAndOverride<MiniAppScope | undefined>(REQUIRED_SCOPE, [ctx.getHandler(), ctx.getClass()]);
    if (required && !scopes.includes(required)) throw AppError.forbidden('The token does not carry the required scope');
    req.miniapp = { appId: row.app_id, orgId: row.org_id, userId: row.user_id, scopes };
    return true;
  }
}

import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@caselind/contracts';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { sessions, users } from '../db/schema.js';
import { TokenService } from './token.service.js';

export interface AuthUser {
  userId: string;
  sessionId: string;
  roles: PlatformRole[];
}

declare module 'express' {
  interface Request {
    auth?: AuthUser;
  }
}

const IS_PUBLIC = 'caselind:isPublic';
const ROLES = 'caselind:roles';

/** Route is reachable without authentication. Everything else requires a valid session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route requires at least one of these platform roles (checked server-side). */
export const Roles = (...roles: PlatformRole[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const auth = ctx.switchToHttp().getRequest<Request>().auth;
  if (!auth) throw AppError.unauthenticated();
  return auth;
});

/**
 * Global guard: verifies the access token AND that its session is still active and the
 * user is active, so revoking a session or suspending an account takes effect immediately.
 * Roles are read from the database, not trusted from the token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw AppError.unauthenticated();

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw AppError.unauthenticated('Invalid or expired access token');

    const [row] = await this.db
      .select({ status: users.status, roles: users.roles })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, claims.sid),
          eq(sessions.userId, claims.sub),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row || row.status !== 'active') throw AppError.unauthenticated('Session is no longer valid');

    const auth: AuthUser = { userId: claims.sub, sessionId: claims.sid, roles: row.roles as PlatformRole[] };
    req.auth = auth;

    const required = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(ROLES, targets);
    if (required?.length && !required.some((r) => auth.roles.includes(r))) {
      throw AppError.forbidden();
    }
    return true;
  }
}

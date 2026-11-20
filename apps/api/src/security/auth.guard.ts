import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@caselind/contracts';
import type { Request } from 'express';
import { ErrorCodes } from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { SessionVerifier } from './session-verifier.js';

export interface AuthUser {
  userId: string;
  sessionId: string;
  roles: PlatformRole[];
  /** Suspended or banned account: only routes marked `@AllowRestricted()` answer. */
  restricted?: boolean;
}

declare module 'express' {
  interface Request {
    auth?: AuthUser;
  }
}

const IS_PUBLIC = 'caselind:isPublic';
const ROLES = 'caselind:roles';
const ALLOW_RESTRICTED = 'caselind:allowRestricted';

/** Route (or controller) that a suspended / banned account may still call: its sanctions and appeals, sign-out. */
export const AllowRestricted = () => SetMetadata(ALLOW_RESTRICTED, true);

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
    private readonly verifier: SessionVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // WebSocket handlers are authenticated once, at the handshake (realtime gateway).
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw AppError.unauthenticated();

    const auth = await this.verifier.verify(token, { allowRestricted: true });
    if (!auth) throw AppError.unauthenticated('Invalid, expired or revoked session');
    if (auth.restricted && !this.reflector.getAllAndOverride<boolean>(ALLOW_RESTRICTED, targets)) {
      throw new AppError(403, ErrorCodes.accountSuspended, 'This account is suspended');
    }
    req.auth = auth;

    const required = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(ROLES, targets);
    if (required?.length && !required.some((r) => auth.roles.includes(r))) {
      throw AppError.forbidden();
    }
    return true;
  }
}

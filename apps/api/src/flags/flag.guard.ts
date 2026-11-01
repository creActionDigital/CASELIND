import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import { FlagsService } from './flags.service.js';

export const REQUIRE_FLAG = 'caselind:requireFlag';

/** Route (or controller) is only reachable when this feature flag is ON for the caller. */
export const RequireFlag = (key: string) => SetMetadata(REQUIRE_FLAG, key);

/**
 * Global guard registered after AuthGuard, so `req.auth` is already set on authenticated
 * routes. Refuses with 403 `feature_disabled` when the required flag evaluates to false.
 * On a public route the flag is evaluated for an anonymous caller (no country, no role).
 */
@Injectable()
export class FlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FlagsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_FLAG, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!key) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    if (!(await this.flags.evaluateForUser(key, req.auth?.userId ?? null))) {
      throw AppError.featureDisabled();
    }
    return true;
  }
}

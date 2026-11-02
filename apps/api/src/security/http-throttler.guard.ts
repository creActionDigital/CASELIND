import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** The throttler is HTTP-only: WebSocket handlers have their own limits (see the realtime gateway). */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  override async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    return super.canActivate(ctx);
  }
}

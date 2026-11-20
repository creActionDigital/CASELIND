import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { catchError, type Observable, throwError } from 'rxjs';
import { MiniAppUsageService } from './miniapp-usage.service.js';

/** Counts the errors raised after authentication on `miniapp-api` routes (validation, conflicts, failures) in the app's daily usage. */
@Injectable()
export class MiniAppUsageInterceptor implements NestInterceptor {
  constructor(private readonly usage: MiniAppUsageService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const appId = ctx.switchToHttp().getRequest<Request>().miniapp?.appId;
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (appId) void this.usage.bumpQuietly(appId, 'errors');
        return throwError(() => err);
      }),
    );
  }
}

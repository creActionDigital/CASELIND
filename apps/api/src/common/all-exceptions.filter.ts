import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { type ApiError, ErrorCodes } from '@caselind/contracts';
import type { Request, Response } from 'express';
import { AppError } from './app-error.js';

const httpStatusCodes: Record<number, string> = {
  400: ErrorCodes.validationFailed,
  401: ErrorCodes.unauthenticated,
  403: ErrorCodes.forbidden,
  404: ErrorCodes.notFound,
  409: ErrorCodes.conflict,
  429: ErrorCodes.rateLimited,
};

/**
 * What may be logged of an unhandled error. A failed Drizzle query carries its bound parameters
 * (in `params` and in the message), i.e. user content such as message bodies or credentials: they
 * are cut out, only the statement and the driver's error code remain.
 */
export function redactedError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const e = err as Error & { query?: unknown; params?: unknown; cause?: unknown };
  const marker = '\nparams:';
  if (!('params' in e) && !e.message.includes(marker)) return err;
  const cause = e.cause as { code?: unknown } | undefined;
  const safe = new Error(e.message.split(marker)[0]);
  safe.name = e.name;
  safe.stack = e.stack?.replace(e.message, safe.message);
  if (typeof cause?.code === 'string') (safe as Error & { code?: string }).code = cause.code;
  return safe;
}

/** Renders every error as the shared ApiError envelope. Internal details never leak to clients. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = String(req.id ?? '');

    let status = 500;
    let body: ApiError['error'];

    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details };
      const wait = (exception.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
      if (status === 429 && typeof wait === 'number') res.setHeader('Retry-After', String(wait));
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      body = { code: ErrorCodes.rateLimited, message: 'Too many requests, please retry later' };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        code: httpStatusCodes[status] ?? (status >= 500 ? ErrorCodes.internal : 'http_error'),
        message: status >= 500 ? 'Internal server error' : exception.message,
      };
    } else {
      body = { code: ErrorCodes.internal, message: 'Internal server error' };
    }

    if (status >= 500) {
      this.logger.error({ err: redactedError(exception), requestId }, 'unhandled error');
    }
    res.status(status).json({ error: { ...body, requestId } } satisfies ApiError);
  }
}

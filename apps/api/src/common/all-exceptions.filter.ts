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
      this.logger.error({ err: exception, requestId }, 'unhandled error');
    }
    res.status(status).json({ error: { ...body, requestId } } satisfies ApiError);
  }
}

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Client metadata recorded on sessions and audit events. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function requestMetaOf(req: Request): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
    requestId: req.id ? String(req.id) : null,
  };
}

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMetaOf(ctx.switchToHttp().getRequest<Request>()),
);

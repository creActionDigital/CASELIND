import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  type ConsentHistory,
  type ConsentKind,
  consentKindSchema,
  type SetConsentRequest,
  setConsentRequestSchema,
  type UserConsent,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { ConsentsService } from './consents.service.js';

@Controller()
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get('me/consents/history')
  history(@CurrentUser() user: AuthUser): Promise<ConsentHistory> {
    return this.consents.history(user.userId);
  }

  @Put('me/consents/:kind')
  set(
    @CurrentUser() user: AuthUser,
    @Param('kind', new ZodPipe(consentKindSchema)) kind: ConsentKind,
    @Body(new ZodPipe(setConsentRequestSchema)) body: SetConsentRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<UserConsent> {
    return this.consents.set(user.userId, kind, body.granted, meta);
  }
}

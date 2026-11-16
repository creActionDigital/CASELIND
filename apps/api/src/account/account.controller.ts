import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  type AccountConsents,
  type AccountExport,
  type DeletionRequest,
  type DeletionRequestResponse,
  deletionRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { AccountService } from './account.service.js';

@Controller()
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('me/consents')
  consents(@CurrentUser() user: AuthUser): Promise<AccountConsents> {
    return this.account.consents(user.userId);
  }

  @Get('me/export')
  export(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta): Promise<AccountExport> {
    return this.account.export(user, meta);
  }

  @Post('me/deletion-request')
  @HttpCode(202)
  requestDeletion(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(deletionRequestSchema)) body: DeletionRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<DeletionRequestResponse> {
    return this.account.requestDeletion(user, body.password, meta);
  }
}

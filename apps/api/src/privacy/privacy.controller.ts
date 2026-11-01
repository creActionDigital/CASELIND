import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Put, Query } from '@nestjs/common';
import {
  type BlockList,
  type BlockListQuery,
  blockListQuerySchema,
  type PrivacySettings,
  type UpdatePrivacyRequest,
  updatePrivacyRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { PrivacyService } from './privacy.service.js';

@Controller()
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('me/privacy')
  settings(@CurrentUser() user: AuthUser): Promise<PrivacySettings> {
    return this.privacy.getSettings(user.userId);
  }

  @Patch('me/privacy')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updatePrivacyRequestSchema)) body: UpdatePrivacyRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PrivacySettings> {
    return this.privacy.updateSettings(user.userId, body, meta);
  }

  @Get('blocks')
  blocks(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(blockListQuerySchema)) query: BlockListQuery,
  ): Promise<BlockList> {
    return this.privacy.listBlocksPage(user.userId, query);
  }

  // :userId is validated in the service: a malformed id is a 404 like an unknown user.
  @Put('blocks/:userId')
  @HttpCode(204)
  async block(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.privacy.block(user.userId, userId, meta);
  }

  @Delete('blocks/:userId')
  @HttpCode(204)
  async unblock(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.privacy.unblock(user.userId, userId, meta);
  }
}

import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  type FeatureFlag,
  flagKeySchema,
  type UpdateFeatureFlagRequest,
  updateFeatureFlagRequestSchema,
  type UserFlags,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { FlagsService } from './flags.service.js';

/** Flags as seen by clients: evaluated server-side for the caller's country and roles. */
@Controller('config')
export class ConfigController {
  constructor(private readonly flags: FlagsService) {}

  @Get('flags')
  async flagsForMe(@CurrentUser() user: AuthUser): Promise<UserFlags> {
    return { flags: await this.flags.evaluateAll(await this.flags.contextFor(user.userId)) };
  }
}

/** Flag administration. Every route requires the `admin` platform role; every change is audited. */
@Controller('admin/flags')
@Roles('admin')
export class AdminFlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  async list(): Promise<{ items: FeatureFlag[] }> {
    return { items: await this.flags.list() };
  }

  @Put(':key')
  update(
    @Param('key', new ZodPipe(flagKeySchema)) key: string,
    @Body(new ZodPipe(updateFeatureFlagRequestSchema)) body: UpdateFeatureFlagRequest,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ): Promise<FeatureFlag> {
    return this.flags.update(key, body, user.userId, meta);
  }
}

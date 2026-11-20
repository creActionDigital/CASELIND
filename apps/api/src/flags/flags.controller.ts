import { Body, Controller, Get, Param, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  type ApprovalPending,
  type FeatureFlag,
  flagKeySchema,
  type UpdateFeatureFlagRequest,
  updateFeatureFlagRequestSchema,
  type UserFlags,
} from '@caselind/contracts';
import { AdminApprovalsService } from '../admin/approvals.service.js';
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
  constructor(
    private readonly flags: FlagsService,
    private readonly approvals: AdminApprovalsService,
  ) {}

  @Get()
  async list(): Promise<{ items: FeatureFlag[] }> {
    return { items: await this.flags.list() };
  }

  /** Switching a regulated flag on or off goes through the double validation when it is active (202 `{approvalId, status}`). */
  @Put(':key')
  async update(
    @Param('key', new ZodPipe(flagKeySchema)) key: string,
    @Body(new ZodPipe(updateFeatureFlagRequestSchema)) body: UpdateFeatureFlagRequest,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FeatureFlag | ApprovalPending> {
    if (this.approvals.isActive() && (await this.flags.isRegulatedToggle(key, body))) {
      const pending = await this.approvals.guard({ kind: 'flag.regulated.change', subjectId: key, payload: { key, patch: body }, actorId: user.userId, meta });
      if (pending) {
        res.status(202);
        return pending;
      }
    }
    return this.flags.update(key, body, user.userId, meta);
  }
}

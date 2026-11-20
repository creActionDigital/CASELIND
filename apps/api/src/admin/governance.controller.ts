import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  type AdminListQuery,
  type ApprovalPending,
  type GrantPlatformRoleRequest,
  grantPlatformRoleRequestSchema,
  adminListQuerySchema,
  type AdminOrgList,
  type AdminUserList,
  type SetOrgStatusRequest,
  setOrgStatusRequestSchema,
  type SetOrgVerificationRequest,
  setOrgVerificationRequestSchema,
  type SetUserStatusRequest,
  setUserStatusRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { AdminApprovalsService } from './approvals.service.js';
import { GovernanceService } from './governance.service.js';

/** Platform governance. Every route requires the `admin` platform role, checked server-side. */
@Controller('admin')
@Roles('admin')
export class GovernanceController {
  constructor(
    private readonly gov: GovernanceService,
    private readonly approvals: AdminApprovalsService,
  ) {}

  @Get('users')
  users(@Query(new ZodPipe(adminListQuerySchema)) q: AdminListQuery): Promise<AdminUserList> {
    return this.gov.listUsers(q);
  }

  /** 204, or 202 `{approvalId, status}` when the target holds a platform role and the double validation is active. */
  @Put('users/:id/status')
  @HttpCode(204)
  async setUserStatus(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(setUserStatusRequestSchema)) b: SetUserStatusRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApprovalPending | void> {
    if (this.approvals.isActive() && id !== u.userId && (await this.gov.isStaffSuspension(id, b))) {
      const pending = await this.approvals.guard({ kind: 'user.suspend.staff', subjectId: id, payload: { status: b.status }, reason: b.reason, actorId: u.userId, meta });
      if (pending) {
        res.status(202);
        return pending;
      }
    }
    return this.gov.setUserStatus(u.userId, id, b, meta);
  }

  /** Gives a platform role (sensitive): 204, or 202 `{approvalId, status}` when the double validation is active. */
  @Post('users/:id/platform-roles')
  @HttpCode(204)
  async grantRole(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(grantPlatformRoleRequestSchema)) b: GrantPlatformRoleRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApprovalPending | void> {
    const pending = await this.approvals.guard({ kind: 'user.platform_role.grant', subjectId: id, payload: { role: b.role }, reason: b.reason, actorId: u.userId, meta, precheck: () => this.gov.precheckGrant(u.userId, id) });
    if (pending) {
      res.status(202);
      return pending;
    }
    return this.gov.grantPlatformRole(u.userId, id, b, meta);
  }

  @Get('orgs')
  orgs(@Query(new ZodPipe(adminListQuerySchema)) q: AdminListQuery): Promise<AdminOrgList> {
    return this.gov.listOrgs(q);
  }

  @Put('orgs/:id/status')
  @HttpCode(204)
  setOrgStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(setOrgStatusRequestSchema)) b: SetOrgStatusRequest, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.gov.setOrgStatus(u.userId, id, b, meta);
  }

  @Put('orgs/:id/verification')
  @HttpCode(204)
  setOrgVerification(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(setOrgVerificationRequestSchema)) b: SetOrgVerificationRequest, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.gov.setOrgVerification(u.userId, id, b, meta);
  }
}

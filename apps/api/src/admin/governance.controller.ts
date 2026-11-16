import { Body, Controller, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import {
  type AdminListQuery,
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
import { GovernanceService } from './governance.service.js';

/** Platform governance. Every route requires the `admin` platform role, checked server-side. */
@Controller('admin')
@Roles('admin')
export class GovernanceController {
  constructor(private readonly gov: GovernanceService) {}

  @Get('users')
  users(@Query(new ZodPipe(adminListQuerySchema)) q: AdminListQuery): Promise<AdminUserList> {
    return this.gov.listUsers(q);
  }

  @Put('users/:id/status')
  @HttpCode(204)
  setUserStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(setUserStatusRequestSchema)) b: SetUserStatusRequest, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.gov.setUserStatus(u.userId, id, b, meta);
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

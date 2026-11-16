import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  type CreateFeeRequest,
  createFeeRequestSchema,
  type FeeStatusList,
  type MarkFeeRequest,
  markFeeRequestSchema,
  type MyFeeList,
  type SchoolFee,
  type SchoolFeeList,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { FeesService } from './fees.service.js';

/** School staff (`org.members.manage`): fee statements per class. A record only, no money moves. Behind the regulated `school` flag. */
@Controller('orgs/:orgId/school/classes/:classId/fees')
@RequireFlag('school')
export class OrgFeesController {
  constructor(private readonly fees: FeesService) {}

  @Post()
  @OrgPermission('org.members.manage')
  create(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('classId') classId: string, @Body(new ZodPipe(createFeeRequestSchema)) b: CreateFeeRequest, @ReqMeta() meta: RequestMeta): Promise<SchoolFee> {
    return this.fees.create(m.orgId, u.userId, classId, b, meta);
  }

  @Get()
  @OrgPermission('org.members.manage')
  list(@CurrentMembership() m: OrgMembership, @Param('classId') classId: string): Promise<SchoolFeeList> {
    return this.fees.list(m.orgId, classId);
  }

  @Get(':feeId/statuses')
  @OrgPermission('org.members.manage')
  statuses(@CurrentMembership() m: OrgMembership, @Param('classId') classId: string, @Param('feeId') feeId: string): Promise<FeeStatusList> {
    return this.fees.statuses(m.orgId, classId, feeId);
  }

  @Post(':feeId/mark')
  @HttpCode(204)
  @OrgPermission('org.members.manage')
  mark(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('classId') classId: string, @Param('feeId') feeId: string, @Body(new ZodPipe(markFeeRequestSchema)) b: MarkFeeRequest, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.fees.mark(m.orgId, u.userId, classId, feeId, b, meta);
  }
}

/** Enrolled students, parents and teachers read the fees of their own classes. */
@Controller('me/school/fees')
@RequireFlag('school')
export class MyFeesController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  mine(@CurrentUser() u: AuthUser): Promise<MyFeeList> {
    return this.fees.mine(u.userId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  type ChildClassList,
  type ChildFeeList,
  type CreateGuardianRequest,
  createGuardianRequestSchema,
  type MyChildList,
  type MyGuardianshipList,
  type SchoolGuardian,
  type SchoolGuardianList,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { GuardiansService } from './guardians.service.js';

/** School staff (`org.members.manage`): optional parent-pupil links. Behind the regulated `school` flag. */
@Controller('orgs/:orgId/school/guardians')
@RequireFlag('school')
export class OrgGuardiansController {
  constructor(private readonly g: GuardiansService) {}

  @Post()
  @OrgPermission('org.members.manage')
  create(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createGuardianRequestSchema)) b: CreateGuardianRequest, @ReqMeta() meta: RequestMeta): Promise<SchoolGuardian> {
    return this.g.create(m.orgId, u.userId, b, meta);
  }

  @Get()
  @OrgPermission('org.members.manage')
  list(@CurrentMembership() m: OrgMembership): Promise<SchoolGuardianList> {
    return this.g.list(m.orgId);
  }

  @Delete(':id')
  @HttpCode(204)
  @OrgPermission('org.members.manage')
  remove(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.g.remove(m.orgId, u.userId, id, meta);
  }
}

/** A parent: invitations to answer, then the children they follow (ACTIVE links only; anything else is a 404). */
@Controller('me/school')
@RequireFlag('school')
export class MyGuardianshipsController {
  constructor(private readonly g: GuardiansService) {}

  @Get('guardianships')
  mine(@CurrentUser() u: AuthUser): Promise<MyGuardianshipList> {
    return this.g.mine(u.userId);
  }

  @Post('guardianships/:id/accept')
  @HttpCode(204)
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.g.accept(u.userId, id, meta);
  }

  @Post('guardianships/:id/decline')
  @HttpCode(204)
  decline(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.g.decline(u.userId, id, meta);
  }

  @Get('children')
  children(@CurrentUser() u: AuthUser): Promise<MyChildList> {
    return this.g.children(u.userId);
  }

  @Get('children/:studentId/fees')
  fees(@CurrentUser() u: AuthUser, @Param('studentId') studentId: string): Promise<ChildFeeList> {
    return this.g.childFees(u.userId, studentId);
  }

  @Get('children/:studentId/classes')
  classes(@CurrentUser() u: AuthUser, @Param('studentId') studentId: string): Promise<ChildClassList> {
    return this.g.childClasses(u.userId, studentId);
  }
}

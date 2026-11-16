import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateScholarshipRequest,
  createScholarshipRequestSchema,
  type Scholarship,
  type UpdateScholarshipRequest,
  updateScholarshipRequestSchema,
  type ScholarshipList,
  type ScholarshipListQuery,
  scholarshipListQuerySchema,
  type SchoolSearchQuery,
  schoolSearchQuerySchema,
  type SchoolSummaryList,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { ScholarshipsService } from './scholarships.service.js';

/** Signed-in readers: school search and open scholarships of public schools. Behind the regulated `school` flag. */
@Controller()
@RequireFlag('school')
export class ScholarshipsController {
  constructor(private readonly s: ScholarshipsService) {}

  @Get('schools')
  schools(@Query(new ZodPipe(schoolSearchQuerySchema)) q: SchoolSearchQuery): Promise<SchoolSummaryList> {
    return this.s.searchSchools(q);
  }

  @Get('school/scholarships')
  list(@Query(new ZodPipe(scholarshipListQuerySchema)) q: ScholarshipListQuery): Promise<ScholarshipList> {
    return this.s.list(q);
  }

  @Get('school/scholarships/:id')
  one(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Scholarship> {
    return this.s.get(id, u.userId);
  }
}

/** School staff (`org.members.manage`). */
@Controller('orgs/:orgId/school/scholarships')
@RequireFlag('school')
export class OrgScholarshipsController {
  constructor(private readonly s: ScholarshipsService) {}

  @Post()
  @OrgPermission('org.members.manage')
  publish(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createScholarshipRequestSchema)) b: CreateScholarshipRequest, @ReqMeta() meta: RequestMeta): Promise<Scholarship> {
    return this.s.publish(m.orgId, u.userId, b, meta);
  }

  @Get()
  @OrgPermission('org.members.manage')
  list(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(scholarshipListQuerySchema)) q: ScholarshipListQuery): Promise<ScholarshipList> {
    return this.s.orgList(m.orgId, q);
  }

  @Patch(':id')
  @OrgPermission('org.members.manage')
  update(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateScholarshipRequestSchema)) b: UpdateScholarshipRequest, @ReqMeta() meta: RequestMeta): Promise<Scholarship> {
    return this.s.update(m.orgId, u.userId, id, b, meta);
  }

  @Post(':id/close')
  @HttpCode(204)
  @OrgPermission('org.members.manage')
  close(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.s.close(m.orgId, u.userId, id, meta);
  }
}

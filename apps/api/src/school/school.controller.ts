import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  type Announcement,
  type ClassMemberList,
  type CreateAnnouncementRequest,
  createAnnouncementRequestSchema,
  type CreateClassRequest,
  createClassRequestSchema,
  type CreateLessonRequest,
  createLessonRequestSchema,
  type EnrollRequest,
  enrollRequestSchema,
  type SchoolLesson,
  type MyClassDetail,
  type MyClassList,
  type SchoolClass,
  type SchoolClassList,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { SchoolService } from './school.service.js';

/** School staff (`org.members.manage`: owner or admin of a school). Behind the regulated `school` flag. */
@Controller('orgs/:orgId/school')
@RequireFlag('school')
export class OrgSchoolController {
  constructor(private readonly school: SchoolService) {}

  @Post('classes')
  @OrgPermission('org.members.manage')
  createClass(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createClassRequestSchema)) b: CreateClassRequest, @ReqMeta() meta: RequestMeta): Promise<SchoolClass> {
    return this.school.createClass(m.orgId, u.userId, b, meta);
  }

  @Get('classes')
  @OrgPermission('org.members.manage')
  classes(@CurrentMembership() m: OrgMembership): Promise<SchoolClassList> {
    return this.school.listClasses(m.orgId);
  }

  @Post('classes/:classId/members')
  @HttpCode(204)
  @OrgPermission('org.members.manage')
  enroll(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('classId') classId: string, @Body(new ZodPipe(enrollRequestSchema)) b: EnrollRequest, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.school.enroll(m.orgId, u.userId, classId, b, meta);
  }

  @Get('classes/:classId/members')
  @OrgPermission('org.members.manage')
  members(@CurrentMembership() m: OrgMembership, @Param('classId') classId: string): Promise<ClassMemberList> {
    return this.school.members(m.orgId, classId);
  }

  @Delete('classes/:classId/members/:handle')
  @HttpCode(204)
  @OrgPermission('org.members.manage')
  unenroll(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('classId') classId: string, @Param('handle') handle: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.school.unenroll(m.orgId, u.userId, classId, handle, meta);
  }

  @Post('classes/:classId/lessons')
  @OrgPermission('org.members.manage')
  addLesson(@CurrentMembership() m: OrgMembership, @Param('classId') classId: string, @Body(new ZodPipe(createLessonRequestSchema)) b: CreateLessonRequest): Promise<SchoolLesson> {
    return this.school.addLesson(m.orgId, classId, b);
  }

  @Delete('classes/:classId/lessons/:lessonId')
  @HttpCode(204)
  @OrgPermission('org.members.manage')
  removeLesson(@CurrentMembership() m: OrgMembership, @Param('classId') classId: string, @Param('lessonId') lessonId: string): Promise<void> {
    return this.school.removeLesson(m.orgId, classId, lessonId);
  }

  @Post('classes/:classId/announcements')
  @OrgPermission('org.members.manage')
  announce(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('classId') classId: string, @Body(new ZodPipe(createAnnouncementRequestSchema)) b: CreateAnnouncementRequest, @ReqMeta() meta: RequestMeta): Promise<Announcement> {
    return this.school.announce(m.orgId, u.userId, classId, b, meta);
  }
}

/** Enrolled students, parents and teachers read their own classes. */
@Controller('me/school')
@RequireFlag('school')
export class MySchoolController {
  constructor(private readonly school: SchoolService) {}

  @Get('classes')
  classes(@CurrentUser() u: AuthUser): Promise<MyClassList> {
    return this.school.myClasses(u.userId);
  }

  @Get('classes/:classId')
  one(@CurrentUser() u: AuthUser, @Param('classId') classId: string): Promise<MyClassDetail> {
    return this.school.myClass(u.userId, classId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type Application,
  type ApplicationList,
  type ApplyRequest,
  applyRequestSchema,
  type CreateJobAlertRequest,
  createJobAlertRequestSchema,
  type CreateJobRequest,
  type JobAlert,
  type JobAlertList,
  createJobRequestSchema,
  type Job,
  type JobList,
  type JobListQuery,
  jobListQuerySchema,
  type JobProfile,
  type JobProfileInput,
  jobProfileInputSchema,
  type MyJobProfile,
  type OrgApplication,
  type OrgApplicationList,
  type OrgApplicationsQuery,
  orgApplicationsQuerySchema,
  type PageQuery,
  pageQuerySchema,
  type SetApplicationStatusRequest,
  setApplicationStatusRequestSchema,
  type UpdateJobRequest,
  updateJobRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { JobsService } from './jobs.service.js';

/** Candidate side: browse offers, keep a CV, apply, follow and withdraw. Behind the `jobs` flag. */
@Controller()
@RequireFlag('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('jobs')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(jobListQuerySchema)) q: JobListQuery): Promise<JobList> {
    return this.jobs.list(user.userId, q);
  }

  @Get('jobs/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Job> {
    return this.jobs.get(user.userId, id);
  }

  @Post('jobs/:id/applications')
  apply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(applyRequestSchema)) body: ApplyRequest, @ReqMeta() meta: RequestMeta): Promise<Application> {
    return this.jobs.apply(user.userId, id, body, meta);
  }

  @Get('me/job-applications')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<ApplicationList> {
    return this.jobs.myApplications(user.userId, q);
  }

  @Post('me/job-applications/:id/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Application> {
    return this.jobs.withdraw(user.userId, id, meta);
  }

  @Get('me/job-alerts')
  alerts(@CurrentUser() user: AuthUser): Promise<JobAlertList> {
    return this.jobs.listAlerts(user.userId);
  }

  @Post('me/job-alerts')
  createAlert(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createJobAlertRequestSchema)) body: CreateJobAlertRequest, @ReqMeta() meta: RequestMeta): Promise<JobAlert> {
    return this.jobs.createAlert(user.userId, body, meta);
  }

  @Delete('me/job-alerts/:id')
  @HttpCode(204)
  async deleteAlert(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.jobs.deleteAlert(user.userId, id, meta);
  }

  @Get('me/job-profile')
  async profile(@CurrentUser() user: AuthUser): Promise<MyJobProfile> {
    return { profile: await this.jobs.getProfile(user.userId) };
  }

  @Put('me/job-profile')
  saveProfile(@CurrentUser() user: AuthUser, @Body(new ZodPipe(jobProfileInputSchema)) body: JobProfileInput, @ReqMeta() meta: RequestMeta): Promise<JobProfile> {
    return this.jobs.saveProfile(user.userId, body, meta);
  }

  @Delete('me/job-profile')
  @HttpCode(204)
  async deleteProfile(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.jobs.deleteProfile(user.userId, meta);
  }
}

/** Organisation side. Everything needs `hr.manage` (owner, admin, hr); a non-member gets 404. */
@Controller('orgs/:orgId')
@RequireFlag('jobs')
export class OrgJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post('jobs')
  @OrgPermission('hr.manage')
  create(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Body(new ZodPipe(createJobRequestSchema)) body: CreateJobRequest, @ReqMeta() meta: RequestMeta): Promise<Job> {
    return this.jobs.create(m.orgId, user.userId, body, meta);
  }

  @Get('jobs')
  @OrgPermission('hr.manage')
  list(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<JobList> {
    return this.jobs.orgList(m.orgId, user.userId, q);
  }

  @Patch('jobs/:jobId')
  @OrgPermission('hr.manage')
  update(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body(new ZodPipe(updateJobRequestSchema)) body: UpdateJobRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Job> {
    return this.jobs.update(m.orgId, jobId, user.userId, body, meta);
  }

  @Post('jobs/:jobId/close')
  @HttpCode(200)
  @OrgPermission('hr.manage')
  close(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('jobId') jobId: string, @ReqMeta() meta: RequestMeta): Promise<Job> {
    return this.jobs.close(m.orgId, jobId, user.userId, meta);
  }

  @Get('jobs/:jobId/applications')
  @OrgPermission('hr.manage')
  applications(@CurrentMembership() m: OrgMembership, @Param('jobId') jobId: string, @Query(new ZodPipe(orgApplicationsQuerySchema)) q: OrgApplicationsQuery): Promise<OrgApplicationList> {
    return this.jobs.orgApplications(m.orgId, jobId, q);
  }

  @Post('job-applications/:applicationId/status')
  @HttpCode(200)
  @OrgPermission('hr.manage')
  setStatus(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body(new ZodPipe(setApplicationStatusRequestSchema)) body: SetApplicationStatusRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<OrgApplication> {
    return this.jobs.setStatus(m.orgId, applicationId, user.userId, body.status, meta);
  }
}

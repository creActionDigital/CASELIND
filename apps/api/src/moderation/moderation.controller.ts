import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  type CreateReportRequest,
  createReportRequestSchema,
  type ModerationActionRequest,
  moderationActionRequestSchema,
  type ModerationActionResult,
  type ModerationReportGroupPage,
  type ModerationReportsQuery,
  moderationReportsQuerySchema,
  type PageQuery,
  pageQuerySchema,
  type Report,
  type ReportPage,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { ModerationService } from './moderation.service.js';

/** Name of the create handler: the `reports` throttler (app.module.ts) applies to it alone. */
export const CREATE_REPORT_HANDLER = 'create';

@Controller()
export class ReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @Post('reports')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createReportRequestSchema)) body: CreateReportRequest,
  ): Promise<Report> {
    return this.moderation.createReport(user.userId, body);
  }

  @Get('me/reports')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<ReportPage> {
    return this.moderation.myReports(user.userId, q);
  }
}

/** Moderation back-office: platform roles `admin` or `moderator`, checked server-side. */
@Controller('admin/moderation')
@Roles('admin', 'moderator')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('reports')
  reports(@Query(new ZodPipe(moderationReportsQuerySchema)) q: ModerationReportsQuery): Promise<ModerationReportGroupPage> {
    return this.moderation.queue(q);
  }

  @Post('actions')
  @HttpCode(200)
  act(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(moderationActionRequestSchema)) body: ModerationActionRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ModerationActionResult> {
    return this.moderation.act(user.userId, body, meta);
  }
}

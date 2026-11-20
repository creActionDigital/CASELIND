import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AdminMiniAppVersionListQuery,
  type CertifyMiniAppRequest,
  certifyMiniAppRequestSchema,
  type CreateMiniAppWebhookRequest,
  createMiniAppWebhookRequestSchema,
  type MiniAppRevenue,
  type MiniAppWebhook,
  type MiniAppWebhookWithSecret,
  type SetRevenueShareRequest,
  setRevenueShareRequestSchema,
  type WebhookDelivery,
  type WebhookDeliveryList,
  adminMiniAppVersionListQuerySchema,
  type CreateMiniAppVersionRequest,
  createMiniAppVersionRequestSchema,
  type MiniApp,
  type MiniAppActivityList,
  type MiniAppList,
  type MiniAppPageQuery,
  miniappPageQuerySchema,
  type MiniAppStats,
  type MiniAppStatsQuery,
  miniappStatsQuerySchema,
  type MiniAppVersion,
  type MiniAppVersionList,
  type MiniAppVersionListQuery,
  miniappVersionListQuerySchema,
  type ReviewMiniAppVersionRequest,
  reviewMiniAppVersionRequestSchema,
  type SetMiniAppQuotaRequest,
  setMiniAppQuotaRequestSchema,
} from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { UUID_RE } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { MiniAppDevService } from './miniapp-dev.service.js';
import { MiniAppUsageService } from './miniapp-usage.service.js';
import { MiniAppRevenueService } from './miniapp-revenue.service.js';
import { MiniAppWebhookService } from './miniapp-webhook.service.js';

const uuid = (id: string, what: string): string => {
  if (!UUID_RE.test(id)) throw AppError.notFound(`${what} not found`);
  return id;
};

/** Developer portal (owners of the application's organisation: any other caller sees a 404) and the user's activity view. */
@Controller()
@RequireFlag('miniapps')
export class MiniAppDeveloperController {
  constructor(
    private readonly dev: MiniAppDevService,
    private readonly usage: MiniAppUsageService,
    private readonly hooks: MiniAppWebhookService,
    private readonly revenue: MiniAppRevenueService,
  ) {}

  @Get('me/miniapps')
  mine(@CurrentUser() user: AuthUser): Promise<MiniAppList> {
    return this.dev.myApps(user.userId);
  }

  /** What an application read of the caller's data in the last 90 days (scope, resource, date; never the content). */
  @Get('me/miniapps/:appId/activity')
  activity(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Query(new ZodPipe(miniappPageQuerySchema)) q: MiniAppPageQuery,
  ): Promise<MiniAppActivityList> {
    return this.usage.activity(user.userId, uuid(appId, 'Authorization'), q);
  }

  @Post('miniapps/:appId/versions')
  create(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Body(new ZodPipe(createMiniAppVersionRequestSchema)) body: CreateMiniAppVersionRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniAppVersion> {
    return this.dev.createVersion(user.userId, uuid(appId, 'Application'), body, meta);
  }

  @Get('miniapps/:appId/versions')
  versions(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Query(new ZodPipe(miniappVersionListQuerySchema)) q: MiniAppVersionListQuery,
  ): Promise<MiniAppVersionList> {
    return this.dev.listVersions(user.userId, uuid(appId, 'Application'), q);
  }

  @Post('miniapps/:appId/versions/:versionId/submit')
  @HttpCode(200)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Param('versionId') versionId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniAppVersion> {
    return this.dev.submitVersion(user.userId, uuid(appId, 'Application'), uuid(versionId, 'Version'), meta);
  }

  // ---- webhook of the application (one per app; owner only) ----

  @Post('miniapps/:appId/webhook')
  create_webhook(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Body(new ZodPipe(createMiniAppWebhookRequestSchema)) body: CreateMiniAppWebhookRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniAppWebhookWithSecret> {
    return this.hooks.create(user.userId, uuid(appId, 'Application'), body, meta);
  }

  @Get('miniapps/:appId/webhook')
  get_webhook(@CurrentUser() user: AuthUser, @Param('appId') appId: string): Promise<MiniAppWebhook> {
    return this.hooks.get(user.userId, uuid(appId, 'Application'));
  }

  @Delete('miniapps/:appId/webhook')
  @HttpCode(204)
  async delete_webhook(@CurrentUser() user: AuthUser, @Param('appId') appId: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.hooks.remove(user.userId, uuid(appId, 'Application'), meta);
  }

  @Post('miniapps/:appId/webhook/rotate-secret')
  @HttpCode(200)
  rotate_webhook(@CurrentUser() user: AuthUser, @Param('appId') appId: string, @ReqMeta() meta: RequestMeta): Promise<MiniAppWebhookWithSecret> {
    return this.hooks.rotateSecret(user.userId, uuid(appId, 'Application'), meta);
  }

  @Post('miniapps/:appId/webhook/test')
  @HttpCode(200)
  test_webhook(@CurrentUser() user: AuthUser, @Param('appId') appId: string): Promise<WebhookDelivery> {
    return this.hooks.test(user.userId, uuid(appId, 'Application'));
  }

  @Get('miniapps/:appId/webhook/deliveries')
  deliveries(@CurrentUser() user: AuthUser, @Param('appId') appId: string): Promise<WebhookDeliveryList> {
    return this.hooks.deliveries(user.userId, uuid(appId, 'Application'));
  }

  // ---- indicative revenue statements (owner only) ----

  @Get('miniapps/:appId/revenue')
  revenue_list(@CurrentUser() user: AuthUser, @Param('appId') appId: string): Promise<MiniAppRevenue> {
    return this.revenue.list(user.userId, uuid(appId, 'Application'));
  }

  @Get('miniapps/:appId/revenue/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="revenue-statements.csv"')
  revenue_csv(@CurrentUser() user: AuthUser, @Param('appId') appId: string): Promise<string> {
    return this.revenue.csv(user.userId, uuid(appId, 'Application'));
  }

  @Get('miniapps/:appId/stats')
  stats(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Query(new ZodPipe(miniappStatsQuerySchema)) q: MiniAppStatsQuery,
  ): Promise<MiniAppStats> {
    return this.dev.stats(user.userId, uuid(appId, 'Application'), q);
  }
}

/** Back-office: review of versions and per-application quota. Platform roles `admin` or `moderator`, every decision audited. */
@Controller('admin/miniapps')
@Roles('admin', 'moderator')
@RequireFlag('miniapps')
export class AdminMiniAppVersionsController {
  constructor(private readonly dev: MiniAppDevService) {}

  @Get('versions')
  list(@Query(new ZodPipe(adminMiniAppVersionListQuerySchema)) q: AdminMiniAppVersionListQuery): Promise<MiniAppVersionList> {
    return this.dev.listForReview(q);
  }

  @Post('versions/:versionId/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('versionId') versionId: string,
    @Body(new ZodPipe(reviewMiniAppVersionRequestSchema)) body: ReviewMiniAppVersionRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniAppVersion> {
    return this.dev.approveVersion(uuid(versionId, 'Version'), user.userId, body, meta);
  }

  @Post('versions/:versionId/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('versionId') versionId: string,
    @Body(new ZodPipe(reviewMiniAppVersionRequestSchema)) body: ReviewMiniAppVersionRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniAppVersion> {
    return this.dev.rejectVersion(uuid(versionId, 'Version'), user.userId, body, meta);
  }

  @Post(':appId/certify')
  @Roles('admin')
  @HttpCode(200)
  certify(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Body(new ZodPipe(certifyMiniAppRequestSchema)) body: CertifyMiniAppRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniApp> {
    return this.dev.certify(uuid(appId, 'Application'), user.userId, body, meta);
  }

  @Post(':appId/decertify')
  @HttpCode(200)
  decertify(@CurrentUser() user: AuthUser, @Param('appId') appId: string, @ReqMeta() meta: RequestMeta): Promise<MiniApp> {
    return this.dev.decertify(uuid(appId, 'Application'), user.userId, meta);
  }

  @Patch(':appId/revenue-share')
  @Roles('admin')
  revenueShare(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Body(new ZodPipe(setRevenueShareRequestSchema)) body: SetRevenueShareRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniApp> {
    return this.dev.setRevenueShare(uuid(appId, 'Application'), user.userId, body, meta);
  }

  @Patch(':appId/quota')
  @Roles('admin')
  setQuota(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Body(new ZodPipe(setMiniAppQuotaRequestSchema)) body: SetMiniAppQuotaRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniApp> {
    return this.dev.setQuota(uuid(appId, 'Application'), user.userId, body, meta);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  type AdminAnnouncement,
  type AdminAnnouncementList,
  type AdminAnnouncementListQuery,
  adminAnnouncementListQuerySchema,
  type AdminAppeal,
  type AdminAppealList,
  type AdminAppealListQuery,
  adminAppealListQuerySchema,
  type AdminCommissionStatement,
  type AdminSetting,
  type AdminSettingList,
  type AdminSettingListQuery,
  adminSettingListQuerySchema,
  type AppealRequest,
  appealRequestSchema,
  type ApprovalPending,
  type CommissionQuery,
  commissionQuerySchema,
  type CreatePlatformAnnouncementRequest,
  createPlatformAnnouncementRequestSchema,
  type DecideAppealRequest,
  decideAppealRequestSchema,
  type IssueSanctionRequest,
  issueSanctionRequestSchema,
  isSensitiveSetting,
  type LiftSanctionRequest,
  liftSanctionRequestSchema,
  type OrgCommissionQuery,
  orgCommissionQuerySchema,
  type OrgCommissionStatement,
  type PageQuery,
  pageQuerySchema,
  type PlatformAnnouncementList,
  type PublicConfig,
  publicConfigQuerySchema,
  type PublicConfigQuery,
  type PutSettingRequest,
  putSettingRequestSchema,
  type Sanction,
  type SanctionList,
  type SanctionListQuery,
  sanctionListQuerySchema,
  type SetOrgCommissionRequest,
  setOrgCommissionRequestSchema,
  type UpdateAnnouncementRequest,
  updateAnnouncementRequestSchema,
} from '@caselind/contracts';
import { AdminApprovalsService } from '../admin/approvals.service.js';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser, Public, Roles } from '../security/auth.guard.js';
import { AnnouncementsService } from './announcements.service.js';
import { CommissionService } from './commission.service.js';
import { SanctionsService } from './sanctions.service.js';
import { SettingsService } from './settings.service.js';

const actorOf = (u: AuthUser) => ({ userId: u.userId, roles: u.roles });

/** Sanctions and appeals: moderators (warnings, posting blocks) and administrators. The server decides who may do what (sanctionVerdict). */
@Controller('admin')
@Roles('admin', 'moderator')
export class AdminSanctionsController {
  constructor(
    private readonly sanctions: SanctionsService,
    private readonly approvals: AdminApprovalsService,
  ) {}

  /** 201, or 202 `{approvalId, status}` when the target is an administrator (or staff for a ban / long suspension) and the double validation is active. */
  @Post('users/:id/sanctions')
  async issue(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(issueSanctionRequestSchema)) b: IssueSanctionRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Sanction | ApprovalPending> {
    const plan = await this.sanctions.plan(actorOf(u), id, b, this.approvals.isActive());
    if (plan === 'approval') {
      const pending = await this.approvals.guard({
        kind: 'sanction.issue',
        subjectId: id,
        payload: { kind: b.kind, ...(b.durationDays ? { durationDays: b.durationDays } : {}), ...(b.reportId ? { reportId: b.reportId } : {}) },
        reason: b.reason,
        actorId: u.userId,
        meta,
      });
      if (pending) {
        res.status(202);
        return pending;
      }
    }
    return this.sanctions.issue(actorOf(u), id, b, meta);
  }

  @Get('users/:id/sanctions')
  forUser(@Param('id') id: string, @Query(new ZodPipe(sanctionListQuerySchema)) q: SanctionListQuery): Promise<SanctionList> {
    return this.sanctions.list({ ...q, userId: id }, null, true);
  }

  @Get('sanctions')
  list(@Query(new ZodPipe(sanctionListQuerySchema)) q: SanctionListQuery): Promise<SanctionList> {
    return this.sanctions.list(q, null, true);
  }

  @Post('sanctions/:id/lift')
  @HttpCode(200)
  lift(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(liftSanctionRequestSchema)) b: LiftSanctionRequest, @ReqMeta() meta: RequestMeta): Promise<Sanction> {
    return this.sanctions.lift(actorOf(u), id, b, meta);
  }

  @Get('appeals')
  appeals(@Query(new ZodPipe(adminAppealListQuerySchema)) q: AdminAppealListQuery): Promise<AdminAppealList> {
    return this.sanctions.listAppeals(q);
  }

  @Post('appeals/:id/decide')
  @HttpCode(200)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(decideAppealRequestSchema)) b: DecideAppealRequest, @ReqMeta() meta: RequestMeta): Promise<AdminAppeal> {
    return this.sanctions.decide(actorOf(u), id, b, meta);
  }
}

/** What the signed-in user sees of their own sanctions and appeal. */
@Controller('me/sanctions')
export class MySanctionsController {
  constructor(private readonly sanctions: SanctionsService) {}

  @Get()
  mine(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<SanctionList> {
    return this.sanctions.list(q, u.userId, false);
  }

  @Post(':id/appeal')
  @HttpCode(200)
  appeal(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(appealRequestSchema)) b: AppealRequest, @ReqMeta() meta: RequestMeta): Promise<Sanction> {
    return this.sanctions.appeal(u.userId, id, b, meta);
  }
}

/** Announcements, settings and commissions: administrators only. */
@Controller('admin')
@Roles('admin')
export class AdminPlatformController {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly settings: SettingsService,
    private readonly commissions: CommissionService,
    private readonly approvals: AdminApprovalsService,
  ) {}

  @Get('announcements')
  listAnnouncements(@Query(new ZodPipe(adminAnnouncementListQuerySchema)) q: AdminAnnouncementListQuery): Promise<AdminAnnouncementList> {
    return this.announcements.list(q);
  }

  @Post('announcements')
  createAnnouncement(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createPlatformAnnouncementRequestSchema)) b: CreatePlatformAnnouncementRequest, @ReqMeta() meta: RequestMeta): Promise<AdminAnnouncement> {
    return this.announcements.create(u.userId, b, meta);
  }

  @Patch('announcements/:id')
  updateAnnouncement(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateAnnouncementRequestSchema)) b: UpdateAnnouncementRequest, @ReqMeta() meta: RequestMeta): Promise<AdminAnnouncement> {
    return this.announcements.update(u.userId, id, b, meta);
  }

  @Post('announcements/:id/publish')
  @HttpCode(200)
  publishAnnouncement(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminAnnouncement> {
    return this.announcements.publish(u.userId, id, meta);
  }

  @Post('announcements/:id/end')
  @HttpCode(200)
  endAnnouncement(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminAnnouncement> {
    return this.announcements.end(u.userId, id, meta);
  }

  @Delete('announcements/:id')
  @HttpCode(204)
  deleteAnnouncement(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.announcements.remove(u.userId, id, meta);
  }

  @Get('settings')
  listSettings(@Query(new ZodPipe(adminSettingListQuerySchema)) q: AdminSettingListQuery): Promise<AdminSettingList> {
    return this.settings.list(q.key);
  }

  /** 200, or 202 `{approvalId, status}` for `commission.defaultBps` and `limits.*` when the double validation is active. */
  @Put('settings')
  async putSetting(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(putSettingRequestSchema)) b: PutSettingRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSetting | ApprovalPending> {
    if (isSensitiveSetting(b.key)) {
      const pending = await this.approvals.guard({ kind: 'setting.sensitive', subjectId: null, payload: { key: b.key, scope: b.scope, value: b.value }, reason: b.reason, actorId: u.userId, meta });
      if (pending) {
        res.status(202);
        return pending;
      }
    }
    return this.settings.put(u.userId, b, meta);
  }

  @Get('commissions')
  platformCommissions(@Query(new ZodPipe(commissionQuerySchema)) q: CommissionQuery): Promise<AdminCommissionStatement> {
    return this.commissions.forPlatform(q);
  }

  @Put('orgs/:id/commission')
  setOrgCommission(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(setOrgCommissionRequestSchema)) b: SetOrgCommissionRequest, @ReqMeta() meta: RequestMeta): Promise<{ orgId: string; bps: number | null }> {
    return this.commissions.setOrgBps(u.userId, id, b, meta);
  }
}

/** Active announcements for the caller (audience filtered server-side). */
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  mine(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<PlatformAnnouncementList> {
    return this.announcements.activeFor(u.userId, q);
  }
}

/** Public configuration: non-sensitive settings only. */
@Controller('config')
export class PublicConfigController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('public')
  publicConfig(@Query(new ZodPipe(publicConfigQuerySchema)) q: PublicConfigQuery): Promise<PublicConfig> {
    return this.settings.publicConfig(q.country, q.city);
  }
}

/** Seller statement of commissions (indicative: no real deduction). */
@Controller('orgs/:orgId')
@RequireFlag('commerce')
export class OrgCommissionsController {
  constructor(private readonly commissions: CommissionService) {}

  @Get('commissions')
  @OrgPermission('finance.view')
  statement(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(orgCommissionQuerySchema)) q: OrgCommissionQuery): Promise<OrgCommissionStatement> {
    return this.commissions.forOrg(m.orgId, q);
  }
}

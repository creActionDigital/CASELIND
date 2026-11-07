import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  type AdminKycList,
  type AdminKycListQuery,
  adminKycListQuerySchema,
  type AdminKycSubmission,
  type CreateKycSubmissionRequest,
  createKycSubmissionRequestSchema,
  type KycDecisionRequest,
  kycDecisionRequestSchema,
  type KycStatusView,
  type KycSubmission,
  type SetPaymentPinRequest,
  setPaymentPinRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { KycService } from './kyc.service.js';
import { PinService } from './pin.service.js';

/** Caller side: KYC status and requests, payment PIN. */
@Controller()
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly pins: PinService,
  ) {}

  @Get('me/kyc')
  status(@CurrentUser() user: AuthUser): Promise<KycStatusView> {
    return this.kyc.getMine(user.userId);
  }

  @Post('me/kyc/submissions')
  submit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createKycSubmissionRequestSchema)) body: CreateKycSubmissionRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<KycSubmission> {
    return this.kyc.submit(user.userId, user.sessionId, body, meta);
  }

  @Put('me/payment-pin')
  @HttpCode(204)
  async setPin(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(setPaymentPinRequestSchema)) body: SetPaymentPinRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.pins.set(user.userId, user.sessionId, body, meta);
  }
}

/** Back-office review of KYC requests (platform admins only, checked server-side). */
@Controller('admin/kyc')
@Roles('admin')
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  @Get('submissions')
  list(@Query(new ZodPipe(adminKycListQuerySchema)) q: AdminKycListQuery): Promise<AdminKycList> {
    return this.kyc.adminList(q);
  }

  @Get('submissions/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminKycSubmission> {
    return this.kyc.adminGet(user.userId, id, meta);
  }

  @Post('submissions/:id/decision')
  @HttpCode(200)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(kycDecisionRequestSchema)) body: KycDecisionRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<AdminKycSubmission> {
    return this.kyc.decide(user.userId, user.sessionId, id, body, meta);
  }
}

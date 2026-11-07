import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  type ChallengeResponse,
  type IdentifierChangeRequest,
  identifierChangeRequestSchema,
  type IdentifierChangeVerify,
  identifierChangeVerifySchema,
  type QrApproveRequest,
  qrApproveRequestSchema,
  type QrApproveResponse,
  type QrSessionRequest,
  qrSessionRequestSchema,
  type QrSessionResponse,
  type QrSessionStatus,
  type TotpDisableRequest,
  totpDisableRequestSchema,
  type TotpEnableRequest,
  totpEnableRequestSchema,
  type TotpEnableResponse,
  type TotpSetupResponse,
} from '@caselind/contracts';
import { AppError } from '../../common/app-error.js';
import { ReqMeta, type RequestMeta } from '../../common/request-meta.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Public } from '../../security/auth.guard.js';
import { IdentifierChangeService } from './identifier-change.service.js';
import { QrLoginService } from './qr-login.service.js';
import { TwoFactorService } from './two-factor.service.js';

/** Handler names the throttlers of app.module.ts single out. */
export const QR_CREATE_HANDLER = 'createSession';
export const QR_POLL_HANDLER = 'pollSession';

@Controller('me/2fa/totp')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Post('setup')
  @HttpCode(200)
  setup(@CurrentUser() user: AuthUser): Promise<TotpSetupResponse> {
    return this.twoFactor.setup(user);
  }

  @Post('enable')
  @HttpCode(200)
  enable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(totpEnableRequestSchema)) body: TotpEnableRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TotpEnableResponse> {
    return this.twoFactor.enable(user, body, meta);
  }

  @Post('disable')
  @HttpCode(204)
  disable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(totpDisableRequestSchema)) body: TotpDisableRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    return this.twoFactor.disable(user, body, meta);
  }
}

@Controller('me/identifier-change')
export class IdentifierChangeController {
  constructor(private readonly changes: IdentifierChangeService) {}

  @Post()
  @HttpCode(202)
  request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(identifierChangeRequestSchema)) body: IdentifierChangeRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ChallengeResponse> {
    return this.changes.request(user, body, meta);
  }

  @Post('verify')
  @HttpCode(204)
  verify(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(identifierChangeVerifySchema)) body: IdentifierChangeVerify,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    return this.changes.verify(user, body, meta);
  }
}

@Controller('auth/qr')
export class QrLoginController {
  constructor(private readonly qr: QrLoginService) {}

  @Public()
  @Post('session')
  @HttpCode(201)
  createSession(
    @Body(new ZodPipe(qrSessionRequestSchema)) body: QrSessionRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<QrSessionResponse> {
    return this.qr.create(body, meta);
  }

  @Post('approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(qrApproveRequestSchema)) body: QrApproveRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<QrApproveResponse> {
    return this.qr.approve(user, body, meta);
  }

  @Public()
  @Get('session/:id')
  pollSession(
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => AppError.notFound('QR session not found') })) id: string,
    @Headers('x-qr-session-secret') secret: string | undefined,
    @ReqMeta() meta: RequestMeta,
  ): Promise<QrSessionStatus> {
    return this.qr.poll(id, secret, meta);
  }
}

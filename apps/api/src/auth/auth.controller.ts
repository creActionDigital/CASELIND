import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  type ChallengeResponse,
  forgotPasswordRequestSchema,
  type LoginRequest,
  type LoginResponse,
  loginRequestSchema,
  refreshRequestSchema,
  type RegisterRequest,
  registerRequestSchema,
  resendOtpRequestSchema,
  resetPasswordRequestSchema,
  type Session,
  type TokenPair,
  type TwoFactorVerifyRequest,
  twoFactorVerifyRequestSchema,
  type VerifyOtpRequest,
  verifyOtpRequestSchema,
} from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Public } from '../security/auth.guard.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(202)
  register(
    @Body(new ZodPipe(registerRequestSchema)) body: RegisterRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ChallengeResponse> {
    return this.auth.register(body, meta);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  verify(
    @Body(new ZodPipe(verifyOtpRequestSchema)) body: VerifyOtpRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TokenPair> {
    return this.auth.verifySignup(body, meta);
  }

  @Public()
  @Post('otp/resend')
  @HttpCode(202)
  resend(@Body(new ZodPipe(resendOtpRequestSchema)) body: { challengeId: string }): Promise<ChallengeResponse> {
    return this.otp.resend(body.challengeId);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodPipe(loginRequestSchema)) body: LoginRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<LoginResponse> {
    return this.auth.login(body, meta);
  }

  /** Second step of a login on an account with two-factor authentication (lot 1c). */
  @Public()
  @Post('2fa/verify')
  @HttpCode(200)
  verifyTwoFactor(
    @Body(new ZodPipe(twoFactorVerifyRequestSchema)) body: TwoFactorVerifyRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TokenPair> {
    return this.auth.verifyTwoFactor(body, meta);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodPipe(refreshRequestSchema)) body: { refreshToken: string },
    @ReqMeta() meta: RequestMeta,
  ): Promise<TokenPair> {
    return this.auth.refresh(body.refreshToken, meta);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.auth.logout(user, meta);
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser): Promise<{ items: Session[] }> {
    return { items: await this.auth.listSessions(user) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => AppError.notFound('Session not found') })) id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    return this.auth.revokeSession(user, id, meta);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  forgot(
    @Body(new ZodPipe(forgotPasswordRequestSchema)) body: { identifier: string },
    @ReqMeta() meta: RequestMeta,
  ): Promise<ChallengeResponse> {
    return this.auth.forgotPassword(body.identifier, meta);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  reset(
    @Body(new ZodPipe(resetPasswordRequestSchema))
    body: { challengeId: string; code: string; newPassword: string },
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    return this.auth.resetPassword(body.challengeId, body.code, body.newPassword, meta);
  }
}

import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  type AdminMiniAppListQuery,
  adminMiniAppListQuerySchema,
  type AuthorizePreview,
  type AuthorizePreviewQuery,
  authorizePreviewQuerySchema,
  type AuthorizeRequest,
  type AuthorizeResponse,
  authorizeRequestSchema,
  type ConfirmMiniAppPaymentRequest,
  confirmMiniAppPaymentRequestSchema,
  type CreateMiniAppPaymentRequest,
  createMiniAppPaymentRequestSchema,
  type CreateMiniAppRequest,
  createMiniAppRequestSchema,
  type MiniApp,
  type MiniAppDirectoryQuery,
  miniappDirectoryQuerySchema,
  type MiniAppGrantList,
  type MiniAppList,
  type MiniAppMe,
  type MiniAppNotifyRequest,
  type MiniAppNotifyResponse,
  miniappNotifyRequestSchema,
  type SetMiniAppMuteRequest,
  setMiniAppMuteRequestSchema,
  type MiniAppOrderList,
  type MiniAppPageQuery,
  miniappPageQuerySchema,
  type MiniAppPaymentRequest,
  type MiniAppPaymentRequestList,
  type MiniAppPublic,
  type MiniAppPublicList,
  type MiniAppWithSecret,
  type PageQuery,
  pageQuerySchema,
  type ReviewMiniAppRequest,
  reviewMiniAppRequestSchema,
  type TokenRequest,
  type TokenResponse,
  tokenRequestSchema,
  type UpdateMiniAppRequest,
  updateMiniAppRequestSchema,
} from '@caselind/contracts';
import type { Response } from 'express';
import { AppError } from '../common/app-error.js';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission, UUID_RE } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser, Public, Roles } from '../security/auth.guard.js';
import { CurrentMiniApp, type MiniAppPrincipal, MiniAppTokenGuard, RequireMiniAppScope } from './miniapp-token.guard.js';
import { MiniAppApiService } from './miniapp-api.service.js';
import { MiniAppUsageInterceptor } from './miniapp-usage.interceptor.js';
import { MiniAppsService } from './miniapps.service.js';
import { OAuthService } from './oauth.service.js';

/** Handler name the `oauthToken` throttler targets (see AppModule). */
export const OAUTH_TOKEN_HANDLER = 'token';

const uuid = (id: string, what: string): string => {
  if (!UUID_RE.test(id)) throw AppError.notFound(`${what} not found`);
  return id;
};

/** Developer side: applications of an organisation. Only holders of `org.admins.manage` (owners). */
@Controller('orgs/:orgId/miniapps')
@RequireFlag('miniapps')
export class OrgMiniAppsController {
  constructor(private readonly apps: MiniAppsService) {}

  @Post()
  @OrgPermission('org.admins.manage')
  create(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createMiniAppRequestSchema)) body: CreateMiniAppRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniAppWithSecret> {
    return this.apps.create(m.orgId, user.userId, body, meta);
  }

  @Get()
  @OrgPermission('org.admins.manage')
  list(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<MiniAppList> {
    return this.apps.listForOrg(m.orgId, q);
  }

  @Get(':appId')
  @OrgPermission('org.admins.manage')
  get(@CurrentMembership() m: OrgMembership, @Param('appId') appId: string): Promise<MiniApp> {
    return this.apps.getForOrg(m.orgId, uuid(appId, 'Application'));
  }

  @Patch(':appId')
  @OrgPermission('org.admins.manage')
  update(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Body(new ZodPipe(updateMiniAppRequestSchema)) body: UpdateMiniAppRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniApp> {
    return this.apps.update(m.orgId, uuid(appId, 'Application'), user.userId, body, meta);
  }

  @Post(':appId/submit')
  @HttpCode(200)
  @OrgPermission('org.admins.manage')
  submit(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniApp> {
    return this.apps.submit(m.orgId, uuid(appId, 'Application'), user.userId, meta);
  }

  @Post(':appId/rotate-secret')
  @HttpCode(200)
  @OrgPermission('org.admins.manage')
  rotate(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniAppWithSecret> {
    return this.apps.rotateSecret(m.orgId, uuid(appId, 'Application'), user.userId, meta);
  }
}

/** Back-office review: platform roles `admin` or `moderator`, every decision audited. */
@Controller('admin/miniapps')
@Roles('admin', 'moderator')
@RequireFlag('miniapps')
export class AdminMiniAppsController {
  constructor(private readonly apps: MiniAppsService) {}

  @Get()
  list(@Query(new ZodPipe(adminMiniAppListQuerySchema)) q: AdminMiniAppListQuery): Promise<MiniAppList> {
    return this.apps.listForAdmin(q);
  }

  @Post(':appId/review')
  @HttpCode(200)
  review(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Body(new ZodPipe(reviewMiniAppRequestSchema)) body: ReviewMiniAppRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniApp> {
    return this.apps.review(uuid(appId, 'Application'), user.userId, body, meta);
  }
}

/** Directory of published applications. */
@Controller('miniapps')
@RequireFlag('miniapps')
export class MiniAppDirectoryController {
  constructor(private readonly apps: MiniAppsService) {}

  @Get()
  list(@Query(new ZodPipe(miniappDirectoryQuerySchema)) q: MiniAppDirectoryQuery): Promise<MiniAppPublicList> {
    return this.apps.directory(q);
  }

  @Get(':appId')
  get(@Param('appId') appId: string): Promise<MiniAppPublic> {
    return this.apps.publicDetail(uuid(appId, 'Application'));
  }
}

/** OAuth 2.0: consent screen calls (signed-in user) and the public token endpoint. */
@Controller('oauth')
@RequireFlag('miniapps')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('authorize/preview')
  preview(@CurrentUser() user: AuthUser, @Query(new ZodPipe(authorizePreviewQuerySchema)) q: AuthorizePreviewQuery): Promise<AuthorizePreview> {
    return this.oauth.preview(user.userId, q);
  }

  @Post('authorize')
  @HttpCode(200)
  authorize(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(authorizeRequestSchema)) body: AuthorizeRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<AuthorizeResponse> {
    return this.oauth.authorize(user.userId, body, meta);
  }

  /** Called by the app (server side or PKCE client), not by a signed-in user: public, rate limited by IP. */
  @Post('token')
  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  token(@Body(new ZodPipe(tokenRequestSchema)) body: TokenRequest, @ReqMeta() meta: RequestMeta): Promise<TokenResponse> {
    return this.oauth.token(body, meta);
  }
}

/** The user's side: authorizations and payment requests waiting for their PIN. */
@Controller('me')
@RequireFlag('miniapps')
export class MyMiniAppsController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly api: MiniAppApiService,
  ) {}

  @Get('miniapp-grants')
  grants(@CurrentUser() user: AuthUser): Promise<MiniAppGrantList> {
    return this.oauth.listGrants(user.userId);
  }

  @Delete('miniapp-grants/:appId')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('appId') appId: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.oauth.revokeGrant(user.userId, uuid(appId, 'Authorization'), meta);
  }

  /** Silence (or re-enable) the notifications of one app without withdrawing its access. */
  @Put('miniapp-grants/:appId/notifications')
  @HttpCode(204)
  async mute(
    @CurrentUser() user: AuthUser,
    @Param('appId') appId: string,
    @Body(new ZodPipe(setMiniAppMuteRequestSchema)) body: SetMiniAppMuteRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.oauth.setMuted(user.userId, uuid(appId, 'Authorization'), body.muted, meta);
  }

  @Get('miniapp-payment-requests')
  pending(@CurrentUser() user: AuthUser): Promise<MiniAppPaymentRequestList> {
    return this.api.listPendingForUser(user.userId);
  }

  @Post('miniapp-payment-requests/:id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(confirmMiniAppPaymentRequestSchema)) body: ConfirmMiniAppPaymentRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MiniAppPaymentRequest> {
    return this.api.confirm(user.userId, uuid(id, 'Payment request'), body, meta);
  }

  @Post('miniapp-payment-requests/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<MiniAppPaymentRequest> {
    return this.api.decline(user.userId, uuid(id, 'Payment request'));
  }
}

/**
 * What an app reaches with its own token. `@Public()` only opts out of the session guard (an app token is not a
 * session); MiniAppTokenGuard then authenticates the app token. None of the user routes accepts it.
 */
@Controller('miniapp-api')
@Public()
@UseGuards(MiniAppTokenGuard)
@UseInterceptors(MiniAppUsageInterceptor)
@RequireFlag('miniapps')
export class MiniAppApiController {
  constructor(private readonly api: MiniAppApiService) {}

  @Get('me')
  @RequireMiniAppScope('profile.basic', 'GET', '/v1/miniapp-api/me')
  me(@CurrentMiniApp() p: MiniAppPrincipal): Promise<MiniAppMe> {
    return this.api.me(p);
  }

  @Get('orders')
  @RequireMiniAppScope('orders.read', 'GET', '/v1/miniapp-api/orders')
  orders(@CurrentMiniApp() p: MiniAppPrincipal, @Query(new ZodPipe(miniappPageQuerySchema)) q: MiniAppPageQuery): Promise<MiniAppOrderList> {
    return this.api.orders(p, q);
  }

  @Post('payment-requests')
  @RequireMiniAppScope('wallet.pay', 'POST', '/v1/miniapp-api/payment-requests')
  async createPayment(
    @CurrentMiniApp() p: MiniAppPrincipal,
    @Body(new ZodPipe(createMiniAppPaymentRequestSchema)) body: CreateMiniAppPaymentRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MiniAppPaymentRequest> {
    const { request, created } = await this.api.createPaymentRequest(p, body);
    res.status(created ? 201 : 200);
    return request;
  }

  @Get('payment-requests/:id')
  @RequireMiniAppScope('wallet.pay', 'GET', '/v1/miniapp-api/payment-requests/{id}')
  getPayment(@CurrentMiniApp() p: MiniAppPrincipal, @Param('id') id: string): Promise<MiniAppPaymentRequest> {
    return this.api.getPaymentRequestForApp(p, uuid(id, 'Payment request'));
  }

  /** Scope notify: a notification to the user of the token only (5 a day per user, app quota, declared links only). */
  @Post('notify')
  @HttpCode(200)
  @RequireMiniAppScope('notify', 'POST', '/v1/miniapp-api/notify')
  async notify(
    @CurrentMiniApp() p: MiniAppPrincipal,
    @Body(new ZodPipe(miniappNotifyRequestSchema)) body: MiniAppNotifyRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MiniAppNotifyResponse> {
    try {
      return await this.api.notify(p, body);
    } catch (err) {
      if (err instanceof AppError && err.status === 429) {
        const next = new Date();
        next.setUTCHours(24, 0, 0, 0);
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((next.getTime() - Date.now()) / 1000))));
      }
      throw err;
    }
  }
}

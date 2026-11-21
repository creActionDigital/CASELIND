import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  type AdminSubscription,
  type AdminSubscriptionList,
  type AdminSubscriptionsQuery,
  adminSubscriptionsQuerySchema,
  type AutoRenewRequest,
  autoRenewRequestSchema,
  pageQuerySchema,
  type PutPlanRequest,
  putPlanRequestSchema,
  type RenewRequest,
  renewRequestSchema,
  type SubscribeRequest,
  subscribeRequestSchema,
  type SubscriptionPaymentList,
  type SubscriptionPlan,
  type SubscriptionPlanList,
  type SubscriptionQuery,
  subscriptionQuerySchema,
  type SubscriptionResponse,
  type SubscriptionState,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { PremiumService } from './premium.service.js';

const orgQuery = new ZodPipe(subscriptionQuerySchema);

/** Premium et forfaits pros : paiement en MODE TEST par le portefeuille de test (drapeau `wallet.sandbox`). */
@Controller()
@RequireFlag('wallet.sandbox')
export class PremiumController {
  constructor(private readonly premium: PremiumService) {}

  @Get('premium/plans')
  plans(): Promise<SubscriptionPlanList> {
    return this.premium.plans();
  }

  @Get('me/subscription')
  state(@CurrentUser() user: AuthUser, @Query(orgQuery) q: SubscriptionQuery): Promise<SubscriptionState> {
    return this.premium.state(user.userId, q.orgId);
  }

  @Post('me/subscription')
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(subscribeRequestSchema)) body: SubscribeRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubscriptionResponse> {
    const { response, created } = await this.premium.subscribe(user, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }

  @Post('me/subscription/renew')
  async renew(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(renewRequestSchema)) body: RenewRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubscriptionResponse> {
    const { response, created } = await this.premium.renew(user, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }

  @Post('me/subscription/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Query(orgQuery) q: SubscriptionQuery, @ReqMeta() meta: RequestMeta): Promise<SubscriptionState> {
    return this.premium.cancel(user, q.orgId, meta);
  }

  @Put('me/subscription/auto-renew')
  autoRenew(@CurrentUser() user: AuthUser, @Body(new ZodPipe(autoRenewRequestSchema)) body: AutoRenewRequest): Promise<SubscriptionState> {
    return this.premium.setAutoRenew(user, body);
  }

  @Get('me/subscription/payments')
  payments(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: { limit: number; cursor?: string }): Promise<SubscriptionPaymentList> {
    return this.premium.payments(user.userId, q.limit, q.cursor);
  }

  /** Badge public : seulement « Premium ou non ». */
  @Get('users/:userId/premium')
  async badge(@Param('userId') userId: string): Promise<{ premium: boolean }> {
    return { premium: await this.premium.isPremium(userId) };
  }
}

/** Plans, prix et abonnements (administrateurs). */
@Controller('admin')
@Roles('admin')
export class AdminPremiumController {
  constructor(private readonly premium: PremiumService) {}

  @Get('subscription-plans')
  plans(): Promise<SubscriptionPlanList> {
    return this.premium.plans(true);
  }

  @Put('subscription-plans/:code')
  putPlan(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body(new ZodPipe(putPlanRequestSchema)) body: PutPlanRequest, @ReqMeta() meta: RequestMeta): Promise<SubscriptionPlan> {
    return this.premium.putPlan(user, code, body, meta);
  }

  @Get('subscriptions')
  list(@Query(new ZodPipe(adminSubscriptionsQuerySchema)) q: AdminSubscriptionsQuery): Promise<AdminSubscriptionList> {
    return this.premium.adminList(q);
  }

  @Post('subscriptions/renew-due')
  @HttpCode(200)
  async renewDue(): Promise<{ renewed: number }> {
    return { renewed: await this.premium.renewDue() };
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminSubscription> {
    return this.premium.adminCancel(user, id, meta);
  }
}

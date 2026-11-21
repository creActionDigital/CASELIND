import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  type AdBilling,
  type AdCampaign,
  type AdCampaignActionRequest,
  adCampaignActionRequestSchema,
  type AdCampaignList,
  type AdCampaignListQuery,
  adCampaignListQuerySchema,
  type AdCampaignResponse,
  type AdCampaignStats,
  type AdminCampaignList,
  type AdminReviewRequest,
  adminReviewRequestSchema,
  type CreateAdCampaignRequest,
  createAdCampaignRequestSchema,
  type ServeAdsQuery,
  serveAdsQuerySchema,
  type ServedAdList,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { AdsService } from './ads.service.js';

/** Centre publicitaire : campagnes payées en MODE TEST par le portefeuille de test (drapeau `wallet.sandbox`). */
@Controller('ads')
@RequireFlag('wallet.sandbox')
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get('campaigns')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(adCampaignListQuerySchema)) q: AdCampaignListQuery): Promise<AdCampaignList> {
    return this.ads.listMine(user.userId, q);
  }

  @Post('campaigns')
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createAdCampaignRequestSchema)) body: CreateAdCampaignRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdCampaignResponse> {
    const { response, created } = await this.ads.create(user, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }

  @Get('campaigns/:id/stats')
  stats(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AdCampaignStats> {
    return this.ads.stats(user.userId, id);
  }

  @Post('campaigns/:id/action')
  @HttpCode(200)
  act(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(adCampaignActionRequestSchema)) body: AdCampaignActionRequest, @ReqMeta() meta: RequestMeta): Promise<AdCampaign> {
    return this.ads.act(user, id, body, meta);
  }

  @Get('billing')
  billing(@CurrentUser() user: AuthUser): Promise<AdBilling> {
    return this.ads.billing(user.userId);
  }

  @Get('serve')
  serve(@CurrentUser() user: AuthUser, @Query(new ZodPipe(serveAdsQuerySchema)) q: ServeAdsQuery): Promise<ServedAdList> {
    return this.ads.serve(user, q.placement, q.limit);
  }

  @Post('posts/:postId/click')
  @HttpCode(200)
  clickPost(@CurrentUser() user: AuthUser, @Param('postId') postId: string): Promise<{ counted: boolean }> {
    return this.ads.clickPost(user, postId);
  }

  @Post(':id/click')
  @HttpCode(200)
  click(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ counted: boolean }> {
    return this.ads.click(user, id);
  }
}

/** Revue des campagnes avant diffusion (modérateurs et administrateurs). */
@Controller('admin/ads')
@Roles('admin', 'moderator')
export class AdminAdsController {
  constructor(private readonly ads: AdsService) {}

  @Get()
  list(@Query(new ZodPipe(adCampaignListQuerySchema)) q: AdCampaignListQuery): Promise<AdminCampaignList> {
    return this.ads.adminList(q);
  }

  @Post(':id/review')
  @HttpCode(200)
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(adminReviewRequestSchema)) body: AdminReviewRequest, @ReqMeta() meta: RequestMeta): Promise<AdCampaign> {
    return this.ads.review(user, id, body, meta);
  }

  @Post('settle')
  @HttpCode(200)
  async settle(): Promise<{ settled: number }> {
    return { settled: await this.ads.settleEnded() };
  }
}

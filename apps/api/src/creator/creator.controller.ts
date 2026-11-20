import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  type AdminBoost,
  type AdminBoostList,
  type AdminBoostsQuery,
  adminBoostsQuerySchema,
  type BoostPostRequest,
  boostPostRequestSchema,
  type BoostResponse,
  type CreatorOverview,
  type CreatorOverviewQuery,
  creatorOverviewQuerySchema,
  type HashtagList,
  type HashtagSuggestQuery,
  hashtagSuggestQuerySchema,
  type PostList,
  type RecordImpressionsRequest,
  recordImpressionsRequestSchema,
  type RecordImpressionsResponse,
  type SocialPageQuery,
  socialPageQuerySchema,
  type TipRequest,
  tipRequestSchema,
  type TipResponse,
  type TrendingHashtagsQuery,
  trendingHashtagsQuerySchema,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { BookmarksService } from './bookmarks.service.js';
import { BoostsService } from './boosts.service.js';
import { CreatorStatsService } from './creator-stats.service.js';
import { HashtagsService } from './hashtags.service.js';
import { TipsService } from './tips.service.js';

const pageQuery = new ZodPipe(socialPageQuerySchema);

/** Bookmarks, hashtags, reach statistics and the creator dashboard (behind the `social` flag). An invisible post is a 404. */
@Controller()
@RequireFlag('social')
export class CreatorController {
  constructor(
    private readonly bookmarks: BookmarksService,
    private readonly hashtags: HashtagsService,
    private readonly stats: CreatorStatsService,
  ) {}

  @Put('me/bookmarks/posts/:postId')
  @HttpCode(204)
  async addBookmark(@CurrentUser() user: AuthUser, @Param('postId') postId: string): Promise<void> {
    await this.bookmarks.add(user.userId, user.roles, postId);
  }

  @Delete('me/bookmarks/posts/:postId')
  @HttpCode(204)
  async removeBookmark(@CurrentUser() user: AuthUser, @Param('postId') postId: string): Promise<void> {
    await this.bookmarks.remove(user.userId, postId);
  }

  @Get('me/bookmarks/posts')
  listBookmarks(@CurrentUser() user: AuthUser, @Query(pageQuery) q: SocialPageQuery): Promise<PostList> {
    return this.bookmarks.list(user.userId, user.roles, q);
  }

  // Static paths first: `hashtags/trending` and `hashtags/suggest` before `hashtags/:tag/posts`.
  @Get('hashtags/trending')
  trending(@CurrentUser() user: AuthUser, @Query(new ZodPipe(trendingHashtagsQuerySchema)) q: TrendingHashtagsQuery): Promise<HashtagList> {
    return this.hashtags.trending(user.userId, q.hours);
  }

  @Get('hashtags/suggest')
  suggest(@CurrentUser() user: AuthUser, @Query(new ZodPipe(hashtagSuggestQuerySchema)) q: HashtagSuggestQuery): Promise<HashtagList> {
    return this.hashtags.suggest(user.userId, q.q);
  }

  @Get('hashtags/:tag/posts')
  tagPosts(@CurrentUser() user: AuthUser, @Param('tag') tag: string, @Query(pageQuery) q: SocialPageQuery): Promise<PostList> {
    return this.hashtags.tagPosts(user.userId, user.roles, tag, q);
  }

  @Post('posts/impressions')
  @HttpCode(200)
  impressions(@CurrentUser() user: AuthUser, @Body(new ZodPipe(recordImpressionsRequestSchema)) body: RecordImpressionsRequest): Promise<RecordImpressionsResponse> {
    return this.stats.record(user.userId, user.roles, body.postIds);
  }

  @Get('me/creator/overview')
  overview(@CurrentUser() user: AuthUser, @Query(new ZodPipe(creatorOverviewQuerySchema)) q: CreatorOverviewQuery): Promise<CreatorOverview> {
    return this.stats.overview(user.userId, q.days);
  }
}

/** Tips and boosted posts: payments in the SANDBOX wallet (fictitious funds), behind the `wallet.sandbox` flag. */
@Controller()
@RequireFlag('wallet.sandbox')
export class CreatorPaymentsController {
  constructor(
    private readonly tips: TipsService,
    private readonly boosts: BoostsService,
  ) {}

  @Post('posts/:postId/tips')
  async tipPost(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body(new ZodPipe(tipRequestSchema)) body: TipRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TipResponse> {
    const { response, created } = await this.tips.tipPost(user, postId, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }

  @Post('users/:userId/tips')
  async tipUser(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body(new ZodPipe(tipRequestSchema)) body: TipRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TipResponse> {
    const { response, created } = await this.tips.tipUser(user, userId, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }

  @Post('posts/:postId/boost')
  async boost(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body(new ZodPipe(boostPostRequestSchema)) body: BoostPostRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BoostResponse> {
    const { response, created } = await this.boosts.create(user, postId, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }
}

/** Review of boosted posts (moderators and admins). */
@Controller('admin/boosts')
@Roles('admin', 'moderator')
export class AdminBoostsController {
  constructor(private readonly boosts: BoostsService) {}

  @Get()
  list(@Query(new ZodPipe(adminBoostsQuerySchema)) q: AdminBoostsQuery): Promise<AdminBoostList> {
    return this.boosts.adminList(q);
  }

  /** Rejects a running boost and refunds the fictitious budget. */
  @Post(':id/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminBoost> {
    return this.boosts.reject(user, id, meta);
  }
}

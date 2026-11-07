import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateReviewRequest,
  createReviewRequestSchema,
  type OrgReviewList,
  type OrgReviewListQuery,
  orgReviewListQuerySchema,
  type Review,
  type ReviewList,
  type ReviewListQuery,
  reviewListQuerySchema,
  type ReviewReplyRequest,
  reviewReplyRequestSchema,
  type UpdateReviewRequest,
  updateReviewRequestSchema,
} from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { roleHasPermission } from '../orgs/org-permissions.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { ReviewsService } from './reviews.service.js';

/** Verified product reviews (lot 5B). */
@Controller()
@RequireFlag('commerce')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('products/:productId/reviews')
  create(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body(new ZodPipe(createReviewRequestSchema)) body: CreateReviewRequest,
  ): Promise<Review> {
    return this.reviews.create(user.userId, productId, body);
  }

  @Get('products/:productId/reviews')
  list(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Query(new ZodPipe(reviewListQuerySchema)) q: ReviewListQuery,
  ): Promise<ReviewList> {
    return this.reviews.list(user.userId, productId, q);
  }

  @Patch('reviews/:reviewId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('reviewId') reviewId: string,
    @Body(new ZodPipe(updateReviewRequestSchema)) body: UpdateReviewRequest,
  ): Promise<Review> {
    return this.reviews.update(user.userId, reviewId, body);
  }

  @Delete('reviews/:reviewId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('reviewId') reviewId: string): Promise<void> {
    await this.reviews.remove(user.userId, reviewId);
  }

  /** `orders.view` or `catalog.manage` (the guard only checks membership, the role check is here). */
  @Get('orgs/:orgId/reviews')
  @OrgPermission('org.view')
  listForOrg(
    @CurrentMembership() m: OrgMembership,
    @Query(new ZodPipe(orgReviewListQuerySchema)) q: OrgReviewListQuery,
  ): Promise<OrgReviewList> {
    if (!roleHasPermission(m.role, 'orders.view') && !roleHasPermission(m.role, 'catalog.manage')) throw AppError.forbidden();
    return this.reviews.listForOrg(m.orgId, q);
  }

  @Post('orgs/:orgId/reviews/:reviewId/reply')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  reply(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('reviewId') reviewId: string,
    @Body(new ZodPipe(reviewReplyRequestSchema)) body: ReviewReplyRequest,
  ): Promise<Review> {
    return this.reviews.reply(m.orgId, user.userId, reviewId, body);
  }
}

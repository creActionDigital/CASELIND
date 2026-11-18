import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  type AnswerOrgQuestionRequest,
  answerOrgQuestionRequestSchema,
  type AskOrgQuestionRequest,
  askOrgQuestionRequestSchema,
  type MyOrgQuestion,
  type MyOrgQuestionList,
  type MyStoreReview,
  type OrgQuestionList,
  type OrgQuestionListQuery,
  orgQuestionListQuerySchema,
  pageQuerySchema,
  type PageQuery,
  type PublicOrgQuestionList,
  type SaveStoreReviewRequest,
  saveStoreReviewRequestSchema,
  type StoreReview,
  type StoreReviewList,
  type StoreReviewListQuery,
  type StoreReviewReplyRequest,
  storeReviewListQuerySchema,
  storeReviewReplyRequestSchema,
} from '@caselind/contracts';
import type { Request } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Public } from '../security/auth.guard.js';
import { SessionVerifier } from '../security/session-verifier.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from './org.guard.js';
import { OrgFeedbackService } from './org-feedback.service.js';

/** Staff side: reviews of the organisation (reply) and visitor questions (answer, delete). */
@Controller('orgs/:orgId')
export class OrgFeedbackController {
  constructor(private readonly feedback: OrgFeedbackService) {}

  @Get('store-reviews')
  @OrgPermission('org.view')
  reviews(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(storeReviewListQuerySchema)) q: StoreReviewListQuery): Promise<StoreReviewList> {
    return this.feedback.staffReviews(m.orgId, q);
  }

  /** Same permission as the replies to product reviews. */
  @Post('store-reviews/:id/reply')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  reply(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(storeReviewReplyRequestSchema)) b: StoreReviewReplyRequest, @ReqMeta() meta: RequestMeta): Promise<StoreReview> {
    return this.feedback.replyReview(m.orgId, u.userId, id, b.body, meta);
  }

  @Get('questions')
  @OrgPermission('org.view')
  questions(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(orgQuestionListQuerySchema)) q: OrgQuestionListQuery): Promise<OrgQuestionList> {
    return this.feedback.staffQuestions(m.orgId, q);
  }

  @Post('questions/:id/answer')
  @HttpCode(204)
  @OrgPermission('org.profile.edit')
  answer(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(answerOrgQuestionRequestSchema)) b: AnswerOrgQuestionRequest, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.feedback.answer(m.orgId, u.userId, id, b.answer, meta);
  }

  @Delete('questions/:id')
  @HttpCode(204)
  @OrgPermission('org.profile.edit')
  removeQuestion(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.feedback.removeQuestion(m.orgId, u.userId, id, meta);
  }
}

/** The caller's own review of an organisation and own questions. */
@Controller('me')
export class MyOrgFeedbackController {
  constructor(private readonly feedback: OrgFeedbackService) {}

  @Get('org-reviews/:orgId')
  myReview(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string): Promise<MyStoreReview> {
    return this.feedback.myReview(u.userId, orgId);
  }

  @Put('org-reviews/:orgId')
  saveReview(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body(new ZodPipe(saveStoreReviewRequestSchema)) b: SaveStoreReviewRequest, @ReqMeta() meta: RequestMeta): Promise<StoreReview> {
    return this.feedback.saveReview(u.userId, orgId, b, meta);
  }

  @Delete('org-reviews/:orgId')
  @HttpCode(204)
  deleteReview(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.feedback.deleteReview(u.userId, orgId, meta);
  }

  @Post('org-questions')
  ask(@CurrentUser() u: AuthUser, @Body(new ZodPipe(askOrgQuestionRequestSchema)) b: AskOrgQuestionRequest, @ReqMeta() meta: RequestMeta): Promise<MyOrgQuestion> {
    return this.feedback.ask(u.userId, b.orgId, b.question, meta);
  }

  @Get('org-questions')
  myQuestions(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<MyOrgQuestionList> {
    return this.feedback.myQuestions(u.userId, q);
  }
}

/** Public side: no token, so the page can be shared and indexed. A valid token only skips blocked review authors. */
@Controller('public/orgs')
export class PublicOrgFeedbackController {
  constructor(
    private readonly feedback: OrgFeedbackService,
    private readonly verifier: SessionVerifier,
  ) {}

  @Get(':slug/reviews')
  @Public()
  async reviews(@Param('slug') slug: string, @Query(new ZodPipe(storeReviewListQuerySchema)) q: StoreReviewListQuery, @Req() req: Request): Promise<StoreReviewList> {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    const viewer = scheme === 'Bearer' && token ? await this.verifier.verify(token) : null;
    return this.feedback.publicReviews(slug, q, viewer?.userId ?? null);
  }

  @Get(':slug/questions')
  @Public()
  questions(@Param('slug') slug: string, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<PublicOrgQuestionList> {
    return this.feedback.publicQuestions(slug, q);
  }
}

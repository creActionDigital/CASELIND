import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  type Comment,
  type CommentList,
  type CreateCommentRequest,
  createCommentRequestSchema,
  type CreatePostRequest,
  createPostRequestSchema,
  type Post as PostDto,
  type PostList,
  type SetReactionRequest,
  setReactionRequestSchema,
  type SocialPageQuery,
  socialPageQuerySchema,
  type SocialStats,
  type SocialUserList,
  type UpdatePostRequest,
  updatePostRequestSchema,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ZodPipe } from '../common/zod.pipe.js';
import { BoostsService } from '../creator/boosts.service.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { CommentsService } from './comments.service.js';
import { FollowsService } from './follows.service.js';
import { PostsService } from './posts.service.js';

const pageQuery = new ZodPipe(socialPageQuerySchema);

/** Follows, posts, feed, reactions and comments (lot 4A). An invisible item is a 404. */
@Controller()
@RequireFlag('social')
export class SocialController {
  constructor(
    private readonly follows: FollowsService,
    private readonly posts: PostsService,
    private readonly comments: CommentsService,
    private readonly boosts: BoostsService,
  ) {}

  // ---- follows ----
  @Put('users/:userId/follow')
  @HttpCode(204)
  async follow(@CurrentUser() user: AuthUser, @Param('userId') userId: string): Promise<void> {
    await this.follows.follow(user.userId, userId);
  }

  @Delete('users/:userId/follow')
  @HttpCode(204)
  async unfollow(@CurrentUser() user: AuthUser, @Param('userId') userId: string): Promise<void> {
    await this.follows.unfollow(user.userId, userId);
  }

  @Get('users/:userId/social')
  stats(@CurrentUser() user: AuthUser, @Param('userId') userId: string): Promise<SocialStats> {
    return this.follows.stats(user.userId, userId);
  }

  @Get('users/:userId/followers')
  followers(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Query(pageQuery) q: SocialPageQuery): Promise<SocialUserList> {
    return this.follows.followers(user.userId, userId, q);
  }

  @Get('users/:userId/following')
  following(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Query(pageQuery) q: SocialPageQuery): Promise<SocialUserList> {
    return this.follows.following(user.userId, userId, q);
  }

  @Get('users/:userId/posts')
  userPosts(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Query(pageQuery) q: SocialPageQuery): Promise<PostList> {
    return this.posts.userPosts(user.userId, user.roles, userId, q);
  }

  // ---- feed ----
  @Get('feed')
  /** The feed, with at most one labelled sponsored post (`sponsored: true`) per 10 posts. */
  async feed(@CurrentUser() user: AuthUser, @Query(pageQuery) q: SocialPageQuery): Promise<PostList> {
    return this.boosts.injectSponsored(user, await this.posts.feed(user.userId, user.roles, q));
  }

  @Get('feed/videos')
  videos(@CurrentUser() user: AuthUser, @Query(pageQuery) q: SocialPageQuery): Promise<PostList> {
    return this.posts.videoFeed(user.userId, user.roles, q);
  }

  // ---- posts ----
  /** 201 for a new post; 200 when the clientId was already used (the stored post is returned). */
  @Post('posts')
  async createPost(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createPostRequestSchema)) body: CreatePostRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PostDto> {
    const { post, created } = await this.posts.create(user.userId, user.roles, body);
    res.status(created ? 201 : 200);
    return post;
  }

  @Get('posts/:id')
  getPost(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<PostDto> {
    return this.posts.get(user.userId, user.roles, id);
  }

  @Patch('posts/:id')
  updatePost(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updatePostRequestSchema)) body: UpdatePostRequest,
  ): Promise<PostDto> {
    return this.posts.update(user.userId, user.roles, id, body);
  }

  @Delete('posts/:id')
  @HttpCode(204)
  async deletePost(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.posts.remove(user.userId, user.roles, id);
  }

  @Put('posts/:id/reaction')
  setReaction(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(setReactionRequestSchema)) body: SetReactionRequest,
  ): Promise<PostDto> {
    return this.posts.setReaction(user.userId, user.roles, id, body.type);
  }

  // ---- comments ----
  @Get('posts/:id/comments')
  listComments(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query(pageQuery) q: SocialPageQuery): Promise<CommentList> {
    return this.comments.list(user.userId, user.roles, id, q);
  }

  @Post('posts/:id/comments')
  createComment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(createCommentRequestSchema)) body: CreateCommentRequest,
  ): Promise<Comment> {
    return this.comments.create(user.userId, user.roles, id, body);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  async deleteComment(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.comments.remove(user.userId, user.roles, id);
  }
}

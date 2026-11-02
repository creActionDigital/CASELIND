import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  type CreateStoryRequest,
  createStoryRequestSchema,
  type Story,
  type StoryFeed,
  type StoryList,
  type StoryPage,
  type StoryPageQuery,
  storyPageQuerySchema,
  type StoryViewerList,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { StoriesService } from './stories.service.js';

/** Story routes. A story the caller may not see (expired, hidden, blocked, other audience) is a 404. */
@Controller()
@RequireFlag('social.stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  /** 201 when created; 200 when the clientId was already used (the stored story is returned). */
  @Post('stories')
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createStoryRequestSchema)) body: CreateStoryRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Story> {
    const { story, created } = await this.stories.create(user.userId, body);
    res.status(created ? 201 : 200);
    return story;
  }

  @Get('stories/feed')
  feed(@CurrentUser() user: AuthUser): Promise<StoryFeed> {
    return this.stories.feed(user.userId);
  }

  @Get('users/:userId/stories')
  ofUser(@CurrentUser() user: AuthUser, @Param('userId') userId: string): Promise<StoryList> {
    return this.stories.ofUser(user.userId, userId);
  }

  @Get('me/stories/archive')
  archive(@CurrentUser() user: AuthUser, @Query(new ZodPipe(storyPageQuerySchema)) q: StoryPageQuery): Promise<StoryPage> {
    return this.stories.archive(user.userId, q);
  }

  @Post('stories/:id/view')
  @HttpCode(204)
  async view(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.stories.view(user.userId, id);
  }

  @Get('stories/:id/viewers')
  viewers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodPipe(storyPageQuerySchema)) q: StoryPageQuery,
  ): Promise<StoryViewerList> {
    return this.stories.viewers(user.userId, id, q);
  }

  @Delete('stories/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.stories.remove(user.userId, id);
  }
}

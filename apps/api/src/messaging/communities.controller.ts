import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  type Community,
  type CommunityList,
  type CommunityListQuery,
  communityListQuerySchema,
  type PublishCommunityRequest,
  publishCommunityRequestSchema,
  type TrendingTags,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { CommunitiesService } from './communities.service.js';

/** Public communities: browse, trending tags, join. */
@Controller('communities')
@RequireFlag('messaging')
export class CommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(communityListQuerySchema)) q: CommunityListQuery): Promise<CommunityList> {
    return this.communities.list(user.userId, q);
  }

  @Get('tags')
  tags(): Promise<TrendingTags> {
    return this.communities.trendingTags();
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Community> {
    return this.communities.get(user.userId, id);
  }

  @Post(':id/join')
  @HttpCode(200)
  join(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Community> {
    return this.communities.join(user.userId, id, meta);
  }
}

/** Publishing is a group owner's action, so it lives under the conversation. */
@Controller('conversations/:id/community')
@RequireFlag('messaging')
export class ConversationCommunityController {
  constructor(private readonly communities: CommunitiesService) {}

  @Put()
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(publishCommunityRequestSchema)) body: PublishCommunityRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Community> {
    return this.communities.publish(user.userId, id, body, meta);
  }

  @Delete()
  @HttpCode(204)
  async unpublish(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.communities.unpublish(user.userId, id, meta);
  }
}

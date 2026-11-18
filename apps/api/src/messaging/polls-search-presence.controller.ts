import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  type CreatePollRequest,
  createPollRequestSchema,
  type Message,
  type MessageSearchQuery,
  messageSearchQuerySchema,
  type MessageSearchResult,
  type PollVoteRequest,
  pollVoteRequestSchema,
  type Presence,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { MessageSearchService } from './message-search.service.js';
import { PollsService } from './polls.service.js';
import { PresenceService } from './presence.service.js';

/** Name of the poll-creation handler: it shares the `messaging` throttler with message sending (app.module.ts). */
export const CREATE_POLL_HANDLER = 'createPoll';
/** Name of the search handler (own budget in app.module.ts). */
export const MESSAGE_SEARCH_HANDLER = 'searchMessages';

@Controller('conversations')
@RequireFlag('messaging')
export class ConversationPollsController {
  constructor(private readonly polls: PollsService) {}

  /** 201 for a new poll; 200 when the clientId was already used (the stored message is returned). */
  @Post(':id/polls')
  async createPoll(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(createPollRequestSchema)) body: CreatePollRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Message> {
    const { message, created } = await this.polls.create(user.userId, id, body, meta);
    res.status(created ? 201 : 200);
    return message;
  }
}

@Controller('messages')
@RequireFlag('messaging')
export class MessagePollsController {
  constructor(
    private readonly polls: PollsService,
    private readonly search: MessageSearchService,
  ) {}

  @Get('search')
  searchMessages(@CurrentUser() user: AuthUser, @Query(new ZodPipe(messageSearchQuerySchema)) query: MessageSearchQuery): Promise<MessageSearchResult> {
    return this.search.search(user.userId, query);
  }

  @Put(':id/poll/vote')
  vote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(pollVoteRequestSchema)) body: PollVoteRequest,
  ): Promise<Message> {
    return this.polls.vote(user.userId, id, body.optionIds);
  }

  @Post(':id/poll/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Message> {
    return this.polls.close(user.userId, id, meta);
  }
}

@Controller('presence')
@RequireFlag('messaging')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get(':userId')
  get(@CurrentUser() user: AuthUser, @Param('userId') userId: string): Promise<Presence> {
    return this.presence.get(user.userId, userId);
  }
}

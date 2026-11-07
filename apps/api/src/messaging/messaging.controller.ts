import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  type AddConversationMembersRequest,
  addConversationMembersRequestSchema,
  type Conversation,
  type ConversationList,
  type ConversationListQuery,
  conversationListQuerySchema,
  type ConversationMember,
  type ConversationMemberList,
  type CreateConversationRequest,
  createConversationRequestSchema,
  type DraftRequest,
  draftRequestSchema,
  type Draft,
  type FavoriteList,
  type FavoriteListQuery,
  favoriteListQuerySchema,
  type ForwardMessageRequest,
  forwardMessageRequestSchema,
  type ForwardMessageResponse,
  type Message,
  type MessageList,
  type MessageListQuery,
  messageListQuerySchema,
  type ScheduledMessage,
  type ScheduledMessageList,
  type ReactionRequest,
  reactionRequestSchema,
  type ReceiptRequest,
  receiptRequestSchema,
  type ReceiptState,
  type RecallQuery,
  recallQuerySchema,
  type SendMessageRequest,
  sendMessageRequestSchema,
  type UpdateConversationMemberRequest,
  updateConversationMemberRequestSchema,
  type UpdateConversationRequest,
  updateConversationRequestSchema,
  type UpdateMyConversationStateRequest,
  updateMyConversationStateRequestSchema,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { ConversationsService } from './conversations.service.js';
import { ConversationMembersService } from './members.service.js';
import { MessageExtrasService } from './message-extras.service.js';
import { MessagesService } from './messages.service.js';
import { ScheduledMessagesService } from './scheduled-messages.service.js';

/** Name of the send handler: the `messaging` throttler (app.module.ts) applies to it alone. */
export const SEND_MESSAGE_HANDLER = 'send';

/**
 * Messaging routes. A conversation the caller is not an active member of (or a malformed id) is
 * a 404, like organisations: its existence is never revealed.
 */
@Controller('conversations')
@RequireFlag('messaging')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly members: ConversationMembersService,
    private readonly messages: MessagesService,
    private readonly extras: MessageExtrasService,
    private readonly scheduled: ScheduledMessagesService,
  ) {}

  /** 201 when created; 200 when the direct conversation with that user already existed. */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createConversationRequestSchema)) body: CreateConversationRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Conversation> {
    const { conversation, created } = await this.conversations.create(user.userId, body, meta);
    res.status(created ? 201 : 200);
    return conversation;
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(conversationListQuerySchema)) query: ConversationListQuery,
  ): Promise<ConversationList> {
    return this.conversations.list(user.userId, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Conversation> {
    return this.conversations.getFor(user.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateConversationRequestSchema)) body: UpdateConversationRequest,
  ): Promise<Conversation> {
    return this.conversations.update(user.userId, id, body);
  }

  @Patch(':id/me')
  updateMe(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateMyConversationStateRequestSchema)) body: UpdateMyConversationStateRequest,
  ): Promise<Conversation> {
    return this.conversations.updateMyState(user.userId, id, body);
  }

  @Get(':id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodPipe(messageListQuerySchema)) query: MessageListQuery,
  ): Promise<MessageList> {
    return this.messages.list(user.userId, id, query);
  }

  /** 201 for a new message, 200 when the clientId was already used (the stored message is returned). */
  @Post(':id/messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(sendMessageRequestSchema)) body: SendMessageRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Message | ScheduledMessage> {
    if (body.scheduledAt) {
      // Lot 3b: nothing is visible and no seq exists until the job sends it (202 new, 200 replay).
      const { scheduled, created } = await this.scheduled.schedule(user.userId, id, body);
      res.status(created ? 202 : 200);
      return scheduled;
    }
    const { message, created } = await this.messages.send(user.userId, id, body);
    res.status(created ? 201 : 200);
    return message;
  }

  @Put(':id/draft')
  putDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(draftRequestSchema)) body: DraftRequest,
  ): Promise<Draft> {
    return this.extras.putDraft(user.userId, id, body.body);
  }

  @Get(':id/draft')
  getDraft(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Draft> {
    return this.extras.getDraft(user.userId, id);
  }

  @Delete(':id/draft')
  @HttpCode(204)
  async deleteDraft(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.extras.deleteDraft(user.userId, id);
  }

  @Post(':id/delivered')
  @HttpCode(200)
  delivered(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(receiptRequestSchema)) body: ReceiptRequest,
  ): Promise<ReceiptState> {
    return this.conversations.receipt(user.userId, id, 'delivered', body.seq);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(receiptRequestSchema)) body: ReceiptRequest,
  ): Promise<ReceiptState> {
    return this.conversations.receipt(user.userId, id, 'read', body.seq);
  }

  @Get(':id/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ConversationMemberList> {
    return this.members.list(user.userId, id);
  }

  @Post(':id/members')
  addMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(addConversationMembersRequestSchema)) body: AddConversationMembersRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ConversationMemberList> {
    return this.members.add(user.userId, id, body.userIds, meta);
  }

  @Patch(':id/members/:userId')
  setRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body(new ZodPipe(updateConversationMemberRequestSchema)) body: UpdateConversationMemberRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ConversationMember> {
    return this.members.setRole(user.userId, id, userId, body.role, meta);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.members.remove(user.userId, id, userId, meta);
  }
}

@Controller('messages')
@RequireFlag('messaging')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly extras: MessageExtrasService,
  ) {}

  @Post(':id/forward')
  @HttpCode(200)
  forward(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(forwardMessageRequestSchema)) body: ForwardMessageRequest,
  ): Promise<ForwardMessageResponse> {
    return this.extras.forward(user.userId, id, body);
  }

  @Put(':id/favorite')
  @HttpCode(204)
  async favorite(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.extras.addFavorite(user.userId, id);
  }

  @Delete(':id/favorite')
  @HttpCode(204)
  async unfavorite(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.extras.removeFavorite(user.userId, id);
  }

  @Put(':id/reaction')
  react(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(reactionRequestSchema)) body: ReactionRequest,
  ): Promise<Message> {
    return this.messages.react(user.userId, id, body.emoji);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodPipe(recallQuerySchema)) query: RecallQuery,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.messages.remove(user.userId, id, query.scope, meta);
  }
}

/** Lot 3b: the caller's favourite messages and scheduled messages. */
@Controller('me')
@RequireFlag('messaging')
export class MessagingMeController {
  constructor(
    private readonly extras: MessageExtrasService,
    private readonly scheduled: ScheduledMessagesService,
  ) {}

  @Get('favorites')
  favorites(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(favoriteListQuerySchema)) query: FavoriteListQuery,
  ): Promise<FavoriteList> {
    return this.extras.listFavorites(user.userId, query);
  }

  @Get('scheduled-messages')
  listScheduled(@CurrentUser() user: AuthUser): Promise<ScheduledMessageList> {
    return this.scheduled.list(user.userId);
  }

  @Delete('scheduled-messages/:id')
  @HttpCode(204)
  async cancelScheduled(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.scheduled.cancel(user.userId, id);
  }
}

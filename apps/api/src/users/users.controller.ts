import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  handleSchema,
  type MatchContactsRequest,
  type MatchContactsResponse,
  matchContactsRequestSchema,
  type Me,
  type PublicProfile,
  type SecurityEvent,
  type UpdateMeRequest,
  updateMeRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { UsersService } from './users.service.js';

export const MATCH_CONTACTS_HANDLER = 'matchContacts';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.users.me(user.userId);
  }

  @Patch('me')
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateMeRequestSchema)) body: UpdateMeRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Me> {
    return this.users.updateMe(user.userId, body, meta);
  }

  @Get('me/security-events')
  async securityEvents(@CurrentUser() user: AuthUser): Promise<{ items: SecurityEvent[] }> {
    return { items: await this.users.securityEvents(user.userId) };
  }

  /** Phone-book numbers (E.164) -> users who allow discovery by phone. Numbers are never stored. */
  @Post('users/match-contacts')
  @HttpCode(200)
  matchContacts(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(matchContactsRequestSchema)) body: MatchContactsRequest,
  ): Promise<MatchContactsResponse> {
    return this.users.matchContacts(user.userId, body.phones);
  }

  /** `:handle` is a handle or a user id (the mobile profile screens open users by id). */
  @Get('users/:handle')
  profile(
    @CurrentUser() user: AuthUser,
    @Param('handle', new ZodPipe(z.union([z.uuid(), handleSchema]))) handle: string,
  ): Promise<PublicProfile> {
    return this.users.publicProfile(handle, user.userId);
  }
}

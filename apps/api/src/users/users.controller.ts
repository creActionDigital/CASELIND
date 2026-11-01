import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  handleSchema,
  type Me,
  type PublicProfile,
  type SecurityEvent,
  type UpdateMeRequest,
  updateMeRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { UsersService } from './users.service.js';

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

  @Get('users/:handle')
  profile(
    @CurrentUser() user: AuthUser,
    @Param('handle', new ZodPipe(handleSchema)) handle: string,
  ): Promise<PublicProfile> {
    return this.users.publicProfile(handle, user.userId);
  }
}

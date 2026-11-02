import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type NotificationList,
  type NotificationListQuery,
  notificationListQuerySchema,
  type NotificationPreferences,
  type RegisterPushTokenRequest,
  registerPushTokenRequestSchema,
  type UnreadCount,
  type UnregisterPushTokenRequest,
  unregisterPushTokenRequestSchema,
  type UpdateNotificationPreferencesRequest,
  updateNotificationPreferencesRequestSchema,
} from '@caselind/contracts';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Put('me/push-tokens')
  @HttpCode(204)
  async registerToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(registerPushTokenRequestSchema)) body: RegisterPushTokenRequest,
  ): Promise<void> {
    await this.notifications.registerToken(user.userId, user.sessionId, body.token, body.platform);
  }

  @Post('me/push-tokens/unregister')
  @HttpCode(204)
  async unregisterToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(unregisterPushTokenRequestSchema)) body: UnregisterPushTokenRequest,
  ): Promise<void> {
    await this.notifications.unregisterToken(user.userId, body.token);
  }

  @Get('notifications')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(notificationListQuerySchema)) query: NotificationListQuery,
  ): Promise<NotificationList> {
    return this.notifications.list(user.userId, query);
  }

  @Get('notifications/unread-count')
  async unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCount> {
    return { count: await this.notifications.unreadCount(user.userId) };
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.notifications.markAllRead(user.userId);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(user.userId, id);
  }

  @Get('me/notification-preferences')
  preferences(@CurrentUser() user: AuthUser): Promise<NotificationPreferences> {
    return this.notifications.getPreferences(user.userId);
  }

  @Patch('me/notification-preferences')
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateNotificationPreferencesRequestSchema)) body: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> {
    return this.notifications.updatePreferences(user.userId, body);
  }
}

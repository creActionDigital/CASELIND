import { randomUUID } from 'node:crypto';
import { type DynamicModule, Logger, Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AccountController } from './account/account.controller.js';
import { AccountService } from './account/account.service.js';
import { AdminController } from './admin/admin.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { ConsoleOtpSender, OtpSender } from './auth/otp-sender.js';
import { OtpService } from './auth/otp.service.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ENV, type Env } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { FlagGuard } from './flags/flag.guard.js';
import { AdminFlagsController, ConfigController } from './flags/flags.controller.js';
import { FlagsService } from './flags/flags.service.js';
import { HealthController } from './health/health.controller.js';
import { ExpoPushGateway } from './notifications/expo-push.gateway.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { LogPushGateway, PushGateway } from './notifications/push-gateway.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { ConversationRoomsResolver, RealtimeService } from './realtime/realtime.service.js';
import { HttpThrottlerGuard } from './security/http-throttler.guard.js';
import { SessionVerifier } from './security/session-verifier.js';
// Lot 3A (messaging), separate import block to limit merge conflicts with parallel work.
import { ContactsService } from './messaging/contacts.service.js';
import { ConversationsService } from './messaging/conversations.service.js';
import { ConversationMembersService } from './messaging/members.service.js';
import { MessagesService } from './messaging/messages.service.js';
import { ConversationsController, MessagesController, SEND_MESSAGE_HANDLER } from './messaging/messaging.controller.js';
import { MessagingRooms } from './messaging/rooms.js';
import { ModerationRegistry } from './moderation/moderation-registry.js';
import { RelationsService } from './social/relations.service.js';
// Lot 4A (social), separate import block to limit merge conflicts with parallel work.
import { CommentsService } from './social/comments.service.js';
import { FollowsService } from './social/follows.service.js';
import { PostsService } from './social/posts.service.js';
import { SocialModerationTargets } from './social/social-moderation.js';
import { SocialController } from './social/social.controller.js';
// Lot 4B (stories, reports, moderation).
import { MessageModerationTarget } from './moderation/message-moderation.target.js';
import { CREATE_REPORT_HANDLER, ModerationController, ReportsController } from './moderation/moderation.controller.js';
import { ModerationService } from './moderation/moderation.service.js';
import { StoriesController } from './stories/stories.controller.js';
import { StoriesService } from './stories/stories.service.js';
import { StoryAccessService } from './stories/story-access.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { AvatarController } from './media/avatar.controller.js';
import { MEDIA_THROTTLED_HANDLERS, MediaController } from './media/media.controller.js';
import { MediaService } from './media/media.service.js';
import { LocalDiskStorage, MediaStorage } from './media/storage.js';
import { OpenApiController } from './openapi/openapi.controller.js';
import { OrgGuard } from './orgs/org.guard.js';
import { OrgMembersService } from './orgs/org-members.service.js';
import { MyOrgsController, OrgsController, PublicOrgsController } from './orgs/orgs.controller.js';
import { OrgsService } from './orgs/orgs.service.js';
import { PrivacyController } from './privacy/privacy.controller.js';
import { PrivacyService } from './privacy/privacy.service.js';
import { AuthGuard } from './security/auth.guard.js';
import { PasswordService } from './security/password.service.js';
import { TokenService } from './security/token.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

export interface AppModuleOptions {
  env: Env;
  /** Overrides the OTP delivery adapter (tests capture codes this way). */
  otpSender?: OtpSender;
  /** Test-only: extra controllers mounted behind the same global guards (e.g. a @RequireFlag probe). */
  extraControllers?: Type[];
  /** Overrides the push provider adapter (tests capture pushes this way; never any network). */
  pushGateway?: PushGateway;
}

@Module({})
export class AppModule {
  static forRoot({ env, otpSender, extraControllers = [], pushGateway }: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        { module: class EnvModule {}, global: true, providers: [{ provide: ENV, useValue: env }], exports: [ENV] },
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            // Never log credentials. Bodies are not logged by pino-http.
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          },
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
            {
              // Stricter budget for credential and OTP endpoints (brute force, SMS pumping).
              name: 'auth',
              ttl: 60_000,
              limit: env.AUTH_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) => ctx.getClass() !== AuthController,
            },
            {
              // Upload announce / bytes / token re-issue: each one costs disk and a database row.
              name: 'media',
              ttl: 60_000,
              limit: env.MEDIA_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) =>
                ctx.getClass() !== MediaController || !MEDIA_THROTTLED_HANDLERS.has(ctx.getHandler().name),
            },
            {
              // Message sending only: every message is a write plus a fan-out to the room and pushes.
              name: 'messaging',
              ttl: 60_000,
              limit: env.MESSAGING_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) =>
                ctx.getType() !== 'http' ||
                ctx.getClass() !== ConversationsController ||
                ctx.getHandler().name !== SEND_MESSAGE_HANDLER,
            },
            {
              // Lot 4B: filing reports only.
              name: 'reports',
              ttl: 60_000,
              limit: env.REPORTS_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) =>
                ctx.getType() !== 'http' ||
                ctx.getClass() !== ReportsController ||
                ctx.getHandler().name !== CREATE_REPORT_HANDLER,
            },
          ],
        }),
        DbModule,
        // Without ScheduleModule the @Interval jobs (MaintenanceService) are never started.
        ...(env.MAINTENANCE_ENABLED ? [ScheduleModule.forRoot()] : []),
      ],
      controllers: [
        HealthController,
        OpenApiController,
        AuthController,
        UsersController,
        AdminController,
        ConfigController,
        AdminFlagsController,
        PrivacyController,
        AccountController,
        OrgsController,
        MyOrgsController,
        PublicOrgsController,
        MediaController,
        AvatarController,
        ConversationsController,
        MessagesController,
        NotificationsController,
        SocialController,
        StoriesController,
        ReportsController,
        ModerationController,
        ...extraControllers,
      ],
      providers: [
        PasswordService,
        TokenService,
        AuditService,
        OtpService,
        AuthService,
        UsersService,
        FlagsService,
        MaintenanceService,
        PrivacyService,
        AccountService,
        OrgsService,
        OrgMembersService,
        // Route-level guard attached by @OrgPermission (runs after the global guards below).
        OrgGuard,
        MediaService,
        // Only adapter until the object storage provider is chosen (BACKLOG Q6).
        { provide: MediaStorage, inject: [ENV], useFactory: (e: Env) => new LocalDiskStorage(e.MEDIA_STORAGE_DIR) },
        // Lot 3: realtime fan-out and notifications (ports shared by messaging and later lots).
        RealtimeService,
        // Lot 4: follow graph (implemented by the social module) and moderation registry.
        RelationsService,
        ModerationRegistry,
        FollowsService,
        PostsService,
        CommentsService,
        SocialModerationTargets,
        StoryAccessService,
        StoriesService,
        ModerationService,
        MessageModerationTarget,
        RealtimeGateway,
        SessionVerifier,
        NotificationsService,
        {
          provide: PushGateway,
          useFactory: (): PushGateway => {
            if (pushGateway) return pushGateway;
            if (env.PUSH_PROVIDER === 'expo') return new ExpoPushGateway(env.EXPO_ACCESS_TOKEN);
            if (env.NODE_ENV === 'production') {
              new Logger('PushGateway').warn('PUSH_PROVIDER=log in production: no push notification will be delivered');
            }
            return new LogPushGateway();
          },
        },
        // Provided by the messaging module.
        ContactsService,
        ConversationsService,
        ConversationMembersService,
        MessagesService,
        { provide: ConversationRoomsResolver, useClass: MessagingRooms },
        { provide: OtpSender, useValue: otpSender ?? new ConsoleOtpSender() },
        { provide: APP_GUARD, useClass: HttpThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        // Must stay after AuthGuard: global guards run in registration order and it needs req.auth.
        { provide: APP_GUARD, useClass: FlagGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}

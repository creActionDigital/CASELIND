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
import { createOtpSender } from './auth/otp/otp-sender.factory.js';
import { OtpSender } from './auth/otp-sender.js';
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
import { LOG_REDACT_PATHS, scrubLoggedRequest } from './common/log-scrub.js';
import { HttpThrottlerGuard } from './security/http-throttler.guard.js';
import { SessionVerifier } from './security/session-verifier.js';
// Lot 3A (messaging), separate import block to limit merge conflicts with parallel work.
import { ContactsService } from './messaging/contacts.service.js';
import { ConversationsService } from './messaging/conversations.service.js';
import { CommunitiesController, ConversationCommunityController } from './messaging/communities.controller.js';
import { CommunitiesService } from './messaging/communities.service.js';
import { FinanceController } from './finance/finance.controller.js';
import { FinanceService } from './finance/finance.service.js';
import { ListingsController } from './listings/listings.controller.js';
import { ListingsService } from './listings/listings.service.js';
import { ConversationMembersService } from './messaging/members.service.js';
import { MessagesService } from './messaging/messages.service.js';
import { MessageExtrasService } from './messaging/message-extras.service.js';
import { ScheduledMessagesService } from './messaging/scheduled-messages.service.js';
import { ConversationsController, MessagesController, MessagingMeController, SEND_MESSAGE_HANDLER } from './messaging/messaging.controller.js';
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
import { CatalogPort } from './commerce/catalog.port.js';
// Lot 5B (cart, orders, coupons, reviews), separate import block.
import { CartController } from './cart/cart.controller.js';
import { CartService } from './cart/cart.service.js';
import { CouponsService } from './orders/coupons.service.js';
import { OrdersController, OrgOrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { PaymentMethods } from './orders/payment-methods.js';
import { ReviewsController } from './reviews/reviews.controller.js';
import { ReviewsService } from './reviews/reviews.service.js';
// Lot 7 (places, universal search), separate import block.
import { PlacesController } from './places/places.controller.js';
import { PlacesService } from './places/places.service.js';
// Lot 9 (services and bookings), separate import block.
import { BookingsService } from './services/bookings.service.js';
import { BookingsController, ServicesController } from './services/services.controller.js';
import { ServicesService } from './services/services.service.js';
import { SearchHistoryService } from './search/search-history.service.js';
// Lot 10 (mini-apps), separate import block.
import { AdminMiniAppsController, MiniAppApiController, MiniAppDirectoryController, MyMiniAppsController, OAUTH_TOKEN_HANDLER, OAuthController, OrgMiniAppsController } from './miniapps/miniapps.controller.js';
import { MiniAppApiService } from './miniapps/miniapp-api.service.js';
import { MiniAppTokenGuard } from './miniapps/miniapp-token.guard.js';
import { MiniAppsService } from './miniapps/miniapps.service.js';
import { OAuthService } from './miniapps/oauth.service.js';
import { SEARCH_HANDLER, SearchController } from './search/search.controller.js';
import { SearchService } from './search/search.service.js';
// Lot 5A (catalogue), separate import block.
import { CatalogModerationTarget } from './catalog/catalog-moderation.js';
import { CatalogPortImpl } from './catalog/catalog-port.impl.js';
import { CatalogController, PublicCatalogController, StorefrontController } from './catalog/catalog.controller.js';
import { CatalogService } from './catalog/catalog.service.js';
import { StorefrontService } from './catalog/storefront.service.js';
import { KycPort } from './wallet/kyc.port.js';
import { LedgerPort } from './wallet/ledger.port.js';
// Lot 6A (ledger, sandbox wallet), separate import block.
import { LedgerService } from './ledger/ledger.service.js';
import { AdminLedgerController, OrgWalletController, WalletController } from './ledger/wallet.controller.js';
import { WalletService } from './ledger/wallet.service.js';
import { PinVerifier } from './wallet/pin.port.js';
// Lot 6B (KYC, payment PIN, merchant QR), separate import block.
import { AdminKycController, KycController } from './kyc/kyc.controller.js';
import { KycCrypto } from './kyc/kyc-crypto.js';
import { KycService } from './kyc/kyc.service.js';
import { PinService } from './kyc/pin.service.js';
import { OrgPaymentQrController, WalletQrController } from './payments-qr/payment-qr.controller.js';
import { PaymentQrService } from './payments-qr/payment-qr.service.js';
import { QrSigner } from './payments-qr/qr-signer.js';
// Lot 1c (2FA TOTP, identifier change, QR web login), separate import block.
import { IdentifierChangeService } from './auth/identity/identifier-change.service.js';
import {
  IdentifierChangeController,
  QR_CREATE_HANDLER,
  QR_POLL_HANDLER,
  QrLoginController,
  TwoFactorController,
} from './auth/identity/identity.controller.js';
import { QrLoginService } from './auth/identity/qr-login.service.js';
import { TotpCrypto } from './auth/identity/totp-crypto.js';
import { TwoFactorService } from './auth/identity/two-factor.service.js';
// Lot 11 (mobility), separate import block.
import { AdminMobilityController, MobilityDriverController, MobilityJobs, RidesController } from './mobility/mobility.controller.js';
import { MobilityService } from './mobility/mobility.service.js';
import { RideCodes } from './mobility/mobility.shared.js';
// Lot 12 (AI assistant), separate import block.
import { AI_DESCRIPTION_HANDLER, AI_SEND_HANDLER, AdminAiController, AiController, OrgAiController } from './ai/ai.controller.js';
import { AI_FETCH, AiModelsService } from './ai/ai-models.service.js';
import { AiService } from './ai/ai.service.js';
import type { FetchLike } from './ai/llm-provider.js';
// Lot 8 (delivery), separate import block.
import { BuyerDeliveryController, MyDeliveriesController, OrgDeliveryController } from './delivery/delivery.controller.js';
import { DeliveryZonesService } from './delivery/delivery-zones.service.js';
import { DeliveryService } from './delivery/delivery.service.js';
import { DeliveryCodes } from './delivery/delivery.shared.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { AvatarController } from './media/avatar.controller.js';
import { MEDIA_THROTTLED_HANDLERS, MediaController, PublicMediaController } from './media/media.controller.js';
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
  /** Overrides the fetch used by the AI provider adapters (tests never touch the network). */
  aiFetch?: FetchLike;
}

@Module({})
export class AppModule {
  static forRoot({ env, otpSender, extraControllers = [], pushGateway, aiFetch }: AppModuleOptions): DynamicModule {
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
            redact: LOG_REDACT_PATHS,
            serializers: { req: scrubLoggedRequest },
            transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          },
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
            {
              // Lot 1c: anonymous creation of QR login sessions (each one is a database row).
              name: 'qrCreate',
              ttl: 60_000,
              limit: env.AUTH_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) =>
                ctx.getType() !== 'http' ||
                ctx.getClass() !== QrLoginController ||
                ctx.getHandler().name !== QR_CREATE_HANDLER,
            },
            {
              // Lot 1c: the web client polls the QR session every 1-2 s while the code is shown.
              name: 'qrPoll',
              ttl: 60_000,
              limit: env.QR_POLL_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) =>
                ctx.getType() !== 'http' ||
                ctx.getClass() !== QrLoginController ||
                ctx.getHandler().name !== QR_POLL_HANDLER,
            },
            {
              // Stricter budget for credential and OTP endpoints (brute force, SMS pumping).
              name: 'auth',
              ttl: 60_000,
              limit: env.AUTH_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) =>
                ctx.getClass() !== AuthController &&
                // Lot 1c: second-factor guesses and OTP sends to a chosen destination need the same brake.
                ctx.getClass() !== TwoFactorController &&
                ctx.getClass() !== IdentifierChangeController,
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
              // Anonymous storefront images: a catalogue page loads many, so a larger budget than the default.
              name: 'publicMedia',
              ttl: 60_000,
              limit: env.RATE_LIMIT_PER_MINUTE * 5,
              skipIf: (ctx) => ctx.getType() !== 'http' || ctx.getClass() !== PublicMediaController,
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
            {
              // Lot 7: the search route only (each call runs up to four queries).
              name: 'search',
              ttl: 60_000,
              limit: env.SEARCH_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) =>
                ctx.getType() !== 'http' ||
                ctx.getClass() !== SearchController ||
                ctx.getHandler().name !== SEARCH_HANDLER,
            },
            {
              // Lot 10: the OAuth token endpoint only (code exchange and refresh; secret and verifier guesses).
              name: 'oauthToken',
              ttl: 60_000,
              limit: env.OAUTH_TOKEN_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) =>
                ctx.getType() !== 'http' ||
                ctx.getClass() !== OAuthController ||
                ctx.getHandler().name !== OAUTH_TOKEN_HANDLER,
            },
            {
              // Lot 12: generating routes only (each call is a paid or quota-limited provider request).
              name: 'ai',
              ttl: 60_000,
              limit: env.AI_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) =>
                ctx.getType() !== 'http' ||
                !(
                  (ctx.getClass() === AiController && ctx.getHandler().name === AI_SEND_HANDLER) ||
                  (ctx.getClass() === OrgAiController && ctx.getHandler().name === AI_DESCRIPTION_HANDLER)
                ),
            },
          ],
        }),
        DbModule,
        // Without ScheduleModule the @Interval jobs (MaintenanceService) are never started.
        ...(env.MAINTENANCE_ENABLED ? [ScheduleModule.forRoot()] : []),
      ],
      controllers: [
        HealthController,
        CommunitiesController,
        ConversationCommunityController,
        FinanceController,
        ListingsController,
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
        PublicMediaController,
        AvatarController,
        ConversationsController,
        MessagesController,
        // Lot 3b
        MessagingMeController,
        NotificationsController,
        SocialController,
        StoriesController,
        ReportsController,
        ModerationController,
        CatalogController,
        StorefrontController,
        PublicCatalogController,
        // Lot 5B
        CartController,
        OrdersController,
        OrgOrdersController,
        ReviewsController,
        // Lot 7
        PlacesController,
        // Lot 11
        MobilityDriverController,
        AdminMobilityController,
        RidesController,
        // Lot 9
        ServicesController,
        BookingsController,
        SearchController,
        OrgMiniAppsController,
        AdminMiniAppsController,
        MiniAppDirectoryController,
        OAuthController,
        MyMiniAppsController,
        MiniAppApiController,
        // Lot 6A
        WalletController,
        OrgWalletController,
        AdminLedgerController,
        // Lot 6B
        KycController,
        AdminKycController,
        OrgPaymentQrController,
        WalletQrController,
        // Lot 1c
        TwoFactorController,
        IdentifierChangeController,
        QrLoginController,
        // Lot 12
        AiController,
        OrgAiController,
        AdminAiController,
        // Lot 8
        OrgDeliveryController,
        BuyerDeliveryController,
        MyDeliveriesController,
        ...extraControllers,
      ],
      providers: [
        PasswordService,
        TokenService,
        AuditService,
        OtpService,
        // Lot 1c
        TotpCrypto,
        TwoFactorService,
        IdentifierChangeService,
        QrLoginService,
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
        // Lot 5: catalogue port used by cart, orders and reviews (replaced by the catalogue implementation).
        { provide: CatalogPort, useClass: CatalogPortImpl },
        CatalogService,
        // Lot 6A: ledger implements LedgerPort; KycPort and PinVerifier are stubs until lot 6B replaces them.
        { provide: LedgerPort, useExisting: LedgerService },
        LedgerService,
        WalletService,
        // Lot 6B: KYC tiers and payment PIN replace the stubs.
        { provide: KycPort, useExisting: KycService },
        { provide: PinVerifier, useExisting: PinService },
        KycService,
        PinService,
        KycCrypto,
        PaymentQrService,
        QrSigner,
        // Lot 12
        { provide: AI_FETCH, useValue: aiFetch },
        AiModelsService,
        AiService,
        // Lot 8
        DeliveryCodes,
        DeliveryZonesService,
        DeliveryService,
        // Lot 5B
        CartService,
        PaymentMethods,
        CouponsService,
        OrdersService,
        ReviewsService,
        // Lot 7
        PlacesService,
        // Lot 11
        RideCodes,
        MobilityService,
        MobilityJobs,
        // Lot 9
        ServicesService,
        BookingsService,
        SearchService,
        MiniAppsService,
        OAuthService,
        MiniAppApiService,
        MiniAppTokenGuard,
        SearchHistoryService,
        StorefrontService,
        CatalogModerationTarget,
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
        CommunitiesService,
        FinanceService,
        ListingsService,
        MessagesService,
        // Lot 3b
        MessageExtrasService,
        ScheduledMessagesService,
        { provide: ConversationRoomsResolver, useClass: MessagingRooms },
        { provide: OtpSender, useValue: otpSender ?? createOtpSender(env) },
        { provide: APP_GUARD, useClass: HttpThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        // Must stay after AuthGuard: global guards run in registration order and it needs req.auth.
        { provide: APP_GUARD, useClass: FlagGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}

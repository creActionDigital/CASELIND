import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type Availability,
  type Booking,
  type BookingDetail,
  type BookingList,
  type BookingListQuery,
  bookingListQuerySchema,
  type BookingNoteRequest,
  bookingNoteRequestSchema,
  type CreateBookingRequest,
  createBookingRequestSchema,
  type CreateServiceOfferRequest,
  createServiceOfferRequestSchema,
  type CreateServiceReviewRequest,
  createServiceReviewRequestSchema,
  type OwnServiceListQuery,
  ownServiceListQuerySchema,
  type PageQuery,
  pageQuerySchema,
  type ProposeQuoteRequest,
  proposeQuoteRequestSchema,
  type ServiceCategoryList,
  type ServiceDiscoveryQuery,
  serviceDiscoveryQuerySchema,
  type ServiceOfferDetail,
  type ServiceOfferList,
  type ServiceProfile,
  type ServiceReview,
  type ServiceReviewList,
  type ServiceReviewReplyRequest,
  serviceReviewReplyRequestSchema,
  type SetAvailabilityRequest,
  setAvailabilityRequestSchema,
  type SlotList,
  type SlotsQuery,
  slotsQuerySchema,
  type UpdateServiceOfferRequest,
  updateServiceOfferRequestSchema,
  type UpsertServiceProfileRequest,
  upsertServiceProfileRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { BookingsService } from './bookings.service.js';
import { ServicesService } from './services.service.js';

export type { Booking };

/** Offers: individual providers (`/me/...`), organisations of kind "services" (`/orgs/:orgId/...`) and discovery. Flag `services`. */
@Controller()
@RequireFlag('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get('service-categories')
  categories(): Promise<ServiceCategoryList> {
    return this.services.categories();
  }

  // ---- individual provider ------------------------------------------------------------------------

  @Get('me/service-profile')
  profile(@CurrentUser() user: AuthUser): Promise<ServiceProfile> {
    return this.services.getProfile(user.userId);
  }

  @Put('me/service-profile')
  upsertProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(upsertServiceProfileRequestSchema)) body: UpsertServiceProfileRequest,
  ): Promise<ServiceProfile> {
    return this.services.upsertProfile(user.userId, body);
  }

  @Post('me/services')
  createMine(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createServiceOfferRequestSchema)) body: CreateServiceOfferRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ServiceOfferDetail> {
    return this.services.create({ providerId: user.userId }, user.userId, body, meta);
  }

  @Get('me/services')
  listMine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ownServiceListQuerySchema)) q: OwnServiceListQuery): Promise<ServiceOfferList> {
    return this.services.listOwned({ providerId: user.userId }, q);
  }

  @Get('me/services/:id')
  getMine(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ServiceOfferDetail> {
    return this.services.getOwned({ providerId: user.userId }, id);
  }

  @Patch('me/services/:id')
  updateMine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateServiceOfferRequestSchema)) body: UpdateServiceOfferRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ServiceOfferDetail> {
    return this.services.update({ providerId: user.userId }, user.userId, id, body, meta);
  }

  @Delete('me/services/:id')
  @HttpCode(204)
  async archiveMine(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.services.archive({ providerId: user.userId }, user.userId, id, meta);
  }

  @Put('me/services/:id/availability')
  setMyAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(setAvailabilityRequestSchema)) body: SetAvailabilityRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Availability> {
    return this.services.setAvailability({ providerId: user.userId }, user.userId, id, body, meta);
  }

  // ---- organisation (kind "services", permission catalog.manage) ------------------------------------

  @Post('orgs/:orgId/services')
  @OrgPermission('catalog.manage')
  createForOrg(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createServiceOfferRequestSchema)) body: CreateServiceOfferRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ServiceOfferDetail> {
    return this.services.create({ orgId: m.orgId }, user.userId, body, meta);
  }

  @Get('orgs/:orgId/services')
  @OrgPermission('catalog.manage')
  listForOrg(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(ownServiceListQuerySchema)) q: OwnServiceListQuery): Promise<ServiceOfferList> {
    return this.services.listOwned({ orgId: m.orgId }, q);
  }

  @Get('orgs/:orgId/services/:id')
  @OrgPermission('catalog.manage')
  getForOrg(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<ServiceOfferDetail> {
    return this.services.getOwned({ orgId: m.orgId }, id);
  }

  @Patch('orgs/:orgId/services/:id')
  @OrgPermission('catalog.manage')
  updateForOrg(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateServiceOfferRequestSchema)) body: UpdateServiceOfferRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ServiceOfferDetail> {
    return this.services.update({ orgId: m.orgId }, user.userId, id, body, meta);
  }

  @Delete('orgs/:orgId/services/:id')
  @OrgPermission('catalog.manage')
  @HttpCode(204)
  async archiveForOrg(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.services.archive({ orgId: m.orgId }, user.userId, id, meta);
  }

  @Put('orgs/:orgId/services/:id/availability')
  @OrgPermission('catalog.manage')
  setOrgAvailability(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(setAvailabilityRequestSchema)) body: SetAvailabilityRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Availability> {
    return this.services.setAvailability({ orgId: m.orgId }, user.userId, id, body, meta);
  }

  // ---- discovery ------------------------------------------------------------------------------------

  @Get('services')
  discover(@CurrentUser() user: AuthUser, @Query(new ZodPipe(serviceDiscoveryQuerySchema)) q: ServiceDiscoveryQuery): Promise<ServiceOfferList> {
    return this.services.discover(user.userId, q);
  }

  @Get('services/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ServiceOfferDetail> {
    return this.services.detailFor(user.userId, id);
  }

  @Get('services/:id/slots')
  slots(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query(new ZodPipe(slotsQuerySchema)) q: SlotsQuery): Promise<SlotList> {
    return this.services.slots(user.userId, id, q);
  }
}

/** Bookings, quotes and reviews. Flag `services`. Payment is on site: nothing is collected here. */
@Controller()
@RequireFlag('services')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('services/:id/bookings')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(createBookingRequestSchema)) body: CreateBookingRequest,
  ): Promise<BookingDetail> {
    return this.bookings.create(user.userId, id, body);
  }

  @Get('services/:id/reviews')
  reviews(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<ServiceReviewList> {
    return this.bookings.listReviews(user.userId, id, q);
  }

  @Get('me/bookings')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(bookingListQuerySchema)) q: BookingListQuery): Promise<BookingList> {
    return this.bookings.listAsClient(user.userId, q);
  }

  @Get('me/service-bookings')
  receivedAsIndividual(@CurrentUser() user: AuthUser, @Query(new ZodPipe(bookingListQuerySchema)) q: BookingListQuery): Promise<BookingList> {
    return this.bookings.listAsIndividual(user.userId, q);
  }

  @Get('orgs/:orgId/service-bookings')
  @OrgPermission('catalog.manage')
  receivedAsOrg(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(bookingListQuerySchema)) q: BookingListQuery): Promise<BookingList> {
    return this.bookings.listAsOrg(m.orgId, q);
  }

  @Get('bookings/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<BookingDetail> {
    return this.bookings.get(user.userId, id);
  }

  @Post('bookings/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<BookingDetail> {
    return this.bookings.confirm(user.userId, id);
  }

  @Post('bookings/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(bookingNoteRequestSchema)) body: BookingNoteRequest): Promise<BookingDetail> {
    return this.bookings.decline(user.userId, id, body.reason);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(bookingNoteRequestSchema)) body: BookingNoteRequest): Promise<BookingDetail> {
    return this.bookings.cancel(user.userId, id, body.reason);
  }

  @Post('bookings/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<BookingDetail> {
    return this.bookings.complete(user.userId, id);
  }

  @Post('bookings/:id/no-show')
  @HttpCode(200)
  noShow(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<BookingDetail> {
    return this.bookings.noShow(user.userId, id);
  }

  @Post('bookings/:id/quote')
  @HttpCode(200)
  quote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(proposeQuoteRequestSchema)) body: ProposeQuoteRequest): Promise<BookingDetail> {
    return this.bookings.proposeQuote(user.userId, id, body);
  }

  @Post('bookings/:id/quote/accept')
  @HttpCode(200)
  acceptQuote(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<BookingDetail> {
    return this.bookings.acceptQuote(user.userId, id);
  }

  @Post('bookings/:id/quote/decline')
  @HttpCode(200)
  declineQuote(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<BookingDetail> {
    return this.bookings.declineQuote(user.userId, id);
  }

  @Post('bookings/:id/review')
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createServiceReviewRequestSchema)) body: CreateServiceReviewRequest): Promise<ServiceReview> {
    return this.bookings.review(user.userId, id, body);
  }

  @Post('service-reviews/:reviewId/reply')
  @HttpCode(200)
  reply(
    @CurrentUser() user: AuthUser,
    @Param('reviewId') reviewId: string,
    @Body(new ZodPipe(serviceReviewReplyRequestSchema)) body: ServiceReviewReplyRequest,
  ): Promise<ServiceReview> {
    return this.bookings.reply(user.userId, reviewId, body);
  }
}

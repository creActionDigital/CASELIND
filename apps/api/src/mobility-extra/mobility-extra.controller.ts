import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type CarpoolBooking,
  type CarpoolMineList,
  type CarpoolMineQuery,
  carpoolMineQuerySchema,
  type CarpoolQuote,
  type CarpoolQuoteRequest,
  carpoolQuoteRequestSchema,
  type CarpoolRating,
  type CarpoolRatingRequest,
  carpoolRatingRequestSchema,
  type CarpoolSearchQuery,
  carpoolSearchQuerySchema,
  type CarpoolTrip,
  type CarpoolTripList,
  type CreateCarpoolBookingRequest,
  createCarpoolBookingRequestSchema,
  type CreateCarpoolTripRequest,
  createCarpoolTripRequestSchema,
  type CreateRentalBookingRequest,
  createRentalBookingRequestSchema,
  type CreateRentalVehicleRequest,
  createRentalVehicleRequestSchema,
  type CreateRoadsideRequest,
  createRoadsideRequestSchema,
  type OrgRentalListQuery,
  orgRentalListQuerySchema,
  type RentalBooking,
  type RentalBookingList,
  type RentalBookingListQuery,
  rentalBookingListQuerySchema,
  type RentalDetailQuery,
  rentalDetailQuerySchema,
  type RentalSearchQuery,
  rentalSearchQuerySchema,
  type RentalVehicle,
  type RentalVehicleList,
  type RoadsideLocationConsentRequest,
  roadsideLocationConsentRequestSchema,
  type RoadsideLocationRequest,
  roadsideLocationRequestSchema,
  type RoadsideMineQuery,
  roadsideMineQuerySchema,
  type RoadsideOfferList,
  type RoadsideOffersQuery,
  roadsideOffersQuerySchema,
  type RoadsideOnTheWayRequest,
  roadsideOnTheWayRequestSchema,
  type RoadsideRequest,
  type RoadsideRequestList,
  type UpdateRentalVehicleRequest,
  updateRentalVehicleRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { CarpoolService } from './carpool.service.js';
import { RentalsService } from './rentals.service.js';
import { RoadsideService } from './roadside.service.js';

/** Carpooling between individuals: no money transits, the seat price is paid in cash. Flag `mobility`. */
@Controller('carpool')
@RequireFlag('mobility')
export class CarpoolController {
  constructor(private readonly carpool: CarpoolService) {}

  @Post('quote')
  @HttpCode(200)
  quote(@Body(new ZodPipe(carpoolQuoteRequestSchema)) body: CarpoolQuoteRequest): CarpoolQuote {
    return this.carpool.quote(body);
  }

  @Post('trips')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createCarpoolTripRequestSchema)) body: CreateCarpoolTripRequest, @ReqMeta() meta: RequestMeta): Promise<CarpoolTrip> {
    return this.carpool.createTrip(user.userId, body, meta);
  }

  @Get('trips')
  search(@CurrentUser() user: AuthUser, @Query(new ZodPipe(carpoolSearchQuerySchema)) q: CarpoolSearchQuery): Promise<CarpoolTripList> {
    return this.carpool.search(user.userId, q);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(carpoolMineQuerySchema)) q: CarpoolMineQuery): Promise<CarpoolMineList> {
    return this.carpool.mine(user.userId, q);
  }

  @Get('trips/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<CarpoolTrip> {
    return this.carpool.get(user.userId, id);
  }

  @Post('trips/:id/bookings')
  book(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(createCarpoolBookingRequestSchema)) body: CreateCarpoolBookingRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<CarpoolBooking> {
    return this.carpool.book(user.userId, id, body, meta);
  }

  @Post('trips/:id/depart')
  @HttpCode(200)
  depart(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CarpoolTrip> {
    return this.carpool.depart(user.userId, id, meta);
  }

  @Post('trips/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CarpoolTrip> {
    return this.carpool.complete(user.userId, id, meta);
  }

  @Post('trips/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CarpoolTrip> {
    return this.carpool.cancelTrip(user.userId, id, meta);
  }

  @Post('trips/:id/ratings')
  rate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(carpoolRatingRequestSchema)) body: CarpoolRatingRequest): Promise<CarpoolRating> {
    return this.carpool.rate(user.userId, id, body);
  }

  @Post('bookings/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CarpoolBooking> {
    return this.carpool.accept(user.userId, id, meta);
  }

  @Post('bookings/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CarpoolBooking> {
    return this.carpool.decline(user.userId, id, meta);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  cancelBooking(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CarpoolBooking> {
    return this.carpool.cancelBooking(user.userId, id, meta);
  }
}

/** Vehicle rental by organisations: discovery and requests (renter side) and management (organisation side, `catalog.manage`). Flag `mobility`. */
@Controller()
@RequireFlag('mobility')
export class RentalsController {
  constructor(private readonly rentals: RentalsService) {}

  @Get('rentals')
  search(@Query(new ZodPipe(rentalSearchQuerySchema)) q: RentalSearchQuery): Promise<RentalVehicleList> {
    return this.rentals.search(q);
  }

  @Get('rentals/:id')
  detail(@Param('id') id: string, @Query(new ZodPipe(rentalDetailQuerySchema)) q: RentalDetailQuery): Promise<RentalVehicle> {
    return this.rentals.detail(id, q);
  }

  @Post('rentals/:id/bookings')
  book(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(createRentalBookingRequestSchema)) body: CreateRentalBookingRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<RentalBooking> {
    return this.rentals.book(user.userId, id, body, meta);
  }

  @Get('me/rental-bookings')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rentalBookingListQuerySchema)) q: RentalBookingListQuery): Promise<RentalBookingList> {
    return this.rentals.myBookings(user.userId, q);
  }

  @Post('rental-bookings/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RentalBooking> {
    return this.rentals.cancelByRenter(user.userId, id, meta);
  }

  // ---- organisation (any kind, permission catalog.manage) -------------------------------------------

  @Post('orgs/:orgId/rentals')
  @OrgPermission('catalog.manage')
  create(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createRentalVehicleRequestSchema)) body: CreateRentalVehicleRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<RentalVehicle> {
    return this.rentals.createVehicle(m.orgId, user.userId, body, meta);
  }

  @Get('orgs/:orgId/rentals')
  @OrgPermission('catalog.manage')
  listForOrg(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(orgRentalListQuerySchema)) q: OrgRentalListQuery): Promise<RentalVehicleList> {
    return this.rentals.listOrgVehicles(m.orgId, q);
  }

  @Patch('orgs/:orgId/rentals/:id')
  @OrgPermission('catalog.manage')
  update(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateRentalVehicleRequestSchema)) body: UpdateRentalVehicleRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<RentalVehicle> {
    return this.rentals.updateVehicle(m.orgId, user.userId, id, body, meta);
  }

  @Get('orgs/:orgId/rental-bookings')
  @OrgPermission('catalog.manage')
  bookings(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(rentalBookingListQuerySchema)) q: RentalBookingListQuery): Promise<RentalBookingList> {
    return this.rentals.orgBookings(m.orgId, q);
  }

  @Post('orgs/:orgId/rental-bookings/:id/confirm')
  @OrgPermission('catalog.manage')
  @HttpCode(200)
  confirm(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RentalBooking> {
    return this.rentals.orgStep(m.orgId, user.userId, id, 'confirm', meta);
  }

  @Post('orgs/:orgId/rental-bookings/:id/decline')
  @OrgPermission('catalog.manage')
  @HttpCode(200)
  decline(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RentalBooking> {
    return this.rentals.orgStep(m.orgId, user.userId, id, 'decline', meta);
  }

  @Post('orgs/:orgId/rental-bookings/:id/pickup')
  @OrgPermission('catalog.manage')
  @HttpCode(200)
  pickup(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RentalBooking> {
    return this.rentals.orgStep(m.orgId, user.userId, id, 'pickup', meta);
  }

  @Post('orgs/:orgId/rental-bookings/:id/return')
  @OrgPermission('catalog.manage')
  @HttpCode(200)
  returned(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RentalBooking> {
    return this.rentals.orgStep(m.orgId, user.userId, id, 'return', meta);
  }

  @Post('orgs/:orgId/rental-bookings/:id/cancel')
  @OrgPermission('catalog.manage')
  @HttpCode(200)
  orgCancel(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RentalBooking> {
    return this.rentals.orgStep(m.orgId, user.userId, id, 'cancel', meta);
  }
}

/** Roadside assistance. Providers are approved mobility drivers (KYC level 1); the price is agreed on the spot, cash. Flag `mobility`. */
@Controller('roadside')
@RequireFlag('mobility')
export class RoadsideController {
  constructor(private readonly roadside: RoadsideService) {}

  @Post('requests')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createRoadsideRequestSchema)) body: CreateRoadsideRequest, @ReqMeta() meta: RequestMeta): Promise<RoadsideRequest> {
    return this.roadside.create(user.userId, body, meta);
  }

  /** Provider side: open requests near a position. */
  @Get('requests')
  offers(@CurrentUser() user: AuthUser, @Query(new ZodPipe(roadsideOffersQuerySchema)) q: RoadsideOffersQuery): Promise<RoadsideOfferList> {
    return this.roadside.offers(user.userId, q);
  }

  @Get('requests/mine')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(roadsideMineQuerySchema)) q: RoadsideMineQuery): Promise<RoadsideRequestList> {
    return this.roadside.mine(user.userId, q);
  }

  @Get('requests/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RoadsideRequest> {
    return this.roadside.get(user.userId, id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RoadsideRequest> {
    return this.roadside.cancel(user.userId, id, meta);
  }

  @Post('requests/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RoadsideRequest> {
    return this.roadside.accept(user.userId, id, meta);
  }

  @Post('requests/:id/on-the-way')
  @HttpCode(200)
  onTheWay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(roadsideOnTheWayRequestSchema)) body: RoadsideOnTheWayRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<RoadsideRequest> {
    return this.roadside.onTheWay(user.userId, id, body.etaMinutes, meta);
  }

  @Post('requests/:id/done')
  @HttpCode(200)
  done(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RoadsideRequest> {
    return this.roadside.done(user.userId, id, meta);
  }

  @Post('requests/:id/release')
  @HttpCode(200)
  release(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<RoadsideRequest> {
    return this.roadside.release(user.userId, id, meta);
  }

  @Put('requests/:id/location-consent')
  consent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(roadsideLocationConsentRequestSchema)) body: RoadsideLocationConsentRequest,
  ): Promise<RoadsideRequest> {
    return this.roadside.setLocationConsent(user.userId, id, body.granted);
  }

  @Post('requests/:id/location')
  @HttpCode(204)
  async location(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(roadsideLocationRequestSchema)) body: RoadsideLocationRequest): Promise<void> {
    await this.roadside.postLocation(user.userId, id, body.lat, body.lng);
  }
}

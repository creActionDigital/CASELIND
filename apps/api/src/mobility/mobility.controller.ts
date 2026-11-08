import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  type AdminDriverList,
  type AdminDriverListQuery,
  adminDriverListQuerySchema,
  type CancelRideRequest,
  cancelRideRequestSchema,
  type CreateFavoritePlaceRequest,
  createFavoritePlaceRequestSchema,
  type CreateRideRequest,
  createRideRequestSchema,
  type DriverDecisionRequest,
  driverDecisionRequestSchema,
  type DriverLocationRequest,
  driverLocationRequestSchema,
  type DriverProfile,
  type FavoritePlace,
  type FavoritePlaceList,
  type MyRidesQuery,
  myRidesQuerySchema,
  type RateRideRequest,
  rateRideRequestSchema,
  type RideAlertResult,
  type RideEstimate,
  type RideEstimateRequest,
  rideEstimateRequestSchema,
  type RideList,
  type RideMessageList,
  type RideOffers,
  type RideRating,
  type RideReceipt,
  type RideShare,
  type RideView,
  type SendQuickMessageRequest,
  sendQuickMessageRequestSchema,
  type SetOnlineRequest,
  setOnlineRequestSchema,
  type SetTrustedContactsRequest,
  setTrustedContactsRequestSchema,
  type SharedRide,
  type StartRideRequest,
  startRideRequestSchema,
  type TrustedContactList,
  type UpsertDriverRequest,
  upsertDriverRequestSchema,
} from '@caselind/contracts';
import { Interval } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser, Public, Roles } from '../security/auth.guard.js';
import { MobilityService } from './mobility.service.js';

/** Driver side: profile, availability, position (every 15 to 30 s while online) and requests nearby. */
@Controller('mobility/driver')
@RequireFlag('mobility')
export class MobilityDriverController {
  constructor(private readonly mobility: MobilityService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<DriverProfile> {
    return this.mobility.getDriver(user.userId);
  }

  @Put()
  upsert(@CurrentUser() user: AuthUser, @Body(new ZodPipe(upsertDriverRequestSchema)) body: UpsertDriverRequest): Promise<DriverProfile> {
    return this.mobility.upsertDriver(user.userId, body);
  }

  @Post('online')
  @HttpCode(200)
  online(@CurrentUser() user: AuthUser, @Body(new ZodPipe(setOnlineRequestSchema)) body: SetOnlineRequest): Promise<DriverProfile> {
    return this.mobility.setOnline(user.userId, body.online);
  }

  @Post('location')
  @HttpCode(204)
  async location(@CurrentUser() user: AuthUser, @Body(new ZodPipe(driverLocationRequestSchema)) body: DriverLocationRequest): Promise<void> {
    await this.mobility.postLocation(user.userId, body.lat, body.lng);
  }

  @Get('offers')
  offers(@CurrentUser() user: AuthUser): Promise<RideOffers> {
    return this.mobility.offersFor(user.userId);
  }
}

/** Back-office review of driver profiles (platform admins only). */
@Controller('admin/mobility')
@RequireFlag('mobility')
@Roles('admin')
export class AdminMobilityController {
  constructor(private readonly mobility: MobilityService) {}

  @Get('drivers')
  list(@Query(new ZodPipe(adminDriverListQuerySchema)) q: AdminDriverListQuery): Promise<AdminDriverList> {
    return this.mobility.adminListDrivers(q);
  }

  @Post('drivers/:userId/decision')
  @HttpCode(200)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body(new ZodPipe(driverDecisionRequestSchema)) body: DriverDecisionRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<DriverProfile> {
    return this.mobility.adminDecide(user.userId, userId, body, meta);
  }
}

/** Rider and driver sides of rides. A ride that is not the caller's: 404. */
@Controller()
@RequireFlag('mobility')
export class RidesController {
  constructor(private readonly mobility: MobilityService) {}

  @Post('rides/estimate')
  @HttpCode(200)
  estimate(@Body(new ZodPipe(rideEstimateRequestSchema)) body: RideEstimateRequest): RideEstimate {
    return this.mobility.estimate(body);
  }

  @Post('rides')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createRideRequestSchema)) body: CreateRideRequest): Promise<RideView> {
    return this.mobility.createRide(user.userId, body);
  }

  @Public()
  @Get('rides/shared/:token')
  shared(@Param('token') token: string): Promise<SharedRide> {
    return this.mobility.sharedView(token);
  }

  @Get('me/rides')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(myRidesQuerySchema)) q: MyRidesQuery): Promise<RideList> {
    return this.mobility.myRides(user.userId, q);
  }

  @Get('rides/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RideView> {
    return this.mobility.getRide(user.userId, id);
  }

  @Get('rides/:id/receipt')
  receipt(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RideReceipt> {
    return this.mobility.receipt(user.userId, id);
  }

  @Post('rides/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RideView> {
    return this.mobility.accept(user.userId, id);
  }

  @Post('rides/:id/arriving')
  @HttpCode(200)
  arriving(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RideView> {
    return this.mobility.arriving(user.userId, id);
  }

  @Post('rides/:id/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(startRideRequestSchema)) body: StartRideRequest): Promise<RideView> {
    return this.mobility.start(user.userId, id, body.code);
  }

  @Post('rides/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RideView> {
    return this.mobility.complete(user.userId, id);
  }

  @Post('rides/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(cancelRideRequestSchema)) body: CancelRideRequest): Promise<RideView> {
    return this.mobility.cancel(user.userId, id, body);
  }

  @Post('rides/:id/share')
  @HttpCode(200)
  share(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RideShare> {
    return this.mobility.share(user.userId, id);
  }

  @Delete('rides/:id/share')
  @HttpCode(204)
  async unshare(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.mobility.unshare(user.userId, id);
  }

  @Post('rides/:id/alert')
  @HttpCode(200)
  alert(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RideAlertResult> {
    return this.mobility.alert(user.userId, id);
  }

  @Post('rides/:id/rating')
  @HttpCode(200)
  rate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(rateRideRequestSchema)) body: RateRideRequest): Promise<RideRating> {
    return this.mobility.rate(user.userId, id, body);
  }

  @Get('rides/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RideMessageList> {
    return this.mobility.listMessages(user.userId, id);
  }

  @Post('rides/:id/messages')
  @HttpCode(200)
  sendMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(sendQuickMessageRequestSchema)) body: SendQuickMessageRequest): Promise<RideMessageList> {
    return this.mobility.sendMessage(user.userId, id, body.code);
  }

  @Get('me/trusted-contacts')
  trusted(@CurrentUser() user: AuthUser): Promise<TrustedContactList> {
    return this.mobility.trustedContacts(user.userId);
  }

  @Put('me/trusted-contacts')
  setTrusted(@CurrentUser() user: AuthUser, @Body(new ZodPipe(setTrustedContactsRequestSchema)) body: SetTrustedContactsRequest): Promise<TrustedContactList> {
    return this.mobility.setTrustedContacts(user.userId, body.handles);
  }

  @Get('me/favorite-places')
  favorites(@CurrentUser() user: AuthUser): Promise<FavoritePlaceList> {
    return this.mobility.listFavorites(user.userId);
  }

  @Post('me/favorite-places')
  addFavorite(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createFavoritePlaceRequestSchema)) body: CreateFavoritePlaceRequest): Promise<FavoritePlace> {
    return this.mobility.addFavorite(user.userId, body);
  }

  @Delete('me/favorite-places/:id')
  @HttpCode(204)
  async deleteFavorite(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.mobility.deleteFavorite(user.userId, id);
  }
}

/** Every 30 s: scheduled rides enter the dispatch, unanswered requests expire. Inert unless ScheduleModule is registered. */
@Injectable()
export class MobilityJobs {
  private readonly logger = new Logger(MobilityJobs.name);

  constructor(private readonly mobility: MobilityService) {}

  @Interval('mobility', 30_000)
  async tick(): Promise<void> {
    try {
      await this.mobility.runOnce();
    } catch (err) {
      this.logger.warn(`mobility job failed: ${(err as Error).name}`);
    }
  }
}

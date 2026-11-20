import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  type CourierDeliveredRequest,
  courierDeliveredRequestSchema,
  type CourierLocationRequest,
  courierLocationRequestSchema,
  type CourierOfferList,
  type CourierOffersQuery,
  courierOffersQuerySchema,
  type CourierRequest,
  type CourierRequestEstimate,
  type CourierRequestEstimateRequest,
  courierRequestEstimateRequestSchema,
  type CourierRequestList,
  type CourierRequestListQuery,
  courierRequestListQuerySchema,
  type CourierRoutePlan,
  type CourierRoutePlanQuery,
  courierRoutePlanQuerySchema,
  type CreateCourierRequest,
  createCourierRequestSchema,
  type LocationConsentRequest,
  locationConsentRequestSchema,
  type MyCourierJobs,
  type MyCourierJobsQuery,
  myCourierJobsQuerySchema,
  type RateCourierRequest,
  rateCourierRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { CourierRequestsService } from './courier-requests.service.js';

/** On-demand courier, requester side. Requests of others: 404. */
@Controller('courier-requests')
@RequireFlag('mobility')
export class CourierRequestsController {
  constructor(private readonly service: CourierRequestsService) {}

  @Post('estimate')
  @HttpCode(200)
  estimate(@Body(new ZodPipe(courierRequestEstimateRequestSchema)) body: CourierRequestEstimateRequest): CourierRequestEstimate {
    return this.service.estimate(body);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createCourierRequestSchema)) body: CreateCourierRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<CourierRequest> {
    return this.service.create(user.userId, body, meta);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(courierRequestListQuerySchema)) q: CourierRequestListQuery): Promise<CourierRequestList> {
    return this.service.list(user.userId, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<CourierRequest> {
    return this.service.get(user.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CourierRequest> {
    return this.service.cancel(user.userId, id, meta);
  }

  @Post(':id/reset-proof')
  @HttpCode(200)
  resetProof(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CourierRequest> {
    return this.service.resetProof(user.userId, id, meta);
  }

  @Post(':id/rating')
  @HttpCode(200)
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(rateCourierRequestSchema)) body: RateCourierRequest,
  ): Promise<CourierRequest> {
    return this.service.rate(user.userId, id, body.rating);
  }
}

/** Courier side: approved mobility drivers (KYC 1). Foreign requests: 404. */
@Controller('courier')
@RequireFlag('mobility')
export class CourierController {
  constructor(private readonly service: CourierRequestsService) {}

  @Get('requests')
  offers(@CurrentUser() user: AuthUser, @Query(new ZodPipe(courierOffersQuerySchema)) q: CourierOffersQuery): Promise<CourierOfferList> {
    return this.service.offers(user.userId, q);
  }

  @Get('requests/mine')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(myCourierJobsQuerySchema)) q: MyCourierJobsQuery): Promise<MyCourierJobs> {
    return this.service.myJobs(user.userId, q);
  }

  @Post('requests/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CourierRequest> {
    return this.service.accept(user.userId, id, meta);
  }

  @Post('requests/:id/picked-up')
  @HttpCode(200)
  pickedUp(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CourierRequest> {
    return this.service.pickedUp(user.userId, id, meta);
  }

  @Post('requests/:id/delivered')
  @HttpCode(200)
  delivered(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(courierDeliveredRequestSchema)) body: CourierDeliveredRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<CourierRequest> {
    return this.service.delivered(user.userId, id, body.code, meta);
  }

  @Put('requests/:id/location-consent')
  consent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(locationConsentRequestSchema)) body: LocationConsentRequest,
  ): Promise<CourierRequest> {
    return this.service.setLocationConsent(user.userId, id, body.granted);
  }

  @Post('requests/:id/location')
  @HttpCode(204)
  async location(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(courierLocationRequestSchema)) body: CourierLocationRequest,
  ): Promise<void> {
    await this.service.postLocation(user.userId, id, body.lat, body.lng);
  }

  @Get('route-plan')
  routePlan(@CurrentUser() user: AuthUser, @Query(new ZodPipe(courierRoutePlanQuerySchema)) q: CourierRoutePlanQuery): Promise<CourierRoutePlan> {
    return this.service.routePlan(user.userId, q);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type CompareListingsQuery,
  compareListingsQuerySchema,
  type CompareListingsResponse,
  type CounterOfferRequest,
  counterOfferRequestSchema,
  type CreateOfferRequest,
  createOfferRequestSchema,
  type ListingOffer,
  type ListingOfferList,
  type CreateListingAlertRequest,
  createListingAlertRequestSchema,
  type ListingAlert,
  type ListingAlertList,
  type ConfirmVisitRequest,
  confirmVisitRequestSchema,
  type CreateVisitRequest,
  createVisitRequestSchema,
  type ListingVisit,
  type ListingVisitList,
  type CreateListingRequest,
  createListingRequestSchema,
  type Listing,
  type ListingList,
  type ListingListQuery,
  listingListQuerySchema,
  pageQuerySchema,
  type PageQuery,
  type UpdateListingRequest,
  updateListingRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { ListingsService } from './listings.service.js';

/** Classified ads. Every route is behind the `listings` flag. */
@Controller('listings')
@RequireFlag('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listingListQuerySchema)) q: ListingListQuery): Promise<ListingList> {
    return this.listings.list(user.userId, q);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<ListingList> {
    return this.listings.mine(user.userId, q);
  }

  /** Declared before `:id`. */
  @Get('compare')
  compare(@CurrentUser() user: AuthUser, @Query(new ZodPipe(compareListingsQuerySchema)) q: CompareListingsQuery): Promise<CompareListingsResponse> {
    return this.listings.compare(user.userId, q.ids);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Listing> {
    return this.listings.get(user.userId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createListingRequestSchema)) body: CreateListingRequest, @ReqMeta() meta: RequestMeta): Promise<Listing> {
    return this.listings.create(user.userId, body, meta);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateListingRequestSchema)) body: UpdateListingRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Listing> {
    return this.listings.update(user.userId, id, body, meta);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Listing> {
    return this.listings.close(user.userId, id, meta);
  }
}

/** Ad alerts (lot 15b): private to their owner. */
@Controller('me/listing-alerts')
@RequireFlag('listings')
export class ListingAlertsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ListingAlertList> {
    return this.listings.listAlerts(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createListingAlertRequestSchema)) body: CreateListingAlertRequest, @ReqMeta() meta: RequestMeta): Promise<ListingAlert> {
    return this.listings.createAlert(user.userId, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.listings.deleteAlert(user.userId, id, meta);
  }
}

/** Visit appointments (lot 15c): visible only to the visitor and the ad's owner (404 otherwise). */
@Controller()
@RequireFlag('listings')
export class ListingVisitsController {
  constructor(private readonly listings: ListingsService) {}

  @Post('listings/:id/visits')
  request(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createVisitRequestSchema)) body: CreateVisitRequest, @ReqMeta() meta: RequestMeta): Promise<ListingVisit> {
    return this.listings.requestVisit(user.userId, id, body, meta);
  }

  @Get('me/visits')
  mine(@CurrentUser() user: AuthUser): Promise<ListingVisitList> {
    return this.listings.listVisits(user.userId);
  }

  @Get('visits/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ListingVisit> {
    return this.listings.getVisit(user.userId, id);
  }

  @Post('visits/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(confirmVisitRequestSchema)) body: ConfirmVisitRequest, @ReqMeta() meta: RequestMeta): Promise<ListingVisit> {
    return this.listings.answerVisit(user.userId, id, 'confirm', body.place, meta);
  }

  @Post('visits/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<ListingVisit> {
    return this.listings.answerVisit(user.userId, id, 'decline', undefined, meta);
  }

  @Post('visits/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<ListingVisit> {
    return this.listings.answerVisit(user.userId, id, 'cancel', undefined, meta);
  }
}

/** Guided negotiation (lot 15d): visible only to the buyer and the ad's owner (404 otherwise). */
@Controller()
@RequireFlag('listings')
export class ListingOffersController {
  constructor(private readonly listings: ListingsService) {}

  @Post('listings/:id/offers')
  make(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createOfferRequestSchema)) body: CreateOfferRequest, @ReqMeta() meta: RequestMeta): Promise<ListingOffer> {
    return this.listings.makeOffer(user.userId, id, body, meta);
  }

  @Get('me/offers')
  mine(@CurrentUser() user: AuthUser): Promise<ListingOfferList> {
    return this.listings.listOffers(user.userId);
  }

  @Get('offers/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ListingOffer> {
    return this.listings.getOffer(user.userId, id);
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<ListingOffer> {
    return this.listings.answerOffer(user.userId, id, 'accept', undefined, meta);
  }

  @Post('offers/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<ListingOffer> {
    return this.listings.answerOffer(user.userId, id, 'decline', undefined, meta);
  }

  @Post('offers/:id/counter')
  @HttpCode(200)
  counter(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(counterOfferRequestSchema)) body: CounterOfferRequest, @ReqMeta() meta: RequestMeta): Promise<ListingOffer> {
    return this.listings.answerOffer(user.userId, id, 'counter', body.amountMinor, meta);
  }

  @Post('offers/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<ListingOffer> {
    return this.listings.answerOffer(user.userId, id, 'cancel', undefined, meta);
  }
}

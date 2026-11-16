import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateListingAlertRequest,
  createListingAlertRequestSchema,
  type ListingAlert,
  type ListingAlertList,
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

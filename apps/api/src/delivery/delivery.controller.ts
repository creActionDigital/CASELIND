import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type AssignDeliveryRequest,
  assignDeliveryRequestSchema,
  type CourierDelivery,
  type CourierDeliveryStatusRequest,
  courierDeliveryStatusRequestSchema,
  type CourierLocationRequest,
  courierLocationRequestSchema,
  type CreateDeliveryZoneRequest,
  createDeliveryZoneRequestSchema,
  type DeliveryDetail,
  type DeliveryIncidentRequest,
  deliveryIncidentRequestSchema,
  type DeliveryList,
  type DeliveryListQuery,
  deliveryListQuerySchema,
  type DeliveryView,
  type DeliveryZone,
  type DeliveryZoneList,
  type LocationConsentRequest,
  locationConsentRequestSchema,
  type MyDeliveryList,
  type MyDeliveryListQuery,
  myDeliveryListQuerySchema,
  type OrgDeliveryStatusRequest,
  orgDeliveryStatusRequestSchema,
  type RateDeliveryRequest,
  rateDeliveryRequestSchema,
  type UpdateDeliveryZoneRequest,
  updateDeliveryZoneRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { DeliveryZonesService } from './delivery-zones.service.js';
import { DeliveryService } from './delivery.service.js';

/** Seller side: zones and fees (`orders.manage`), deliveries and dispatch. Foreign or malformed ids: 404. */
@Controller('orgs/:orgId')
@RequireFlag('commerce')
export class OrgDeliveryController {
  constructor(
    private readonly zones: DeliveryZonesService,
    private readonly deliveries: DeliveryService,
  ) {}

  @Post('delivery-zones')
  @OrgPermission('orders.manage')
  createZone(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createDeliveryZoneRequestSchema)) body: CreateDeliveryZoneRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<DeliveryZone> {
    return this.zones.create(m.orgId, user.userId, body, meta);
  }

  @Get('delivery-zones')
  @OrgPermission('orders.manage')
  listZones(@CurrentMembership() m: OrgMembership): Promise<DeliveryZoneList> {
    return this.zones.list(m.orgId, false);
  }

  @Patch('delivery-zones/:id')
  @OrgPermission('orders.manage')
  updateZone(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateDeliveryZoneRequestSchema)) body: UpdateDeliveryZoneRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<DeliveryZone> {
    return this.zones.update(m.orgId, id, user.userId, body, meta);
  }

  @Delete('delivery-zones/:id')
  @HttpCode(204)
  @OrgPermission('orders.manage')
  async deleteZone(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.zones.remove(m.orgId, id, user.userId, meta);
  }

  @Get('deliveries')
  @OrgPermission('orders.view')
  list(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(deliveryListQuerySchema)) q: DeliveryListQuery): Promise<DeliveryList> {
    return this.deliveries.listForOrg(m.orgId, q);
  }

  @Get('deliveries/:id')
  @OrgPermission('orders.view')
  get(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<DeliveryDetail> {
    return this.deliveries.getForOrg(m.orgId, id);
  }

  @Post('deliveries/:id/assign')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  assign(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(assignDeliveryRequestSchema)) body: AssignDeliveryRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<DeliveryDetail> {
    return this.deliveries.assign(m.orgId, user.userId, id, body.courierUserId, meta);
  }

  @Post('deliveries/:id/status')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  changeStatus(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(orgDeliveryStatusRequestSchema)) body: OrgDeliveryStatusRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<DeliveryDetail> {
    return this.deliveries.changeStatusAsOrg(m.orgId, user.userId, id, body, meta);
  }

  @Post('deliveries/:id/proof-reset')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  resetProof(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<DeliveryDetail> {
    return this.deliveries.resetProof(m.orgId, user.userId, id, meta);
  }
}

/** Buyer side: zones a seller delivers to (to choose one at checkout) and the rating of the courier. */
@Controller()
@RequireFlag('commerce')
export class BuyerDeliveryController {
  constructor(
    private readonly zones: DeliveryZonesService,
    private readonly deliveries: DeliveryService,
  ) {}

  @Get('delivery/orgs/:orgId/zones')
  listActiveZones(@Param('orgId') orgId: string): Promise<DeliveryZoneList> {
    return this.zones.listPublic(orgId);
  }

  @Post('orders/:id/delivery/rating')
  @HttpCode(200)
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(rateDeliveryRequestSchema)) body: RateDeliveryRequest,
  ): Promise<DeliveryView> {
    return this.deliveries.rate(user.userId, id, body);
  }
}

/** Courier side: the caller's own deliveries. Anyone else's: 404. */
@Controller('me/deliveries')
@RequireFlag('commerce')
export class MyDeliveriesController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(myDeliveryListQuerySchema)) q: MyDeliveryListQuery): Promise<MyDeliveryList> {
    return this.deliveries.listMine(user.userId, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<CourierDelivery> {
    return this.deliveries.getMine(user.userId, id);
  }

  @Post(':id/status')
  @HttpCode(200)
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(courierDeliveryStatusRequestSchema)) body: CourierDeliveryStatusRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<CourierDelivery> {
    return this.deliveries.changeStatusAsCourier(user.userId, id, body, meta);
  }

  @Post(':id/incident')
  @HttpCode(200)
  incident(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(deliveryIncidentRequestSchema)) body: DeliveryIncidentRequest,
  ): Promise<CourierDelivery> {
    return this.deliveries.reportIncident(user.userId, id, body.reason);
  }

  @Put(':id/location-consent')
  consent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(locationConsentRequestSchema)) body: LocationConsentRequest,
  ): Promise<CourierDelivery> {
    return this.deliveries.setLocationConsent(user.userId, id, body.granted);
  }

  @Post(':id/location')
  @HttpCode(204)
  async location(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(courierLocationRequestSchema)) body: CourierLocationRequest,
  ): Promise<void> {
    await this.deliveries.postLocation(user.userId, id, body.lat, body.lng);
  }
}

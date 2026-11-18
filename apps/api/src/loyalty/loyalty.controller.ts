import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import {
  type Campaign,
  type CampaignList,
  type CreateCampaignRequest,
  type CreatePosSaleRequest,
  type PosSale,
  type PosSaleList,
  type PosSummary,
  createPosSaleRequestSchema,
  type LoyaltyProgram,
  type MarketingConsentRequest,
  type MyLoyalty,
  type UpdateLoyaltyProgramRequest,
  createCampaignRequestSchema,
  marketingConsentRequestSchema,
  updateLoyaltyProgramRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { LoyaltyService } from './loyalty.service.js';
import { PosService } from './pos.service.js';

/** Buyer side: own points per shop and marketing consent. */
@Controller('me')
@RequireFlag('commerce')
export class MyLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('loyalty')
  mine(@CurrentUser() user: AuthUser): Promise<MyLoyalty> {
    return this.loyalty.mine(user.userId);
  }

  @Put('marketing-consent')
  setConsent(@CurrentUser() user: AuthUser, @Body(new ZodPipe(marketingConsentRequestSchema)) body: MarketingConsentRequest, @ReqMeta() meta: RequestMeta): Promise<{ marketingConsent: boolean }> {
    return this.loyalty.setConsent(user.userId, body.optIn, meta);
  }
}

/** Seller side (`orders.manage`): loyalty programme and campaigns. */
@Controller('orgs/:orgId')
@RequireFlag('commerce')
export class OrgLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('loyalty')
  @OrgPermission('orders.manage')
  program(@CurrentMembership() m: OrgMembership): Promise<LoyaltyProgram> {
    return this.loyalty.getProgram(m.orgId);
  }

  @Put('loyalty')
  @OrgPermission('orders.manage')
  update(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Body(new ZodPipe(updateLoyaltyProgramRequestSchema)) body: UpdateLoyaltyProgramRequest, @ReqMeta() meta: RequestMeta): Promise<LoyaltyProgram> {
    return this.loyalty.updateProgram(m.orgId, user.userId, body, meta);
  }

  @Post('campaigns')
  @OrgPermission('orders.manage')
  send(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Body(new ZodPipe(createCampaignRequestSchema)) body: CreateCampaignRequest, @ReqMeta() meta: RequestMeta): Promise<Campaign> {
    return this.loyalty.sendCampaign(m.orgId, user.userId, body, meta);
  }

  @Get('campaigns')
  @OrgPermission('orders.manage')
  campaigns(@CurrentMembership() m: OrgMembership): Promise<CampaignList> {
    return this.loyalty.listCampaigns(m.orgId);
  }
}

/** Till (`orders.manage`): counter sales. */
@Controller('orgs/:orgId/pos')
@RequireFlag('commerce')
export class OrgPosController {
  constructor(private readonly pos: PosService) {}

  @Post('sales')
  @OrgPermission('orders.manage')
  create(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Body(new ZodPipe(createPosSaleRequestSchema)) body: CreatePosSaleRequest, @ReqMeta() meta: RequestMeta): Promise<PosSale> {
    return this.pos.create(m.orgId, user.userId, body, meta);
  }

  @Get('sales')
  @OrgPermission('orders.manage')
  list(@CurrentMembership() m: OrgMembership): Promise<PosSaleList> {
    return this.pos.list(m.orgId);
  }

  @Get('summary')
  @OrgPermission('orders.manage')
  summary(@CurrentMembership() m: OrgMembership): Promise<PosSummary> {
    return this.pos.summary(m.orgId);
  }
}

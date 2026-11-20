import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type CreatePromotionRequest,
  createPromotionRequestSchema,
  type PageQuery,
  pageQuerySchema,
  type Promotion,
  type PromotionList,
  type PromotionListQuery,
  promotionListQuerySchema,
  type StorefrontProductList,
  type UpdatePromotionRequest,
  updatePromotionRequestSchema,
} from '@caselind/contracts';
import { StorefrontService } from '../catalog/storefront.service.js';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { PromotionsService } from './promotions.service.js';

/** Seller side: promotions of the organisation's products (`catalog.manage`). */
@Controller('orgs/:orgId/promotions')
@RequireFlag('commerce')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @OrgPermission('catalog.manage')
  list(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(promotionListQuerySchema)) q: PromotionListQuery): Promise<PromotionList> {
    return this.promotions.list(m.orgId, q);
  }

  @Post()
  @OrgPermission('catalog.manage')
  create(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createPromotionRequestSchema)) b: CreatePromotionRequest, @ReqMeta() meta: RequestMeta): Promise<Promotion> {
    return this.promotions.create(m.orgId, u.userId, b, meta);
  }

  @Patch(':id')
  @OrgPermission('catalog.manage')
  update(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updatePromotionRequestSchema)) b: UpdatePromotionRequest, @ReqMeta() meta: RequestMeta): Promise<Promotion> {
    return this.promotions.update(m.orgId, u.userId, id, b, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @OrgPermission('catalog.manage')
  remove(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.promotions.remove(m.orgId, u.userId, id, meta);
  }
}

/** Buyer side: flash sales in progress (signed in, like the product search: blocked sellers stay hidden). */
@Controller('promotions')
@RequireFlag('commerce')
export class FlashSalesController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get('flash')
  flash(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<StorefrontProductList> {
    return this.storefront.flash(user.userId, q);
  }
}

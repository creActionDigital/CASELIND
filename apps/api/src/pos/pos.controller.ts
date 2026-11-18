import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type ClosePosShiftRequest,
  type CreatePosSaleRequest,
  type CurrentPosShift,
  type OpenPosShiftRequest,
  type PosSale,
  type PosSaleList,
  type PosSaleListQuery,
  type PosShift,
  type PosShiftReport,
  type PosSummary,
  type PosTicket,
  type VoidPosSaleRequest,
  closePosShiftRequestSchema,
  createPosSaleRequestSchema,
  openPosShiftRequestSchema,
  posSaleListQuerySchema,
  voidPosSaleRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { PosService } from './pos.service.js';

/** Till (`orders.manage`): counter sales, voids, cash drawer sessions. */
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
  list(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(posSaleListQuerySchema)) q: PosSaleListQuery): Promise<PosSaleList> {
    return this.pos.list(m.orgId, q.limit);
  }

  @Get('sales/:id')
  @OrgPermission('orders.manage')
  ticket(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<PosTicket> {
    return this.pos.ticket(m.orgId, id);
  }

  @Post('sales/:id/void')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  voidSale(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(voidPosSaleRequestSchema)) body: VoidPosSaleRequest, @ReqMeta() meta: RequestMeta): Promise<PosSale> {
    return this.pos.voidSale(m.orgId, id, user.userId, body.reason, meta);
  }

  @Get('summary')
  @OrgPermission('orders.manage')
  summary(@CurrentMembership() m: OrgMembership): Promise<PosSummary> {
    return this.pos.summary(m.orgId);
  }

  @Post('shifts')
  @OrgPermission('orders.manage')
  openShift(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Body(new ZodPipe(openPosShiftRequestSchema)) body: OpenPosShiftRequest): Promise<PosShift> {
    return this.pos.openShift(m.orgId, user.userId, body);
  }

  @Get('shifts/current')
  @OrgPermission('orders.manage')
  currentShift(@CurrentMembership() m: OrgMembership): Promise<CurrentPosShift> {
    return this.pos.currentShift(m.orgId);
  }

  @Post('shifts/:id/close')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  closeShift(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(closePosShiftRequestSchema)) body: ClosePosShiftRequest): Promise<PosShiftReport> {
    return this.pos.closeShift(m.orgId, id, user.userId, body);
  }
}

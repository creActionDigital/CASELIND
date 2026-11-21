import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type CreateReturnRequest,
  createReturnRequestSchema,
  type DisputeListQuery,
  disputeListQuerySchema,
  type DisputeReturnRequest,
  disputeReturnRequestSchema,
  type OrderReturn,
  type OrderReturns,
  type ResolveReturnDisputeRequest,
  resolveReturnDisputeRequestSchema,
  type ReturnList,
  type ReturnListQuery,
  returnListQuerySchema,
  type ReturnNoteRequest,
  returnNoteRequestSchema,
  type ReturnReceivedRequest,
  returnReceivedRequestSchema,
  type ReturnRefundedRequest,
  returnRefundedRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { OrderReturnsService } from './order-returns.service.js';

/** Buyer side: ask for a return on a delivered order, follow it, cancel it, escalate a refusal. Others' returns are a 404. */
@Controller()
@RequireFlag('commerce')
export class OrderReturnsController {
  constructor(private readonly returns: OrderReturnsService) {}

  @Get('me/returns')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(returnListQuerySchema)) q: ReturnListQuery): Promise<ReturnList> {
    return this.returns.listMine(user.userId, q);
  }

  @Post('orders/:id/returns')
  request(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createReturnRequestSchema)) body: CreateReturnRequest, @ReqMeta() meta: RequestMeta): Promise<OrderReturn> {
    return this.returns.request(user.userId, id, body, meta);
  }

  @Get('orders/:id/returns')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<OrderReturns> {
    return this.returns.listForOrder(user.userId, id);
  }

  @Post('returns/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<OrderReturn> {
    return this.returns.cancel(user.userId, id);
  }

  @Post('returns/:id/dispute')
  @HttpCode(200)
  dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(disputeReturnRequestSchema)) body: DisputeReturnRequest): Promise<OrderReturn> {
    return this.returns.dispute(user.userId, id, body.reason);
  }
}

/** Seller side (`orders.manage`): the organisation's returns and their steps. */
@Controller('orgs/:orgId')
@RequireFlag('commerce')
export class OrgReturnsController {
  constructor(private readonly returns: OrderReturnsService) {}

  @Get('returns')
  @OrgPermission('orders.manage')
  list(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(returnListQuerySchema)) q: ReturnListQuery): Promise<ReturnList> {
    return this.returns.listForOrg(m.orgId, q);
  }

  @Post('returns/:id/approve')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  approve(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(returnNoteRequestSchema)) body: ReturnNoteRequest, @ReqMeta() meta: RequestMeta): Promise<OrderReturn> {
    return this.returns.approve(m.orgId, user.userId, id, body.note, meta);
  }

  @Post('returns/:id/reject')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  reject(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(returnNoteRequestSchema)) body: ReturnNoteRequest, @ReqMeta() meta: RequestMeta): Promise<OrderReturn> {
    return this.returns.reject(m.orgId, user.userId, id, body.note, meta);
  }

  @Post('returns/:id/received')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  received(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(returnReceivedRequestSchema)) body: ReturnReceivedRequest, @ReqMeta() meta: RequestMeta): Promise<OrderReturn> {
    return this.returns.received(m.orgId, user.userId, id, body.restock, body.note, meta);
  }

  @Post('returns/:id/refunded')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  refunded(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(returnRefundedRequestSchema)) body: ReturnRefundedRequest, @ReqMeta() meta: RequestMeta): Promise<OrderReturn> {
    return this.returns.refunded(m.orgId, user.userId, id, body.amountMinor, body.note, meta);
  }
}

/** Platform arbitration of the disputes escalated by buyers (roles `admin` and `support`, checked server-side). */
@Controller('admin')
@Roles('admin', 'support')
export class AdminDisputesController {
  constructor(private readonly returns: OrderReturnsService) {}

  @Get('disputes')
  list(@Query(new ZodPipe(disputeListQuerySchema)) q: DisputeListQuery): Promise<ReturnList> {
    return this.returns.listDisputes(q);
  }

  @Post('disputes/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(resolveReturnDisputeRequestSchema)) body: ResolveReturnDisputeRequest, @ReqMeta() meta: RequestMeta): Promise<OrderReturn> {
    return this.returns.resolve(user.userId, id, body, meta);
  }
}

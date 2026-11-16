import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  type BusinessDocument,
  type BusinessDocumentList,
  type CreateDocumentRequest,
  createDocumentRequestSchema,
  type DocumentListQuery,
  documentListQuerySchema,
  type UpdateDocumentStatusRequest,
  updateDocumentStatusRequestSchema,
  type CancelOrderRequest,
  cancelOrderRequestSchema,
  type CheckoutRequest,
  type CheckoutResponse,
  checkoutRequestSchema,
  type Coupon,
  type CouponList,
  type CouponListQuery,
  couponListQuerySchema,
  type CreateCouponRequest,
  createCouponRequestSchema,
  type OrderDetail,
  type OrderList,
  type OrderListQuery,
  orderListQuerySchema,
  type PaymentMethodList,
  type CustomerList,
  type SalesSummary,
  type SalesSummaryQuery,
  salesSummaryQuerySchema,
  type UpdateCouponRequest,
  updateCouponRequestSchema,
  type UpdateOrderStatusRequest,
  updateOrderStatusRequestSchema,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { CouponsService } from './coupons.service.js';
import { DocumentsService } from './documents.service.js';
import { OrdersService } from './orders.service.js';
import { PaymentMethods } from './payment-methods.js';

/** Buyer side: checkout, own orders, cancellation. Orders of other users are a 404. */
@Controller()
@RequireFlag('commerce')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentMethods,
  ) {}

  @Get('payment-methods')
  paymentMethods(): PaymentMethodList {
    return { methods: this.payments.available() };
  }

  @Post('orders/checkout')
  async checkout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(checkoutRequestSchema)) body: CheckoutRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutResponse> {
    const { orders, created } = await this.orders.checkout(user.userId, body);
    res.status(created ? 201 : 200);
    return { orders };
  }

  @Get('orders')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(orderListQuerySchema)) q: OrderListQuery): Promise<OrderList> {
    return this.orders.listMine(user.userId, q);
  }

  @Get('orders/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<OrderDetail> {
    return this.orders.getMine(user.userId, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(cancelOrderRequestSchema)) body: CancelOrderRequest,
  ): Promise<OrderDetail> {
    return this.orders.cancelAsBuyer(user.userId, id, body.note);
  }
}

/** Seller side: orders of the organisation (`orders.view`), status changes and coupons (`orders.manage`). */
@Controller('orgs/:orgId')
@RequireFlag('commerce')
export class OrgOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly coupons: CouponsService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('orders')
  @OrgPermission('orders.view')
  list(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(orderListQuerySchema)) q: OrderListQuery): Promise<OrderList> {
    return this.orders.listForOrg(m.orgId, q);
  }

  @Post('documents')
  @OrgPermission('orders.manage')
  createDocument(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Body(new ZodPipe(createDocumentRequestSchema)) body: CreateDocumentRequest, @ReqMeta() meta: RequestMeta): Promise<BusinessDocument> {
    return this.documents.create(m.orgId, user.userId, body, meta);
  }

  @Get('documents')
  @OrgPermission('orders.view')
  listDocuments(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(documentListQuerySchema)) q: DocumentListQuery): Promise<BusinessDocumentList> {
    return this.documents.list(m.orgId, q);
  }

  @Get('documents/:id')
  @OrgPermission('orders.view')
  getDocument(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<BusinessDocument> {
    return this.documents.get(m.orgId, id);
  }

  @Post('documents/:id/status')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  setDocumentStatus(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateDocumentStatusRequestSchema)) body: UpdateDocumentStatusRequest, @ReqMeta() meta: RequestMeta): Promise<BusinessDocument> {
    return this.documents.setStatus(m.orgId, user.userId, id, body.status, meta);
  }

  @Post('documents/:id/convert')
  @OrgPermission('orders.manage')
  convertQuote(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<BusinessDocument> {
    return this.documents.convert(m.orgId, user.userId, id, meta);
  }

  @Get('customers')
  @OrgPermission('orders.view')
  customers(@CurrentMembership() m: OrgMembership): Promise<CustomerList> {
    return this.orders.customers(m.orgId);
  }

  @Get('sales-summary')
  @OrgPermission('orders.view')
  salesSummary(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(salesSummaryQuerySchema)) q: SalesSummaryQuery): Promise<SalesSummary> {
    return this.orders.salesSummary(m.orgId, q.days);
  }

  @Get('orders/:id')
  @OrgPermission('orders.view')
  get(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<OrderDetail> {
    return this.orders.getForOrg(m.orgId, id);
  }

  @Post('orders/:id/status')
  @HttpCode(200)
  @OrgPermission('orders.manage')
  changeStatus(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateOrderStatusRequestSchema)) body: UpdateOrderStatusRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<OrderDetail> {
    return this.orders.changeStatusAsOrg(m.orgId, user.userId, id, body.status, body.note, meta);
  }

  @Post('coupons')
  @OrgPermission('orders.manage')
  createCoupon(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createCouponRequestSchema)) body: CreateCouponRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Coupon> {
    return this.coupons.create(m.orgId, user.userId, body, meta);
  }

  @Get('coupons')
  @OrgPermission('orders.manage')
  listCoupons(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(couponListQuerySchema)) q: CouponListQuery): Promise<CouponList> {
    return this.coupons.list(m.orgId, q);
  }

  @Patch('coupons/:id')
  @OrgPermission('orders.manage')
  updateCoupon(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateCouponRequestSchema)) _body: UpdateCouponRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Coupon> {
    return this.coupons.deactivate(m.orgId, id, user.userId, meta);
  }
}

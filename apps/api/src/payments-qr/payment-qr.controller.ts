import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type CreatedPaymentQr,
  type CreatePaymentQrRequest,
  createPaymentQrRequestSchema,
  type PageQuery,
  pageQuerySchema,
  type PayQrRequest,
  payQrRequestSchema,
  type PayQrResponse,
  type PaymentQrList,
  type QrPayloadRequest,
  type QrPayloadResponse,
  qrPayloadSchema,
  type ResolvedPaymentQr,
} from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission, UUID_RE } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { PaymentQrService } from './payment-qr.service.js';

/**
 * Merchant side. Any member may reach the route (`org.view`); the service then requires
 * `finance.view` or `orders.manage` (a single @OrgPermission cannot express "either").
 */
@Controller('orgs/:orgId/payment-qr')
@RequireFlag('wallet.sandbox')
export class OrgPaymentQrController {
  constructor(private readonly qr: PaymentQrService) {}

  @Post()
  @OrgPermission('org.view')
  create(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createPaymentQrRequestSchema)) body: CreatePaymentQrRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<CreatedPaymentQr> {
    return this.qr.create(m, user.userId, body, meta);
  }

  @Get()
  @OrgPermission('org.view')
  list(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<PaymentQrList> {
    return this.qr.list(m, q);
  }

  @Get(':qrId')
  @OrgPermission('org.view')
  payload(@CurrentMembership() m: OrgMembership, @Param('qrId') qrId: string): Promise<QrPayloadResponse> {
    if (!UUID_RE.test(qrId)) throw AppError.notFound('QR code not found');
    return this.qr.payloadOf(m, qrId);
  }

  @Delete(':qrId')
  @HttpCode(204)
  @OrgPermission('org.view')
  async revoke(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('qrId') qrId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    if (!UUID_RE.test(qrId)) throw AppError.notFound('QR code not found');
    await this.qr.revoke(m, user.userId, qrId, meta);
  }
}

/** Payer side: resolve what a scanned QR asks for, then pay it with the payment PIN. */
@Controller('wallet/qr')
@RequireFlag('wallet.sandbox')
export class WalletQrController {
  constructor(private readonly qr: PaymentQrService) {}

  @Post('resolve')
  @HttpCode(200)
  resolve(@Body(new ZodPipe(qrPayloadSchema)) body: QrPayloadRequest): Promise<ResolvedPaymentQr> {
    return this.qr.resolve(body.payload);
  }

  @Post('pay')
  @HttpCode(200)
  pay(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(payQrRequestSchema)) body: PayQrRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PayQrResponse> {
    return this.qr.pay(user.userId, body, meta);
  }
}

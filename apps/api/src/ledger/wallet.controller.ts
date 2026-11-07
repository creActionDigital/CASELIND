import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  type AdminLedgerAccount,
  type LedgerReconciliation,
  type OrgWallet,
  type SandboxTopupRequest,
  sandboxTopupRequestSchema,
  type Wallet,
  type WalletTransactionList,
  type WalletTransactionsQuery,
  walletTransactionsQuerySchema,
  type WalletTransferRequest,
  type WalletTransferResponse,
  walletTransferRequestSchema,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { WalletService } from './wallet.service.js';

/** Sandbox wallet of the caller (fictitious funds, no real money). */
@Controller('wallet')
@RequireFlag('wallet.sandbox')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<Wallet> {
    return this.wallet.wallet(user.userId);
  }

  @Get('transactions')
  transactions(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(walletTransactionsQuerySchema)) q: WalletTransactionsQuery,
  ): Promise<WalletTransactionList> {
    return this.wallet.transactions({ userId: user.userId }, q);
  }

  @Post('transfers')
  async transfer(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(walletTransferRequestSchema)) body: WalletTransferRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WalletTransferResponse> {
    const { response, created } = await this.wallet.transfer(user, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }

  @Post('sandbox/topup')
  async topup(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(sandboxTopupRequestSchema)) body: SandboxTopupRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WalletTransferResponse> {
    const { response, created } = await this.wallet.topup(user, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }
}

/** Wallet of an organisation (`finance.view`). */
@Controller('orgs/:orgId/wallet')
@RequireFlag('wallet.sandbox')
export class OrgWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @OrgPermission('finance.view')
  get(@CurrentMembership() m: OrgMembership): Promise<OrgWallet> {
    return this.wallet.orgWallet(m.orgId);
  }

  @Get('transactions')
  @OrgPermission('finance.view')
  transactions(
    @CurrentMembership() m: OrgMembership,
    @Query(new ZodPipe(walletTransactionsQuerySchema)) q: WalletTransactionsQuery,
  ): Promise<WalletTransactionList> {
    return this.wallet.transactions({ orgId: m.orgId }, q);
  }
}

/** Ledger back-office: inspection, freezing and reconciliation. Admin role only. */
@Controller('admin/ledger')
@Roles('admin')
export class AdminLedgerController {
  constructor(private readonly wallet: WalletService) {}

  // Declared before `accounts/:id` routes: static path first.
  @Get('reconcile')
  reconcile(): Promise<LedgerReconciliation> {
    return this.wallet.reconcile();
  }

  @Get('accounts/:id')
  account(@Param('id') id: string): Promise<AdminLedgerAccount> {
    return this.wallet.adminAccount(id);
  }

  @Post('accounts/:id/freeze')
  @HttpCode(200)
  freeze(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminLedgerAccount> {
    return this.wallet.setFrozen(id, true, user.userId, user.sessionId, meta);
  }

  @Post('accounts/:id/unfreeze')
  @HttpCode(200)
  unfreeze(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminLedgerAccount> {
    return this.wallet.setFrozen(id, false, user.userId, user.sessionId, meta);
  }
}

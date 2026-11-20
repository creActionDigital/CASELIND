import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  type AdminWalletAlert,
  type AdminWalletAlertList,
  type AdminWalletAlertsQuery,
  adminWalletAlertsQuerySchema,
  type CreateMoneyRequest,
  createMoneyRequestSchema,
  type CreateScheduledPayment,
  createScheduledPaymentSchema,
  type CreateSplitBill,
  createSplitBillSchema,
  type MoneyRequest,
  type MoneyRequestList,
  type MoneyRequestListQuery,
  moneyRequestListQuerySchema,
  type NextRuns,
  type NextRunsQuery,
  nextRunsQuerySchema,
  type PageQuery,
  pageQuerySchema,
  type PayMoneyRequest,
  type PayMoneyRequestResponse,
  payMoneyRequestSchema,
  type SavingsGoal,
  type SavingsGoalList,
  type SavingsMove,
  type SavingsMoveResponse,
  type ScheduledPayment,
  type ScheduledPaymentDetail,
  type ScheduledPaymentList,
  type SplitBill,
  type SplitBillList,
  type WalletAlert,
  type WalletAlertList,
  createSavingsGoalSchema,
  savingsMoveSchema,
  type CreateSavingsGoal,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { MoneyRequestsService } from './money-requests.service.js';
import { SavingsService } from './savings.service.js';
import { ScheduledPaymentsService } from './scheduled-payments.service.js';
import { SplitBillsService } from './split-bills.service.js';
import { WalletAlertsService } from './wallet-alerts.service.js';

const page = new ZodPipe(pageQuerySchema);

/** Finance of the sandbox wallet (test funds, never real money): money requests, split bills, scheduled payments, savings goals, alerts. */
@Controller('wallet')
@RequireFlag('wallet.sandbox')
export class WalletFinanceController {
  constructor(
    private readonly requests: MoneyRequestsService,
    private readonly bills: SplitBillsService,
    private readonly scheduled: ScheduledPaymentsService,
    private readonly savings: SavingsService,
    private readonly alerts: WalletAlertsService,
  ) {}

  /* ---- money requests */

  @Post('requests')
  async createRequest(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createMoneyRequestSchema)) body: CreateMoneyRequest,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MoneyRequest> {
    const { request, created } = await this.requests.create(user, body, meta);
    res.status(created ? 201 : 200);
    return request;
  }

  @Get('requests')
  listRequests(@CurrentUser() user: AuthUser, @Query(new ZodPipe(moneyRequestListQuerySchema)) q: MoneyRequestListQuery): Promise<MoneyRequestList> {
    return this.requests.list(user.userId, q);
  }

  @Post('requests/:id/pay')
  @HttpCode(200)
  payRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(payMoneyRequestSchema)) body: PayMoneyRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PayMoneyRequestResponse> {
    return this.requests.pay(user, id, body, meta);
  }

  @Post('requests/:id/decline')
  @HttpCode(200)
  declineRequest(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<MoneyRequest> {
    return this.requests.decline(user, id, meta);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancelRequest(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<MoneyRequest> {
    return this.requests.cancel(user, id, meta);
  }

  /* ---- split bills */

  @Post('split-bills')
  async createBill(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createSplitBillSchema)) body: CreateSplitBill,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SplitBill> {
    const { bill, created } = await this.bills.create(user, body, meta);
    res.status(created ? 201 : 200);
    return bill;
  }

  @Get('split-bills')
  listBills(@CurrentUser() user: AuthUser, @Query(page) q: PageQuery): Promise<SplitBillList> {
    return this.bills.list(user.userId, q);
  }

  @Get('split-bills/:id')
  getBill(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<SplitBill> {
    return this.bills.view(user.userId, id);
  }

  @Post('split-bills/:id/cancel')
  @HttpCode(200)
  cancelBill(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<SplitBill> {
    return this.bills.cancel(user, id, meta);
  }

  /* ---- scheduled payments */

  @Post('scheduled-payments')
  async createScheduled(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createScheduledPaymentSchema)) body: CreateScheduledPayment,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ScheduledPayment> {
    const { payment, created } = await this.scheduled.create(user, body, meta);
    res.status(created ? 201 : 200);
    return payment;
  }

  @Get('scheduled-payments')
  listScheduled(@CurrentUser() user: AuthUser, @Query(page) q: PageQuery): Promise<ScheduledPaymentList> {
    return this.scheduled.list(user.userId, q);
  }

  @Get('scheduled-payments/:id')
  getScheduled(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ScheduledPaymentDetail> {
    return this.scheduled.detail(user.userId, id);
  }

  @Get('scheduled-payments/:id/next-runs')
  nextRuns(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query(new ZodPipe(nextRunsQuerySchema)) q: NextRunsQuery): Promise<NextRuns> {
    return this.scheduled.nextRuns(user.userId, id, q);
  }

  @Post('scheduled-payments/:id/pause')
  @HttpCode(200)
  pauseScheduled(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<ScheduledPayment> {
    return this.scheduled.pause(user, id, meta);
  }

  @Post('scheduled-payments/:id/resume')
  @HttpCode(200)
  resumeScheduled(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<ScheduledPayment> {
    return this.scheduled.resume(user, id, meta);
  }

  @Post('scheduled-payments/:id/cancel')
  @HttpCode(200)
  cancelScheduled(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<ScheduledPayment> {
    return this.scheduled.cancel(user, id, meta);
  }

  /* ---- savings goals */

  @Post('savings')
  @HttpCode(201)
  createGoal(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createSavingsGoalSchema)) body: CreateSavingsGoal, @ReqMeta() meta: RequestMeta): Promise<SavingsGoal> {
    return this.savings.create(user, body, meta);
  }

  @Get('savings')
  listGoals(@CurrentUser() user: AuthUser): Promise<SavingsGoalList> {
    return this.savings.list(user.userId);
  }

  @Post('savings/:id/deposit')
  async deposit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(savingsMoveSchema)) body: SavingsMove,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SavingsMoveResponse> {
    const { response, created } = await this.savings.deposit(user, id, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }

  @Post('savings/:id/withdraw')
  async withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(savingsMoveSchema)) body: SavingsMove,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SavingsMoveResponse> {
    const { response, created } = await this.savings.withdraw(user, id, body, meta);
    res.status(created ? 201 : 200);
    return response;
  }

  @Post('savings/:id/archive')
  @HttpCode(200)
  archiveGoal(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<SavingsGoal> {
    return this.savings.archive(user, id, meta);
  }

  /* ---- anomaly alerts */

  @Get('alerts')
  listAlerts(@CurrentUser() user: AuthUser, @Query(page) q: PageQuery): Promise<WalletAlertList> {
    return this.alerts.list(user.userId, q);
  }

  @Post('alerts/:id/confirm-mine')
  @HttpCode(200)
  confirmMine(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<WalletAlert> {
    return this.alerts.confirmMine(user, id, meta);
  }

  @Post('alerts/:id/report')
  @HttpCode(200)
  report(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<WalletAlert> {
    return this.alerts.report(user, id, meta);
  }
}

/** Back-office of the wallet anomaly alerts (admin role). Route for the admin hub: GET /v1/admin/wallet-alerts. */
@Controller('admin/wallet-alerts')
@Roles('admin')
export class AdminWalletAlertsController {
  constructor(private readonly alerts: WalletAlertsService) {}

  @Get()
  list(@Query(new ZodPipe(adminWalletAlertsQuerySchema)) q: AdminWalletAlertsQuery): Promise<AdminWalletAlertList> {
    return this.alerts.adminList(q);
  }

  @Post(':id/review')
  @HttpCode(200)
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminWalletAlert> {
    return this.alerts.adminReview(user, id, meta);
  }
}

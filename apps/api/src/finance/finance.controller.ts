import { Body, Controller, Delete, Get, HttpCode, Put, Query } from '@nestjs/common';
import {
  type Budget,
  type FinanceSummary,
  type FinanceSummaryQuery,
  financeSummaryQuerySchema,
  removeBudgetQuerySchema,
  type RemoveBudgetQuery,
  type SetBudgetRequest,
  setBudgetRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { FinanceService } from './finance.service.js';

/** Personal finance on the sandbox wallet (fictitious funds). */
@Controller('finance')
@RequireFlag('wallet.sandbox')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query(new ZodPipe(financeSummaryQuerySchema)) q: FinanceSummaryQuery): Promise<FinanceSummary> {
    return this.finance.summary(user.userId, q.month);
  }

  @Put('budget')
  setBudget(@CurrentUser() user: AuthUser, @Body(new ZodPipe(setBudgetRequestSchema)) body: SetBudgetRequest, @ReqMeta() meta: RequestMeta): Promise<Budget> {
    return this.finance.setBudget(user.userId, body, meta);
  }

  @Delete('budget')
  @HttpCode(204)
  async removeBudget(@CurrentUser() user: AuthUser, @Query(new ZodPipe(removeBudgetQuerySchema)) q: RemoveBudgetQuery, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.finance.removeBudget(user.userId, q.currency, meta);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  type CreateExpenseRequest,
  createExpenseRequestSchema,
  type CreatePurchaseOrderRequest,
  createPurchaseOrderRequestSchema,
  type CreateSupplierRequest,
  createSupplierRequestSchema,
  type DeleteSupplierResponse,
  type Expense,
  type ExpenseList,
  type ExpenseListQuery,
  expenseListQuerySchema,
  type PeriodQuery,
  periodQuerySchema,
  type Profitability,
  type ProfitabilityQuery,
  profitabilityQuerySchema,
  type PurchaseOrder,
  type PurchaseOrderList,
  type PurchaseOrderListQuery,
  purchaseOrderListQuerySchema,
  type ReceivePurchaseOrderRequest,
  receivePurchaseOrderRequestSchema,
  type Supplier,
  type SupplierList,
  type SupplierListQuery,
  supplierListQuerySchema,
  type UpdateExpenseRequest,
  updateExpenseRequestSchema,
  type UpdatePurchaseOrderRequest,
  updatePurchaseOrderRequestSchema,
  type UpdateSupplierRequest,
  updateSupplierRequestSchema,
} from '@caselind/contracts';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { ExpensesService } from './expenses.service.js';
import { ProfitabilityService } from './profitability.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { SuppliersService } from './suppliers.service.js';

/** Fournisseurs et bons de commande d'achat (`inventory.manage`). Derrière le drapeau `commerce`. */
@Controller('orgs/:orgId')
@RequireFlag('commerce')
export class PurchasingController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  @Get('suppliers')
  @OrgPermission('inventory.manage')
  listSuppliers(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(supplierListQuerySchema)) q: SupplierListQuery): Promise<SupplierList> {
    return this.suppliers.list(m.orgId, q);
  }

  @Post('suppliers')
  @OrgPermission('inventory.manage')
  createSupplier(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createSupplierRequestSchema)) b: CreateSupplierRequest, @ReqMeta() meta: RequestMeta): Promise<Supplier> {
    return this.suppliers.create(m.orgId, u.userId, b, meta);
  }

  @Get('suppliers/:id')
  @OrgPermission('inventory.manage')
  getSupplier(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<Supplier> {
    return this.suppliers.get(m.orgId, id);
  }

  @Patch('suppliers/:id')
  @OrgPermission('inventory.manage')
  updateSupplier(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateSupplierRequestSchema)) b: UpdateSupplierRequest, @ReqMeta() meta: RequestMeta): Promise<Supplier> {
    return this.suppliers.update(m.orgId, u.userId, id, b, meta);
  }

  @Delete('suppliers/:id')
  @OrgPermission('inventory.manage')
  deleteSupplier(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<DeleteSupplierResponse> {
    return this.suppliers.remove(m.orgId, u.userId, id, meta);
  }

  @Get('purchase-orders')
  @OrgPermission('inventory.manage')
  listOrders(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(purchaseOrderListQuerySchema)) q: PurchaseOrderListQuery): Promise<PurchaseOrderList> {
    return this.orders.list(m.orgId, q);
  }

  @Post('purchase-orders')
  @OrgPermission('inventory.manage')
  createOrder(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createPurchaseOrderRequestSchema)) b: CreatePurchaseOrderRequest, @ReqMeta() meta: RequestMeta): Promise<PurchaseOrder> {
    return this.orders.create(m.orgId, u.userId, b, meta);
  }

  @Get('purchase-orders/:id')
  @OrgPermission('inventory.manage')
  getOrder(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<PurchaseOrder> {
    return this.orders.get(m.orgId, id);
  }

  @Patch('purchase-orders/:id')
  @OrgPermission('inventory.manage')
  updateOrder(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updatePurchaseOrderRequestSchema)) b: UpdatePurchaseOrderRequest, @ReqMeta() meta: RequestMeta): Promise<PurchaseOrder> {
    return this.orders.update(m.orgId, u.userId, id, b, meta);
  }

  @Post('purchase-orders/:id/order')
  @OrgPermission('inventory.manage')
  @HttpCode(200)
  sendOrder(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<PurchaseOrder> {
    return this.orders.order(m.orgId, u.userId, id, meta);
  }

  @Post('purchase-orders/:id/receive')
  @OrgPermission('inventory.manage')
  @HttpCode(200)
  receiveOrder(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(receivePurchaseOrderRequestSchema)) b: ReceivePurchaseOrderRequest, @ReqMeta() meta: RequestMeta): Promise<PurchaseOrder> {
    return this.orders.receive(m.orgId, u.userId, id, b, meta);
  }

  @Post('purchase-orders/:id/cancel')
  @OrgPermission('inventory.manage')
  @HttpCode(200)
  cancelOrder(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<PurchaseOrder> {
    return this.orders.cancel(m.orgId, u.userId, id, meta);
  }
}

function sendCsv(res: Response, name: string, csv: string): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  return csv;
}

/** Dépenses (lecture `finance.view`, écriture `finance.manage`), rentabilité et exports CSV (`finance.view`). */
@Controller('orgs/:orgId')
@RequireFlag('commerce')
export class FinanceOpsController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly reports: ProfitabilityService,
  ) {}

  @Get('expenses')
  @OrgPermission('finance.view')
  listExpenses(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(expenseListQuerySchema)) q: ExpenseListQuery): Promise<ExpenseList> {
    return this.expenses.list(m.orgId, q);
  }

  @Post('expenses')
  @OrgPermission('finance.manage')
  createExpense(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createExpenseRequestSchema)) b: CreateExpenseRequest, @ReqMeta() meta: RequestMeta): Promise<Expense> {
    return this.expenses.create(m.orgId, u.userId, b, meta);
  }

  @Patch('expenses/:id')
  @OrgPermission('finance.manage')
  updateExpense(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateExpenseRequestSchema)) b: UpdateExpenseRequest, @ReqMeta() meta: RequestMeta): Promise<Expense> {
    return this.expenses.update(m.orgId, u.userId, id, b, meta);
  }

  @Delete('expenses/:id')
  @OrgPermission('finance.manage')
  @HttpCode(204)
  async deleteExpense(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.expenses.remove(m.orgId, u.userId, id, meta);
  }

  @Get('profitability')
  @OrgPermission('finance.view')
  profitability(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(profitabilityQuerySchema)) q: ProfitabilityQuery): Promise<Profitability> {
    return this.reports.profitability(m.orgId, q);
  }

  @Get('exports/sales.csv')
  @OrgPermission('finance.view')
  async exportSales(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Query(new ZodPipe(periodQuerySchema)) q: PeriodQuery, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response): Promise<string> {
    return sendCsv(res, `sales-${q.from}-${q.to}`, await this.reports.exportSales(m.orgId, u.userId, q, meta));
  }

  @Get('exports/expenses.csv')
  @OrgPermission('finance.view')
  async exportExpenses(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Query(new ZodPipe(periodQuerySchema)) q: PeriodQuery, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response): Promise<string> {
    return sendCsv(res, `expenses-${q.from}-${q.to}`, await this.reports.exportExpenses(m.orgId, u.userId, q, meta));
  }

  @Get('exports/purchases.csv')
  @OrgPermission('finance.view')
  async exportPurchases(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Query(new ZodPipe(periodQuerySchema)) q: PeriodQuery, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response): Promise<string> {
    return sendCsv(res, `purchases-${q.from}-${q.to}`, await this.reports.exportPurchases(m.orgId, u.userId, q, meta));
  }
}

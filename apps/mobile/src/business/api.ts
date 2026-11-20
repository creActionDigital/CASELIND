import {
  type CreateExpenseRequest,
  type CreatePurchaseOrderRequest,
  type CreateSupplierRequest,
  deleteSupplierResponseSchema,
  expenseListSchema,
  expenseSchema,
  profitabilitySchema,
  purchaseOrderListSchema,
  purchaseOrderSchema,
  supplierListSchema,
  supplierSchema,
  type ExpenseCategory,
  type PurchaseOrderStatus,
  type ReceivePurchaseOrderRequest,
  type UpdateSupplierRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const bk = {
  suppliers: (orgId: string) => ['business', orgId, 'suppliers'] as const,
  orders: (orgId: string) => ['business', orgId, 'purchase-orders'] as const,
  order: (orgId: string, id: string) => ['business', orgId, 'purchase-order', id] as const,
  expenses: (orgId: string, from: string, to: string) => ['business', orgId, 'expenses', from, to] as const,
  expensesAll: (orgId: string) => ['business', orgId, 'expenses'] as const,
  profit: (orgId: string, from: string, to: string) => ['business', orgId, 'profitability', from, to] as const,
};

export const fetchSuppliers = (orgId: string, cursor?: string, active?: boolean, limit = 50) =>
  api.request(`/orgs/${orgId}/suppliers`, { query: { cursor, limit, active }, schema: supplierListSchema });
export const createSupplier = (orgId: string, body: CreateSupplierRequest) => api.request(`/orgs/${orgId}/suppliers`, { method: 'POST', body, schema: supplierSchema });
export const patchSupplier = (orgId: string, id: string, body: UpdateSupplierRequest) => api.request(`/orgs/${orgId}/suppliers/${id}`, { method: 'PATCH', body, schema: supplierSchema });
export const deleteSupplier = (orgId: string, id: string) => api.request(`/orgs/${orgId}/suppliers/${id}`, { method: 'DELETE', schema: deleteSupplierResponseSchema });

export const fetchPurchaseOrders = (orgId: string, status?: PurchaseOrderStatus, cursor?: string) =>
  api.request(`/orgs/${orgId}/purchase-orders`, { query: { status, cursor, limit: 20 }, schema: purchaseOrderListSchema });
export const fetchPurchaseOrder = (orgId: string, id: string) => api.request(`/orgs/${orgId}/purchase-orders/${id}`, { schema: purchaseOrderSchema });
export const createPurchaseOrder = (orgId: string, body: CreatePurchaseOrderRequest) => api.request(`/orgs/${orgId}/purchase-orders`, { method: 'POST', body, schema: purchaseOrderSchema });
export const sendPurchaseOrder = (orgId: string, id: string) => api.request(`/orgs/${orgId}/purchase-orders/${id}/order`, { method: 'POST', schema: purchaseOrderSchema });
export const cancelPurchaseOrder = (orgId: string, id: string) => api.request(`/orgs/${orgId}/purchase-orders/${id}/cancel`, { method: 'POST', schema: purchaseOrderSchema });
export const receivePurchaseOrder = (orgId: string, id: string, body: ReceivePurchaseOrderRequest) =>
  api.request(`/orgs/${orgId}/purchase-orders/${id}/receive`, { method: 'POST', body, schema: purchaseOrderSchema });

export const fetchExpenses = (orgId: string, from: string, to: string, cursor?: string, category?: ExpenseCategory) =>
  api.request(`/orgs/${orgId}/expenses`, { query: { from, to, cursor, category, limit: 50 }, schema: expenseListSchema });
export const createExpense = (orgId: string, body: CreateExpenseRequest) => api.request(`/orgs/${orgId}/expenses`, { method: 'POST', body, schema: expenseSchema });
export const deleteExpense = (orgId: string, id: string) => api.request(`/orgs/${orgId}/expenses/${id}`, { method: 'DELETE' });

export const fetchProfitability = (orgId: string, from: string, to: string) => api.request(`/orgs/${orgId}/profitability`, { query: { from, to }, schema: profitabilitySchema });
/** Texte du fichier CSV (UTF-8) : l'application le partage avec l'API Share du système. */
export const fetchExportCsv = (orgId: string, kind: 'sales' | 'expenses' | 'purchases', from: string, to: string) =>
  api.request<string>(`/orgs/${orgId}/exports/${kind}.csv`, { query: { from, to }, text: true });

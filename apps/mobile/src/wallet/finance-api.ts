import { budgetSchema, financeSummarySchema, type SetBudgetRequest } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchFinanceSummary = (month?: string) => api.request('/finance/summary', { query: { month }, schema: financeSummarySchema });
export const setBudget = (body: SetBudgetRequest) => api.request('/finance/budget', { method: 'PUT', body, schema: budgetSchema });
export const removeBudget = (currency: string) => api.request('/finance/budget', { method: 'DELETE', query: { currency } });

import {
  moneyRequestListSchema,
  moneyRequestSchema,
  nextRunsSchema,
  payMoneyRequestResponseSchema,
  savingsGoalListSchema,
  savingsGoalSchema,
  savingsMoveResponseSchema,
  scheduledPaymentDetailSchema,
  scheduledPaymentListSchema,
  scheduledPaymentSchema,
  splitBillListSchema,
  splitBillSchema,
  walletAlertListSchema,
  walletAlertSchema,
  type CreateMoneyRequest,
  type CreateSavingsGoal,
  type CreateScheduledPayment,
  type CreateSplitBill,
  type SavingsMove,
} from '@caselind/contracts';
import { api } from '../../auth/auth-context';

/* Clients de la finance du portefeuille (mode test) : /v1/wallet/requests, split-bills, scheduled-payments, savings, alerts. */

export const walletFinanceKeys = {
  requests: ['wf-requests'] as const,
  split: ['wf-split'] as const,
  scheduled: ['wf-scheduled'] as const,
  savings: ['wf-savings'] as const,
  alerts: ['wf-alerts'] as const,
};

// Demandes d'argent
export const fetchRequests = (direction?: 'sent' | 'received', cursor?: string) =>
  api.request('/wallet/requests', { query: { direction, limit: 20, cursor }, schema: moneyRequestListSchema });
export const createRequest = (body: CreateMoneyRequest) => api.request('/wallet/requests', { method: 'POST', body, schema: moneyRequestSchema });
export const payRequest = (id: string, pin: string) => api.request(`/wallet/requests/${id}/pay`, { method: 'POST', body: { pin }, schema: payMoneyRequestResponseSchema });
export const declineRequest = (id: string) => api.request(`/wallet/requests/${id}/decline`, { method: 'POST', schema: moneyRequestSchema });
export const cancelRequest = (id: string) => api.request(`/wallet/requests/${id}/cancel`, { method: 'POST', schema: moneyRequestSchema });

// Paiements partagés
export const fetchSplitBills = (cursor?: string) => api.request('/wallet/split-bills', { query: { limit: 20, cursor }, schema: splitBillListSchema });
export const fetchSplitBill = (id: string) => api.request(`/wallet/split-bills/${id}`, { schema: splitBillSchema });
export const createSplitBill = (body: CreateSplitBill) => api.request('/wallet/split-bills', { method: 'POST', body, schema: splitBillSchema });
export const cancelSplitBill = (id: string) => api.request(`/wallet/split-bills/${id}/cancel`, { method: 'POST', schema: splitBillSchema });

// Paiements programmés
export const fetchScheduled = () => api.request('/wallet/scheduled-payments', { query: { limit: 50 }, schema: scheduledPaymentListSchema });
export const fetchScheduledDetail = (id: string) => api.request(`/wallet/scheduled-payments/${id}`, { schema: scheduledPaymentDetailSchema });
export const fetchNextRuns = (id: string, count = 5) => api.request(`/wallet/scheduled-payments/${id}/next-runs`, { query: { count }, schema: nextRunsSchema });
export const createScheduled = (body: CreateScheduledPayment) => api.request('/wallet/scheduled-payments', { method: 'POST', body, schema: scheduledPaymentSchema });
export const setScheduledState = (id: string, action: 'pause' | 'resume' | 'cancel') =>
  api.request(`/wallet/scheduled-payments/${id}/${action}`, { method: 'POST', schema: scheduledPaymentSchema });

// Tirelires
export const fetchSavings = () => api.request('/wallet/savings', { schema: savingsGoalListSchema });
export const createSavings = (body: CreateSavingsGoal) => api.request('/wallet/savings', { method: 'POST', body, schema: savingsGoalSchema });
export const moveSavings = (id: string, kind: 'deposit' | 'withdraw', body: SavingsMove) =>
  api.request(`/wallet/savings/${id}/${kind}`, { method: 'POST', body, schema: savingsMoveResponseSchema });
export const archiveSavings = (id: string) => api.request(`/wallet/savings/${id}/archive`, { method: 'POST', schema: savingsGoalSchema });

// Alertes d'anomalie
export const fetchAlerts = () => api.request('/wallet/alerts', { query: { limit: 50 }, schema: walletAlertListSchema });
export const answerAlert = (id: string, answer: 'confirm-mine' | 'report') => api.request(`/wallet/alerts/${id}/${answer}`, { method: 'POST', schema: walletAlertSchema });

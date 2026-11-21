import {
  adminSubscriptionListSchema,
  adminSubscriptionSchema,
  subscriptionPaymentListSchema,
  subscriptionPlanListSchema,
  subscriptionPlanSchema,
  subscriptionResponseSchema,
  subscriptionStateSchema,
  type AdminSubscriptionsQuery,
  type PutPlanRequest,
  type SubscribeRequest,
} from '@caselind/contracts';
import { z } from 'zod';
import { api } from '../auth/auth-context';

const orgQ = (orgId?: string) => (orgId ? { orgId } : undefined);

export const fetchPlans = () => api.request('/premium/plans', { schema: subscriptionPlanListSchema });
export const fetchSubscription = (orgId?: string) => api.request('/me/subscription', { query: orgQ(orgId), schema: subscriptionStateSchema });
export const subscribe = (body: SubscribeRequest) => api.request('/me/subscription', { method: 'POST', body, schema: subscriptionResponseSchema });
export const renewSubscription = (body: { clientId: string; pin: string; orgId?: string }) =>
  api.request('/me/subscription/renew', { method: 'POST', body, schema: subscriptionResponseSchema });
export const cancelSubscription = (orgId?: string) =>
  api.request('/me/subscription/cancel', { method: 'POST', query: orgQ(orgId), schema: subscriptionStateSchema });
export const setAutoRenew = (autoRenew: boolean, orgId?: string) =>
  api.request('/me/subscription/auto-renew', { method: 'PUT', body: { autoRenew, orgId }, schema: subscriptionStateSchema });
export const fetchPayments = (cursor?: string) => api.request('/me/subscription/payments', { query: { limit: 20, cursor }, schema: subscriptionPaymentListSchema });
export const fetchPremiumBadge = (userId: string) => api.request(`/users/${userId}/premium`, { schema: z.object({ premium: z.boolean() }) });

export const fetchAdminPlans = () => api.request('/admin/subscription-plans', { schema: subscriptionPlanListSchema });
export const putPlan = (code: string, body: PutPlanRequest) => api.request(`/admin/subscription-plans/${code}`, { method: 'PUT', body, schema: subscriptionPlanSchema });
export const fetchAdminSubscriptions = (status: AdminSubscriptionsQuery['status'], cursor?: string) =>
  api.request('/admin/subscriptions', { query: { status, cursor, limit: 20 }, schema: adminSubscriptionListSchema });
export const adminCancelSubscription = (id: string) => api.request(`/admin/subscriptions/${id}/cancel`, { method: 'POST', schema: adminSubscriptionSchema });

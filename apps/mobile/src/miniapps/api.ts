import { miniappGrantListSchema, miniappPaymentRequestListSchema, miniappPaymentRequestSchema, miniappPublicListSchema, miniappPublicSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const maKeys = {
  directory: (q: string, category = '') => ['miniapps', 'directory', q, category] as const,
  one: (id: string) => ['miniapps', 'one', id] as const,
  grants: ['miniapps', 'grants'] as const,
  payments: ['miniapps', 'payments'] as const,
};

export const fetchDirectory = (q: string, cursor?: string, category?: string) => api.request('/miniapps', { query: { q: q || undefined, category: category || undefined, limit: 20, cursor }, schema: miniappPublicListSchema });
export const fetchMiniApp = (id: string) => api.request(`/miniapps/${id}`, { schema: miniappPublicSchema });
export const fetchGrants = () => api.request('/me/miniapp-grants', { schema: miniappGrantListSchema });
export const revokeGrant = (appId: string) => api.request(`/me/miniapp-grants/${appId}`, { method: 'DELETE' });
export const fetchPaymentRequests = () => api.request('/me/miniapp-payment-requests', { schema: miniappPaymentRequestListSchema });
export const confirmPayment = (id: string, pin: string) => api.request(`/me/miniapp-payment-requests/${id}/confirm`, { method: 'POST', body: { pin }, schema: miniappPaymentRequestSchema });
export const declinePayment = (id: string) => api.request(`/me/miniapp-payment-requests/${id}/decline`, { method: 'POST', schema: miniappPaymentRequestSchema });

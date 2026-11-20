import {
  type CreateReturnRequest,
  type ResolveReturnDisputeRequest,
  type ReturnReceivedRequest,
  type ReturnRefundedRequest,
  orderReturnSchema,
  orderReturnsSchema,
  returnListSchema,
  type ReturnStatus,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const returnKeys = {
  order: (orderId: string) => ['order-returns', orderId] as const,
  org: (orgId: string) => ['org-returns', orgId] as const,
  disputes: ['admin-disputes'] as const,
};

/** Acheteur. */
export const fetchOrderReturns = (orderId: string) => api.request(`/orders/${orderId}/returns`, { schema: orderReturnsSchema });
export const requestReturn = (orderId: string, body: CreateReturnRequest) => api.request(`/orders/${orderId}/returns`, { method: 'POST', body, schema: orderReturnSchema });
export const cancelReturn = (id: string) => api.request(`/returns/${id}/cancel`, { method: 'POST', body: {}, schema: orderReturnSchema });
export const disputeReturn = (id: string, reason: string) => api.request(`/returns/${id}/dispute`, { method: 'POST', body: { reason }, schema: orderReturnSchema });

/** Vendeur (`orders.manage`). */
export const fetchOrgReturns = (orgId: string, status?: ReturnStatus, cursor?: string) =>
  api.request(`/orgs/${orgId}/returns`, { query: { ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) }, schema: returnListSchema });
type OrgStep = { step: 'approve' | 'reject'; note?: string } | ({ step: 'received' } & ReturnReceivedRequest) | ({ step: 'refunded' } & ReturnRefundedRequest);
export const orgReturnStep = (orgId: string, id: string, { step, ...body }: OrgStep) =>
  api.request(`/orgs/${orgId}/returns/${id}/${step}`, { method: 'POST', body, schema: orderReturnSchema });

/** Administration (rôles admin et support). */
export const fetchDisputes = (status: 'disputed' | 'resolved', cursor?: string) =>
  api.request('/admin/disputes', { query: { status, ...(cursor ? { cursor } : {}) }, schema: returnListSchema });
export const resolveDispute = (id: string, body: ResolveReturnDisputeRequest) => api.request(`/admin/disputes/${id}/resolve`, { method: 'POST', body, schema: orderReturnSchema });

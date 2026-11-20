import { adminApprovalListSchema, adminApprovalSchema, analyticsOverviewSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const opsKeys = {
  analytics: (days: number) => ['admin-ops', 'analytics', days] as const,
  approvals: ['admin-ops', 'approvals'] as const,
};

export const fetchAnalytics = (days: number) => api.request('/admin/analytics/overview', { query: { days }, schema: analyticsOverviewSchema });
/** Toutes les demandes récentes : l'écran les sépare en « en attente » et « historique ». */
export const fetchApprovals = () => api.request('/admin/approvals', { query: { limit: 100 }, schema: adminApprovalListSchema });
export const decideApproval = (id: string, what: 'approve' | 'reject' | 'cancel') => api.request(`/admin/approvals/${id}/${what}`, { method: 'POST', schema: adminApprovalSchema });

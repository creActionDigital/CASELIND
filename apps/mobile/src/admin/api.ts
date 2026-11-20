import { adminOrgListSchema, adminUserListSchema } from '@caselind/contracts';
import { z } from 'zod';
import { api } from '../auth/auth-context';

export const admk = {
  users: (q: string, status: string) => ['admin', 'users', q, status] as const,
  orgs: (q: string, status: string) => ['admin', 'orgs', q, status] as const,
  all: ['admin'] as const,
};

const qs = (q: string, status: string) => {
  const p = new URLSearchParams({ limit: '50' });
  if (q.trim()) p.set('q', q.trim());
  if (status) p.set('status', status);
  return p.toString();
};

export const fetchAdminUsers = (q: string, status: string) => api.request(`/admin/users?${qs(q, status)}`, { schema: adminUserListSchema });
export const fetchAdminOrgs = (q: string, status: string) => api.request(`/admin/orgs?${qs(q, status)}`, { schema: adminOrgListSchema });
const maybePendingSchema = z.object({ approvalId: z.string().optional() }).passthrough();
export const setUserStatus = (id: string, body: { status: 'active' | 'suspended'; reason: string }) => api.request(`/admin/users/${id}/status`, { method: 'PUT', body, schema: maybePendingSchema });
export const setOrgStatus = (id: string, body: { status: 'active' | 'suspended'; reason: string }) => api.request(`/admin/orgs/${id}/status`, { method: 'PUT', body });
export const setOrgVerification = (id: string, body: { status: 'unverified' | 'pending' | 'verified'; reason?: string }) => api.request(`/admin/orgs/${id}/verification`, { method: 'PUT', body });

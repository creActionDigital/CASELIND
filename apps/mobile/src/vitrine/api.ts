import { orgSchema, type UpdateOrgRequest } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchOrg = (orgId: string) => api.request(`/orgs/${orgId}`, { schema: orgSchema });
export const updateOrg = (orgId: string, body: UpdateOrgRequest) => api.request(`/orgs/${orgId}`, { method: 'PATCH', body, schema: orgSchema });

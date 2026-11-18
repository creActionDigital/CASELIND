import { type CreateOrgUpdateRequest, orgUpdateListSchema, orgUpdateSchema, type UpdateOrgUpdateRequest } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const updatesKeys = {
  staff: (orgId: string) => ['org-updates', orgId] as const,
  public: (slug: string) => ['org-updates-public', slug] as const,
};

/** Une organisation a 50 actualités au plus : une seule page suffit. */
export const fetchOrgUpdates = (orgId: string) => api.request(`/orgs/${orgId}/updates`, { query: { limit: 50 }, schema: orgUpdateListSchema });
export const createOrgUpdate = (orgId: string, body: CreateOrgUpdateRequest) => api.request(`/orgs/${orgId}/updates`, { method: 'POST', body, schema: orgUpdateSchema });
export const patchOrgUpdate = (orgId: string, id: string, body: UpdateOrgUpdateRequest) => api.request(`/orgs/${orgId}/updates/${id}`, { method: 'PATCH', body, schema: orgUpdateSchema });
export const deleteOrgUpdate = (orgId: string, id: string) => api.request(`/orgs/${orgId}/updates/${id}`, { method: 'DELETE' });
export const fetchPublicUpdates = (slug: string) =>
  api.request(`/public/orgs/${encodeURIComponent(slug)}/updates`, { query: { limit: 20 }, schema: orgUpdateListSchema, auth: false });

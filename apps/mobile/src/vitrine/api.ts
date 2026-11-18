import { orgGallerySchema, orgSchema, type UpdateOrgRequest } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchOrg = (orgId: string) => api.request(`/orgs/${orgId}`, { schema: orgSchema });
export const fetchGallery = (orgId: string) => api.request(`/orgs/${orgId}/gallery`, { schema: orgGallerySchema });
export const setGallery = (orgId: string, assetIds: string[]) => api.request(`/orgs/${orgId}/gallery`, { method: 'PUT', body: { assetIds }, schema: orgGallerySchema });
export const updateOrg = (orgId: string, body: UpdateOrgRequest) => api.request(`/orgs/${orgId}`, { method: 'PATCH', body, schema: orgSchema });

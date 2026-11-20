import { downloadListSchema, productFilesSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchDownloads = () => api.request('/me/downloads', { schema: downloadListSchema });
export const fetchProductFiles = (orgId: string, productId: string) => api.request(`/orgs/${orgId}/products/${productId}/files`, { schema: productFilesSchema });
export const setProductFiles = (orgId: string, productId: string, assetIds: string[]) =>
  api.request(`/orgs/${orgId}/products/${productId}/files`, { method: 'PUT', body: { assetIds }, schema: productFilesSchema });

import { posSaleListSchema, posSaleSchema, posSummarySchema, type CreatePosSaleRequest } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchPosSummary = (orgId: string) => api.request(`/orgs/${orgId}/pos/summary`, { schema: posSummarySchema });
export const fetchPosSales = (orgId: string) => api.request(`/orgs/${orgId}/pos/sales`, { schema: posSaleListSchema });
export const createPosSale = (orgId: string, body: CreatePosSaleRequest) => api.request(`/orgs/${orgId}/pos/sales`, { method: 'POST', body, schema: posSaleSchema });

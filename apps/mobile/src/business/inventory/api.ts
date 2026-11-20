import {
  batchListSchema,
  batchSchema,
  type CreateBatchRequest,
  expiringListSchema,
  fefoSchema,
  inventoryCountDetailSchema,
  inventoryCountListSchema,
  type PutCountLinesRequest,
} from '@caselind/contracts';
import { api } from '../../auth/auth-context';

export const ivKeys = {
  expiring: (orgId: string) => ['inventory', orgId, 'expiring'] as const,
  batches: (orgId: string, variantId: string) => ['inventory', orgId, 'batches', variantId] as const,
  counts: (orgId: string) => ['inventory', orgId, 'counts'] as const,
  count: (orgId: string, id: string) => ['inventory', orgId, 'count', id] as const,
};

export const fetchExpiring = (orgId: string, days = 30) => api.request(`/orgs/${orgId}/batches/expiring`, { query: { days }, schema: expiringListSchema });
export const fetchBatches = (orgId: string, variantId: string) => api.request(`/orgs/${orgId}/variants/${variantId}/batches`, { schema: batchListSchema });
export const fetchFefo = (orgId: string, variantId: string) => api.request(`/orgs/${orgId}/variants/${variantId}/batches/fefo`, { schema: fefoSchema });
export const createBatch = (orgId: string, variantId: string, body: CreateBatchRequest) =>
  api.request(`/orgs/${orgId}/variants/${variantId}/batches`, { method: 'POST', body, schema: batchSchema });
export const consumeBatch = (orgId: string, variantId: string, batchId: string, quantity: number) =>
  api.request(`/orgs/${orgId}/variants/${variantId}/batches/${batchId}/consume`, { method: 'POST', body: { quantity }, schema: batchSchema });

export const fetchCounts = (orgId: string) => api.request(`/orgs/${orgId}/inventory-counts`, { schema: inventoryCountListSchema });
export const fetchCount = (orgId: string, id: string) => api.request(`/orgs/${orgId}/inventory-counts/${id}`, { schema: inventoryCountDetailSchema });
export const openCount = (orgId: string, note?: string) =>
  api.request(`/orgs/${orgId}/inventory-counts`, { method: 'POST', body: note ? { note } : {}, schema: inventoryCountDetailSchema });
export const putCountLines = (orgId: string, id: string, lines: PutCountLinesRequest['lines']) =>
  api.request(`/orgs/${orgId}/inventory-counts/${id}/lines`, { method: 'PUT', body: { lines }, schema: inventoryCountDetailSchema });
export const closeCount = (orgId: string, id: string, apply: boolean) =>
  api.request(`/orgs/${orgId}/inventory-counts/${id}/close`, { method: 'POST', body: { apply }, schema: inventoryCountDetailSchema });
export const cancelCount = (orgId: string, id: string) => api.request(`/orgs/${orgId}/inventory-counts/${id}/cancel`, { method: 'POST', schema: inventoryCountDetailSchema });

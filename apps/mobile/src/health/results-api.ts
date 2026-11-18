import { healthResultListSchema, healthResultSchema, sharedResultsSchema, type CreateHealthResultRequest, type HealthResultKind } from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 30;

export const resultKeys = {
  list: (kind: string) => ['health', 'results', kind] as const,
  shared: (patientId: string) => ['health', 'pro', 'results', patientId] as const,
};

export const fetchResults = (kind: HealthResultKind | '', cursor?: string) =>
  api.request('/me/health/results', { query: { kind: kind || undefined, limit: PAGE, cursor }, schema: healthResultListSchema });
export const createResult = (body: CreateHealthResultRequest) => api.request('/me/health/results', { method: 'POST', body, schema: healthResultSchema });
export const deleteResult = (id: string) => api.request(`/me/health/results/${id}`, { method: 'DELETE' });
export const fetchSharedResults = (patientId: string) => api.request(`/health/patients/${patientId}/results`, { schema: sharedResultsSchema });

import { scholarshipListSchema, scholarshipSchema, schoolSummaryListSchema, type CreateScholarshipRequest, type UpdateScholarshipRequest } from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;
export const schsk = {
  schools: (f: { q: string; city: string }) => ['school', 'search', f] as const,
  list: (city: string) => ['school', 'scholarships', city] as const,
  one: (id: string) => ['school', 'scholarship', id] as const,
  org: (orgId: string) => ['school', orgId, 'scholarships'] as const,
};

export const fetchSchools = (f: { q: string; city: string }, cursor?: string) =>
  api.request('/schools', { query: { q: f.q || undefined, city: f.city || undefined, limit: PAGE, cursor }, schema: schoolSummaryListSchema });
export const fetchScholarships = (city: string, cursor?: string) =>
  api.request('/school/scholarships', { query: { city: city || undefined, limit: PAGE, cursor }, schema: scholarshipListSchema });
export const fetchScholarship = (id: string) => api.request(`/school/scholarships/${id}`, { schema: scholarshipSchema });
export const fetchOrgScholarships = (orgId: string, cursor?: string) => api.request(`/orgs/${orgId}/school/scholarships`, { query: { limit: PAGE, cursor }, schema: scholarshipListSchema });
export const publishScholarship = (orgId: string, body: CreateScholarshipRequest) => api.request(`/orgs/${orgId}/school/scholarships`, { method: 'POST', body, schema: scholarshipSchema });
export const updateScholarship = (orgId: string, id: string, body: UpdateScholarshipRequest) => api.request(`/orgs/${orgId}/school/scholarships/${id}`, { method: 'PATCH', body, schema: scholarshipSchema });
export const closeScholarship = (orgId: string, id: string) => api.request(`/orgs/${orgId}/school/scholarships/${id}/close`, { method: 'POST' });

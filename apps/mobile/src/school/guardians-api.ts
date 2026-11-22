import { childClassListSchema, childFeeListSchema, myChildListSchema, myGuardianshipListSchema, myStudentGuardianListSchema, schoolGuardianListSchema, schoolGuardianSchema, type CreateGuardianRequest } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const guardianKeys = {
  staff: (orgId: string) => ['school', orgId, 'guardians'] as const,
  mine: ['school', 'guardianships'] as const,
  children: ['school', 'children'] as const,
  fees: (studentId: string) => ['school', 'children', studentId, 'fees'] as const,
  classes: (studentId: string) => ['school', 'children', studentId, 'classes'] as const,
};

const base = (orgId: string) => `/orgs/${orgId}/school/guardians`;
export const fetchGuardians = (orgId: string) => api.request(base(orgId), { schema: schoolGuardianListSchema });
export const linkGuardian = (orgId: string, body: CreateGuardianRequest) => api.request(base(orgId), { method: 'POST', body, schema: schoolGuardianSchema });
export const removeGuardian = (orgId: string, id: string) => api.request(`${base(orgId)}/${id}`, { method: 'DELETE' });

export const fetchGuardianships = () => api.request('/me/school/guardianships', { schema: myGuardianshipListSchema });
export const answerGuardianship = (id: string, answer: 'accept' | 'decline') => api.request(`/me/school/guardianships/${id}/${answer}`, { method: 'POST' });
export const fetchChildren = () => api.request('/me/school/children', { schema: myChildListSchema });
export const fetchChildFees = (studentId: string) => api.request(`/me/school/children/${studentId}/fees`, { schema: childFeeListSchema });
export const fetchChildClasses = (studentId: string) => api.request(`/me/school/children/${studentId}/classes`, { schema: childClassListSchema });

export const fetchMyParents = () => api.request('/me/school/guardians', { schema: myStudentGuardianListSchema });
export const endMyParentLink = (id: string) => api.request(`/me/school/guardians/${id}`, { method: 'DELETE' });

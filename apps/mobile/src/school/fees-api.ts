import { feeStatusListSchema, myFeeListSchema, schoolFeeListSchema, schoolFeeSchema, type CreateFeeRequest } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const feeKeys = {
  mine: ['school', 'fees', 'mine'] as const,
  list: (orgId: string, classId: string) => ['school', orgId, 'fees', classId] as const,
  statuses: (orgId: string, classId: string, feeId: string) => ['school', orgId, 'fees', classId, feeId] as const,
};

const base = (orgId: string, classId: string) => `/orgs/${orgId}/school/classes/${classId}/fees`;
export const fetchMyFees = () => api.request('/me/school/fees', { schema: myFeeListSchema });
export const fetchFees = (orgId: string, classId: string) => api.request(base(orgId, classId), { schema: schoolFeeListSchema });
export const createFee = (orgId: string, classId: string, body: CreateFeeRequest) => api.request(base(orgId, classId), { method: 'POST', body, schema: schoolFeeSchema });
export const fetchFeeStatuses = (orgId: string, classId: string, feeId: string) => api.request(`${base(orgId, classId)}/${feeId}/statuses`, { schema: feeStatusListSchema });
export const markFee = (orgId: string, classId: string, feeId: string, handle: string, paid: boolean) =>
  api.request(`${base(orgId, classId)}/${feeId}/mark`, { method: 'POST', body: { handle, paid } });

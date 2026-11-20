import {
  type CreateLeaveRequest,
  type CreateShiftRequest,
  type DecideLeaveRequest,
  employeeDetailSchema,
  employeeListSchema,
  leaveListSchema,
  leaveRequestSchema,
  myLeavesSchema,
  type LeaveStatus,
  salaryLineSchema,
  salaryListSchema,
  type SaveEmployeeProfileRequest,
  type SaveSalaryLineRequest,
  shiftListSchema,
  shiftSchema,
} from '@caselind/contracts';
import { api } from '../../auth/auth-context';

export const hrKeys = {
  all: (orgId: string) => ['hr', orgId] as const,
  employees: (orgId: string) => ['hr', orgId, 'employees'] as const,
  leaves: (orgId: string, status?: LeaveStatus) => ['hr', orgId, 'leaves', status ?? 'all'] as const,
  shifts: (orgId: string, from: string, to: string) => ['hr', orgId, 'shifts', from, to] as const,
  salary: (orgId: string) => ['hr', orgId, 'salary'] as const,
  myLeaves: (orgId: string) => ['hr', orgId, 'me', 'leaves'] as const,
  myShifts: (orgId: string, from: string, to: string) => ['hr', orgId, 'me', 'shifts', from, to] as const,
  mySalary: (orgId: string) => ['hr', orgId, 'me', 'salary'] as const,
};

export const fetchEmployees = (orgId: string) => api.request(`/orgs/${orgId}/hr/employees`, { schema: employeeListSchema });
export const saveEmployee = (orgId: string, userId: string, body: SaveEmployeeProfileRequest) =>
  api.request(`/orgs/${orgId}/hr/employees/${userId}`, { method: 'PUT', body, schema: employeeDetailSchema });

export const fetchLeaves = (orgId: string, status?: LeaveStatus, cursor?: string) =>
  api.request(`/orgs/${orgId}/hr/leaves`, { query: { status, cursor, limit: 50 }, schema: leaveListSchema });
export const decideLeave = (orgId: string, id: string, body: DecideLeaveRequest) =>
  api.request(`/orgs/${orgId}/hr/leaves/${id}/decision`, { method: 'POST', body, schema: leaveRequestSchema });
export const requestLeave = (orgId: string, body: CreateLeaveRequest) => api.request(`/orgs/${orgId}/hr/leaves`, { method: 'POST', body, schema: leaveRequestSchema });
export const cancelLeave = (orgId: string, id: string) => api.request(`/orgs/${orgId}/hr/leaves/${id}/cancel`, { method: 'POST', schema: leaveRequestSchema });

export const fetchShifts = (orgId: string, from: string, to: string) => api.request(`/orgs/${orgId}/hr/shifts`, { query: { from, to }, schema: shiftListSchema });
export const createShift = (orgId: string, body: CreateShiftRequest) => api.request(`/orgs/${orgId}/hr/shifts`, { method: 'POST', body, schema: shiftSchema });
export const deleteShift = (orgId: string, id: string) => api.request(`/orgs/${orgId}/hr/shifts/${id}`, { method: 'DELETE' });

export const fetchSalary = (orgId: string) => api.request(`/orgs/${orgId}/hr/salary`, { schema: salaryListSchema });
export const saveSalary = (orgId: string, body: SaveSalaryLineRequest) => api.request(`/orgs/${orgId}/hr/salary`, { method: 'PUT', body, schema: salaryLineSchema });
export const deleteSalary = (orgId: string, id: string) => api.request(`/orgs/${orgId}/hr/salary/${id}`, { method: 'DELETE' });

export const fetchMyLeaves = (orgId: string) => api.request('/me/hr/leaves', { query: { orgId }, schema: myLeavesSchema });
export const fetchMyShifts = (orgId: string, from: string, to: string) => api.request('/me/hr/shifts', { query: { orgId, from, to }, schema: shiftListSchema });
export const fetchMySalary = (orgId: string) => api.request('/me/hr/salary', { query: { orgId }, schema: salaryListSchema });

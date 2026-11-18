import {
  currentPosShiftSchema,
  posSaleListSchema,
  posSaleSchema,
  posShiftReportSchema,
  posShiftSchema,
  posSummarySchema,
  posTicketSchema,
  type ClosePosShiftRequest,
  type CreatePosSaleRequest,
  type OpenPosShiftRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchPosSummary = (orgId: string) => api.request(`/orgs/${orgId}/pos/summary`, { schema: posSummarySchema });
export const fetchPosSales = (orgId: string, limit = 5) => api.request(`/orgs/${orgId}/pos/sales?limit=${limit}`, { schema: posSaleListSchema });
export const createPosSale = (orgId: string, body: CreatePosSaleRequest) => api.request(`/orgs/${orgId}/pos/sales`, { method: 'POST', body, schema: posSaleSchema });
export const fetchPosTicket = (orgId: string, id: string) => api.request(`/orgs/${orgId}/pos/sales/${id}`, { schema: posTicketSchema });
export const voidPosSale = (orgId: string, id: string) => api.request(`/orgs/${orgId}/pos/sales/${id}/void`, { method: 'POST', body: {}, schema: posSaleSchema });
export const fetchCurrentShift = (orgId: string) => api.request(`/orgs/${orgId}/pos/shifts/current`, { schema: currentPosShiftSchema });
export const openPosShift = (orgId: string, body: OpenPosShiftRequest) => api.request(`/orgs/${orgId}/pos/shifts`, { method: 'POST', body, schema: posShiftSchema });
export const closePosShift = (orgId: string, id: string, body: ClosePosShiftRequest) => api.request(`/orgs/${orgId}/pos/shifts/${id}/close`, { method: 'POST', body, schema: posShiftReportSchema });

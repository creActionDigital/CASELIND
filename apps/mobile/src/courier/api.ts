import {
  courierOfferListSchema,
  courierRequestEstimateSchema,
  courierRequestListSchema,
  courierRequestSchema,
  courierRoutePlanSchema,
  myCourierJobsSchema,
  type CreateCourierRequest,
  type CourierRequestEstimateRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const courierKeys = {
  all: ['courier'] as const,
  mine: (scope: string) => ['courier', 'mine', scope] as const,
  one: (id: string) => ['courier', 'one', id] as const,
  offers: ['courier', 'offers'] as const,
  jobs: (scope: string) => ['courier', 'jobs', scope] as const,
  plan: (ids: string, lat: number, lng: number) => ['courier', 'plan', ids, lat, lng] as const,
};

/* Demandeur */
export const estimateCourier = (body: CourierRequestEstimateRequest) =>
  api.request('/courier-requests/estimate', { method: 'POST', body, schema: courierRequestEstimateSchema });
export const createCourierRequest = (body: CreateCourierRequest) =>
  api.request('/courier-requests', { method: 'POST', body, schema: courierRequestSchema });
export const fetchMyCourierRequests = (scope: 'active' | 'done' | 'all') =>
  api.request('/courier-requests', { query: { scope, limit: 50 }, schema: courierRequestListSchema });
export const fetchCourierRequest = (id: string) => api.request(`/courier-requests/${id}`, { schema: courierRequestSchema });
export const cancelCourierRequest = (id: string) => api.request(`/courier-requests/${id}/cancel`, { method: 'POST', body: {}, schema: courierRequestSchema });
export const resetCourierProof = (id: string) => api.request(`/courier-requests/${id}/reset-proof`, { method: 'POST', body: {}, schema: courierRequestSchema });
export const rateCourierRequest = (id: string, rating: number) =>
  api.request(`/courier-requests/${id}/rating`, { method: 'POST', body: { rating }, schema: courierRequestSchema });

/* Coursier */
export const fetchCourierOffers = (lat: number, lng: number, radiusKm?: number) =>
  api.request('/courier/requests', { query: { lat, lng, radiusKm }, schema: courierOfferListSchema });
export const fetchCourierJobs = (scope: 'active' | 'done') => api.request('/courier/requests/mine', { query: { scope, limit: 50 }, schema: myCourierJobsSchema });
export const acceptCourierRequest = (id: string) => api.request(`/courier/requests/${id}/accept`, { method: 'POST', body: {}, schema: courierRequestSchema });
export const pickedUpCourierRequest = (id: string) => api.request(`/courier/requests/${id}/picked-up`, { method: 'POST', body: {}, schema: courierRequestSchema });
export const deliveredCourierRequest = (id: string, code: string) =>
  api.request(`/courier/requests/${id}/delivered`, { method: 'POST', body: { code }, schema: courierRequestSchema });
export const setCourierLocationConsent = (id: string, granted: boolean) =>
  api.request(`/courier/requests/${id}/location-consent`, { method: 'PUT', body: { granted }, schema: courierRequestSchema });
export const postCourierLocation = (id: string, lat: number, lng: number) =>
  api.request(`/courier/requests/${id}/location`, { method: 'POST', body: { lat, lng } });
export const fetchRoutePlan = (ids: string[], lat: number, lng: number) =>
  api.request('/courier/route-plan', { query: { ids: ids.join(','), lat, lng }, schema: courierRoutePlanSchema });

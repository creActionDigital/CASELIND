import {
  courierDeliverySchema,
  deliveryDetailSchema,
  deliveryListSchema,
  deliveryViewSchema,
  deliveryZoneListSchema,
  deliveryZoneSchema,
  myDeliveryListSchema,
  orgMemberListSchema,
  type CreateDeliveryZoneRequest,
  type DeliveryStatus,
  type UpdateDeliveryZoneRequest,
} from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, useAuth } from '../auth/auth-context';

export const deliveryKeys = {
  zones: (orgId: string) => ['delivery', 'zones', orgId] as const,
  publicZones: (orgId: string) => ['delivery', 'public-zones', orgId] as const,
  mine: (scope: string) => ['delivery', 'mine', scope] as const,
  minePrefix: ['delivery', 'mine'] as const,
  one: (id: string) => ['delivery', 'one', id] as const,
  orgDelivery: (orgId: string, id: string) => ['delivery', 'org', orgId, id] as const,
  couriers: (orgId: string) => ['delivery', 'couriers', orgId] as const,
};

/* Acheteur */
export const fetchPublicZones = (orgId: string) =>
  api.request(`/delivery/orgs/${orgId}/zones`, { schema: deliveryZoneListSchema });
export const rateDelivery = (orderId: string, body: { rating: number; comment?: string }) =>
  api.request(`/orders/${orderId}/delivery/rating`, { method: 'POST', body, schema: deliveryViewSchema });

/* Vendeur */
export const fetchZones = (orgId: string) => api.request(`/orgs/${orgId}/delivery-zones`, { schema: deliveryZoneListSchema });
export const createZone = (orgId: string, body: CreateDeliveryZoneRequest) =>
  api.request(`/orgs/${orgId}/delivery-zones`, { method: 'POST', body, schema: deliveryZoneSchema });
export const patchZone = (orgId: string, id: string, body: UpdateDeliveryZoneRequest) =>
  api.request(`/orgs/${orgId}/delivery-zones/${id}`, { method: 'PATCH', body, schema: deliveryZoneSchema });
export const fetchOrgDelivery = (orgId: string, id: string) =>
  api.request(`/orgs/${orgId}/deliveries/${id}`, { schema: deliveryDetailSchema });
export const fetchOrgDeliveries = (orgId: string, status: DeliveryStatus | undefined, cursor?: string) =>
  api.request(`/orgs/${orgId}/deliveries`, { query: { status, limit: 20, cursor }, schema: deliveryListSchema });
export const setOrgDeliveryStatus = (orgId: string, id: string, status: 'failed' | 'returned', reason: string) =>
  api.request(`/orgs/${orgId}/deliveries/${id}/status`, { method: 'POST', body: { status, reason }, schema: deliveryDetailSchema });
export const assignCourier = (orgId: string, id: string, courierUserId: string) =>
  api.request(`/orgs/${orgId}/deliveries/${id}/assign`, { method: 'POST', body: { courierUserId }, schema: deliveryDetailSchema });
export const resetProof = (orgId: string, id: string) =>
  api.request(`/orgs/${orgId}/deliveries/${id}/proof-reset`, { method: 'POST', body: {}, schema: deliveryDetailSchema });
/** Membres actifs (rôle `delivery` en tête de filtre côté écran) ; 403 sans `org.members.view`. */
export const fetchOrgMembers = (orgId: string) =>
  api.request(`/orgs/${orgId}/members`, { query: { status: 'active', limit: 100 }, schema: orgMemberListSchema });

/* Livreur */
export const fetchMyDeliveries = (scope: 'active' | 'done' | 'all', cursor?: string) =>
  api.request('/me/deliveries', { query: { scope, limit: 20, cursor }, schema: myDeliveryListSchema });
export const fetchMyDelivery = (id: string) => api.request(`/me/deliveries/${id}`, { schema: courierDeliverySchema });
export const courierStatus = (id: string, body: { status: string; code?: string; reason?: string; note?: string }) =>
  api.request(`/me/deliveries/${id}/status`, { method: 'POST', body, schema: courierDeliverySchema });
export const reportIncident = (id: string, reason: string) =>
  api.request(`/me/deliveries/${id}/incident`, { method: 'POST', body: { reason }, schema: courierDeliverySchema });
export const setLocationConsent = (id: string, granted: boolean) =>
  api.request(`/me/deliveries/${id}/location-consent`, { method: 'PUT', body: { granted }, schema: courierDeliverySchema });
export const postLocation = (id: string, lat: number, lng: number) =>
  api.request(`/me/deliveries/${id}/location`, { method: 'POST', body: { lat, lng } });

/** Zones actives d'une boutique pour le checkout (erreur ou flag absent : aucune zone, livraison libre côté UI). */
export function usePublicZones(orgId: string) {
  const { status } = useAuth();
  return useQuery({ queryKey: deliveryKeys.publicZones(orgId), queryFn: () => fetchPublicZones(orgId), enabled: status === 'signedIn', retry: false });
}

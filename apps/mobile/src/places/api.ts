import { orgLocationSchema, placeListSchema, type OrgKind } from '@caselind/contracts';
import { api } from '../auth/auth-context';
import type { LatLng } from './geo';

export interface PlacesFilters extends LatLng {
  radiusKm: number;
  kind?: OrgKind;
  q?: string;
}

/** La position ne sort de l'appareil que comme paramètres de cette requête (ADR-019) ; elle n'est jamais stockée. */
export const fetchPlaces = (f: PlacesFilters, cursor?: string) =>
  api.request('/places', {
    query: { lat: f.lat, lng: f.lng, radiusKm: f.radiusKm, kind: f.kind, q: f.q || undefined, limit: 20, cursor },
    schema: placeListSchema,
  });

export const fetchOrgLocation = (orgId: string) =>
  api.request(`/orgs/${orgId}/location`, { schema: orgLocationSchema.nullable() });
export const setOrgLocation = (orgId: string, body: { lat: number; lng: number; label?: string }) =>
  api.request(`/orgs/${orgId}/location`, { method: 'POST', body });
export const updateOrgLocation = (orgId: string, body: { lat?: number; lng?: number; label?: string | null }) =>
  api.request(`/orgs/${orgId}/location`, { method: 'PATCH', body });
export const removeOrgLocation = (orgId: string) => api.request(`/orgs/${orgId}/location`, { method: 'DELETE' });

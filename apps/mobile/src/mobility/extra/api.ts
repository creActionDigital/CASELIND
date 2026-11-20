import {
  carpoolBookingSchema,
  carpoolMineListSchema,
  carpoolQuoteSchema,
  carpoolRatingSchema,
  carpoolTripListSchema,
  carpoolTripSchema,
  rentalBookingListSchema,
  rentalBookingSchema,
  rentalVehicleListSchema,
  rentalVehicleSchema,
  roadsideOfferListSchema,
  roadsideRequestListSchema,
  roadsideRequestSchema,
  type CarpoolQuoteRequest,
  type CreateCarpoolTripRequest,
  type CreateRentalBookingRequest,
  type CreateRentalVehicleRequest,
  type CreateRoadsideRequest,
  type UpdateRentalVehicleRequest,
} from '@caselind/contracts';
import { api } from '../../auth/auth-context';

/** Covoiturage, location de véhicules et dépannage : clients de l'API (espèces entre les parties, aucun paiement en ligne). */

export const extraKeys = {
  carpoolSearch: (qs: string) => ['carpool', 'search', qs] as const,
  carpoolTrip: (id: string) => ['carpool', 'trip', id] as const,
  carpoolMine: (role: string) => ['carpool', 'mine', role] as const,
  carpoolAll: ['carpool'] as const,
  rentalSearch: (qs: string) => ['rentals', 'search', qs] as const,
  rentalVehicle: (id: string, period: string) => ['rentals', 'vehicle', id, period] as const,
  rentalMine: ['rentals', 'mine'] as const,
  rentalAll: ['rentals'] as const,
  orgRentals: (orgId: string) => ['rentals', 'org', orgId] as const,
  orgRentalBookings: (orgId: string) => ['rentals', 'org-bookings', orgId] as const,
  roadsideMine: (role: string) => ['roadside', 'mine', role] as const,
  roadsideRequest: (id: string) => ['roadside', 'request', id] as const,
  roadsideOffers: ['roadside', 'offers'] as const,
  roadsideAll: ['roadside'] as const,
};

/* Covoiturage */
export const carpoolQuote = (body: CarpoolQuoteRequest) => api.request('/carpool/quote', { method: 'POST', body, schema: carpoolQuoteSchema });
export const createCarpoolTrip = (body: CreateCarpoolTripRequest) => api.request('/carpool/trips', { method: 'POST', body, schema: carpoolTripSchema });
export const searchCarpool = (query: Record<string, string | number | undefined>) => api.request('/carpool/trips', { query, schema: carpoolTripListSchema });
export const fetchCarpoolTrip = (id: string) => api.request(`/carpool/trips/${id}`, { schema: carpoolTripSchema });
export const fetchMyCarpool = (role: 'driver' | 'passenger') => api.request('/carpool/mine', { query: { role }, schema: carpoolMineListSchema });
export const bookCarpool = (id: string, seats: number) => api.request(`/carpool/trips/${id}/bookings`, { method: 'POST', body: { seats }, schema: carpoolBookingSchema });
export const carpoolBookingStep = (id: string, step: 'accept' | 'decline' | 'cancel') =>
  api.request(`/carpool/bookings/${id}/${step}`, { method: 'POST', body: {}, schema: carpoolBookingSchema });
export const carpoolTripStep = (id: string, step: 'depart' | 'complete' | 'cancel') =>
  api.request(`/carpool/trips/${id}/${step}`, { method: 'POST', body: {}, schema: carpoolTripSchema });
export const rateCarpool = (id: string, userId: string, rating: number) =>
  api.request(`/carpool/trips/${id}/ratings`, { method: 'POST', body: { userId, rating }, schema: carpoolRatingSchema });

/* Location de véhicules : locataire */
export const searchRentals = (query: Record<string, string | number | undefined>) => api.request('/rentals', { query, schema: rentalVehicleListSchema });
export const fetchRental = (id: string, from?: string, to?: string) =>
  api.request(`/rentals/${id}`, { query: { from, to }, schema: rentalVehicleSchema });
export const bookRental = (id: string, body: CreateRentalBookingRequest) => api.request(`/rentals/${id}/bookings`, { method: 'POST', body, schema: rentalBookingSchema });
export const fetchMyRentals = () => api.request('/me/rental-bookings', { query: { limit: 50 }, schema: rentalBookingListSchema });
export const cancelRental = (id: string) => api.request(`/rental-bookings/${id}/cancel`, { method: 'POST', body: {}, schema: rentalBookingSchema });

/* Location de véhicules : organisation (catalog.manage) */
export const fetchOrgRentals = (orgId: string) => api.request(`/orgs/${orgId}/rentals`, { query: { limit: 100 }, schema: rentalVehicleListSchema });
export const createOrgRental = (orgId: string, body: CreateRentalVehicleRequest) => api.request(`/orgs/${orgId}/rentals`, { method: 'POST', body, schema: rentalVehicleSchema });
export const patchOrgRental = (orgId: string, id: string, body: UpdateRentalVehicleRequest) =>
  api.request(`/orgs/${orgId}/rentals/${id}`, { method: 'PATCH', body, schema: rentalVehicleSchema });
export const fetchOrgRentalBookings = (orgId: string) => api.request(`/orgs/${orgId}/rental-bookings`, { query: { limit: 100 }, schema: rentalBookingListSchema });
export const orgRentalStep = (orgId: string, id: string, step: 'confirm' | 'decline' | 'pickup' | 'return' | 'cancel') =>
  api.request(`/orgs/${orgId}/rental-bookings/${id}/${step}`, { method: 'POST', body: {}, schema: rentalBookingSchema });

/* Dépannage */
export const createRoadside = (body: CreateRoadsideRequest) => api.request('/roadside/requests', { method: 'POST', body, schema: roadsideRequestSchema });
export const fetchRoadsideOffers = (lat: number, lng: number) => api.request('/roadside/requests', { query: { lat, lng }, schema: roadsideOfferListSchema });
export const fetchMyRoadside = (role: 'requester' | 'provider') => api.request('/roadside/requests/mine', { query: { role }, schema: roadsideRequestListSchema });
export const fetchRoadside = (id: string) => api.request(`/roadside/requests/${id}`, { schema: roadsideRequestSchema });
export const roadsideStep = (id: string, step: 'cancel' | 'accept' | 'done' | 'release') =>
  api.request(`/roadside/requests/${id}/${step}`, { method: 'POST', body: {}, schema: roadsideRequestSchema });
export const roadsideOnTheWay = (id: string, etaMinutes: number) =>
  api.request(`/roadside/requests/${id}/on-the-way`, { method: 'POST', body: { etaMinutes }, schema: roadsideRequestSchema });
export const roadsideConsent = (id: string, granted: boolean) =>
  api.request(`/roadside/requests/${id}/location-consent`, { method: 'PUT', body: { granted }, schema: roadsideRequestSchema });
export const postRoadsideLocation = (id: string, lat: number, lng: number) => api.request(`/roadside/requests/${id}/location`, { method: 'POST', body: { lat, lng } });

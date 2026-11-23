import {
  driverProfileSchema,
  favoritePlaceListSchema,
  favoritePlaceSchema,
  rideAlertResultSchema,
  rideEstimateSchema,
  rideListSchema,
  rideMessageListSchema,
  rideMessageSchema,
  rideOffersSchema,
  rideReceiptSchema,
  rideShareSchema,
  sharedRideSchema,
  rideViewSchema,
  trustedContactListSchema,
  type CancelReason,
  type CreateFavoritePlaceRequest,
  type CreateRideRequest,
  type QuickMessageCode,
  type RideEstimateRequest,
  type UpsertDriverRequest,
} from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, useAuth } from '../auth/auth-context';
import { ApiRequestError } from '../lib/api';

export const rideKeys = {
  all: ['mobility'] as const,
  ride: (id: string) => ['mobility', 'ride', id] as const,
  mine: (scope: string) => ['mobility', 'mine', scope] as const,
  minePrefix: ['mobility', 'mine'] as const,
  messages: (id: string) => ['mobility', 'messages', id] as const,
  receipt: (id: string) => ['mobility', 'receipt', id] as const,
  favorites: ['mobility', 'favorites'] as const,
  contacts: ['mobility', 'contacts'] as const,
  driver: ['mobility', 'driver'] as const,
  offers: ['mobility', 'offers'] as const,
};

/* Passager */
export const estimateRide = (body: RideEstimateRequest) => api.request('/rides/estimate', { method: 'POST', body, schema: rideEstimateSchema });
export const createRide = (body: CreateRideRequest) => api.request('/rides', { method: 'POST', body, schema: rideViewSchema });
export const fetchMyRides = (scope: 'active' | 'done' | 'all') => api.request('/me/rides', { query: { scope, limit: 50 }, schema: rideListSchema });
export const fetchRide = (id: string) => api.request(`/rides/${id}`, { schema: rideViewSchema });
export const fetchReceipt = (id: string) => api.request(`/rides/${id}/receipt`, { schema: rideReceiptSchema });
export const cancelRide = (id: string, reason: CancelReason) => api.request(`/rides/${id}/cancel`, { method: 'POST', body: { reason }, schema: rideViewSchema });
/** Vue en lecture seule d'un trajet partagé (route publique : valable tant qu'un chauffeur est en course). */
export const fetchSharedRide = (token: string) => api.request(`/rides/shared/${encodeURIComponent(token)}`, { schema: sharedRideSchema });
export const shareRide = (id: string) => api.request(`/rides/${id}/share`, { method: 'POST', body: {}, schema: rideShareSchema });
export const alertRide = (id: string) => api.request(`/rides/${id}/alert`, { method: 'POST', body: {}, schema: rideAlertResultSchema });
export const rateRide = (id: string, body: { rating: number; comment?: string }) => api.request(`/rides/${id}/rating`, { method: 'POST', body });
export const fetchRideMessages = (id: string) => api.request(`/rides/${id}/messages`, { schema: rideMessageListSchema });
export const sendRideMessage = (id: string, code: QuickMessageCode) =>
  api.request(`/rides/${id}/messages`, { method: 'POST', body: { code }, schema: rideMessageSchema });

/* Lieux favoris et contacts de confiance */
export const fetchFavorites = () => api.request('/me/favorite-places', { schema: favoritePlaceListSchema });
export const addFavorite = (body: CreateFavoritePlaceRequest) => api.request('/me/favorite-places', { method: 'POST', body, schema: favoritePlaceSchema });
export const deleteFavorite = (id: string) => api.request(`/me/favorite-places/${id}`, { method: 'DELETE' });
export const fetchContacts = () => api.request('/me/trusted-contacts', { schema: trustedContactListSchema });
export const saveContacts = (handles: string[]) => api.request('/me/trusted-contacts', { method: 'PUT', body: { handles }, schema: trustedContactListSchema });

/* Chauffeur */
export const fetchDriver = () => api.request('/mobility/driver', { schema: driverProfileSchema });
export const saveDriver = (body: UpsertDriverRequest) => api.request('/mobility/driver', { method: 'PUT', body, schema: driverProfileSchema });
export const setDriverOnline = (online: boolean) => api.request('/mobility/driver/online', { method: 'POST', body: { online } });
export const postDriverLocation = (lat: number, lng: number) => api.request('/mobility/driver/location', { method: 'POST', body: { lat, lng } });
export const fetchOffers = () => api.request('/mobility/driver/offers', { schema: rideOffersSchema });
export const acceptRide = (id: string) => api.request(`/rides/${id}/accept`, { method: 'POST', body: {}, schema: rideViewSchema });
export const markArrived = (id: string) => api.request(`/rides/${id}/arriving`, { method: 'POST', body: {}, schema: rideViewSchema });
export const startRide = (id: string, code: string) => api.request(`/rides/${id}/start`, { method: 'POST', body: { code }, schema: rideViewSchema });
export const completeRide = (id: string) => api.request(`/rides/${id}/complete`, { method: 'POST', body: {}, schema: rideViewSchema });

/** Profil chauffeur de l'utilisateur ; 404 = pas encore chauffeur (null). */
export async function fetchDriverOrNull() {
  try {
    return await fetchDriver();
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null;
    throw e;
  }
}
export function useDriverProfile() {
  const { status } = useAuth();
  return useQuery({ queryKey: rideKeys.driver, queryFn: fetchDriverOrNull, enabled: status === 'signedIn', retry: false });
}

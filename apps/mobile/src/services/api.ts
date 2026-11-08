import {
  availabilitySchema,
  bookingDetailSchema,
  bookingListSchema,
  serviceCategoryListSchema,
  serviceOfferDetailSchema,
  serviceOfferListSchema,
  serviceProfileSchema,
  serviceReviewListSchema,
  serviceReviewSchema,
  slotListSchema,
  type BookingStatus,
  type ServiceOffer,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

/** Propriétaire d'offres : `me` (prestataire individuel) ou l'identifiant d'une organisation de type services. */
export type Scope = 'me' | (string & {});
const base = (scope: Scope) => (scope === 'me' ? '/me' : `/orgs/${scope}`);

export const svcKeys = {
  categories: ['services', 'categories'] as const,
  discovery: (f: unknown) => ['services', 'discovery', f] as const,
  offer: (id: string) => ['services', 'offer', id] as const,
  slots: (id: string) => ['services', 'slots', id] as const,
  reviews: (id: string) => ['services', 'reviews', id] as const,
  myBookings: ['services', 'bookings', 'mine'] as const,
  booking: (id: string) => ['services', 'booking', id] as const,
  profile: ['services', 'profile'] as const,
  offers: (scope: Scope) => ['services', 'offers', scope] as const,
  ownOffer: (scope: Scope, id: string) => ['services', 'own-offer', scope, id] as const,
  received: (scope: Scope) => ['services', 'received', scope] as const,
};

export interface DiscoveryFilters {
  q?: string;
  categoryId?: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export const fetchServiceCategories = () => api.request('/service-categories', { schema: serviceCategoryListSchema });
/** La position ne sert qu'à cette requête : jamais stockée (ADR-019). */
export const fetchDiscovery = (f: DiscoveryFilters, cursor?: string) =>
  api.request('/services', {
    query: { q: f.q || undefined, categoryId: f.categoryId, lat: f.lat, lng: f.lng, radiusKm: f.radiusKm, limit: PAGE, cursor },
    schema: serviceOfferListSchema,
  });
export const fetchOffer = (id: string) => api.request(`/services/${id}`, { schema: serviceOfferDetailSchema });
export const fetchSlots = (id: string, from: string, to: string) => api.request(`/services/${id}/slots`, { query: { from, to }, schema: slotListSchema });
export const fetchServiceReviews = (id: string, cursor?: string) =>
  api.request(`/services/${id}/reviews`, { query: { limit: PAGE, cursor }, schema: serviceReviewListSchema });

export const createBooking = (offerId: string, body: { startsAt: string; note?: string }) =>
  api.request(`/services/${offerId}/bookings`, { method: 'POST', body, schema: bookingDetailSchema });
export const fetchMyBookings = (status: BookingStatus | undefined, cursor?: string) =>
  api.request('/me/bookings', { query: { status, limit: PAGE, cursor }, schema: bookingListSchema });
export const fetchBooking = (id: string) => api.request(`/bookings/${id}`, { schema: bookingDetailSchema });

export type BookingAction = 'confirm' | 'decline' | 'cancel' | 'complete' | 'no-show' | 'quote/accept' | 'quote/decline';
export const bookingAction = (id: string, action: BookingAction, reason?: string) =>
  api.request(`/bookings/${id}/${action}`, {
    method: 'POST',
    body: action === 'decline' || action === 'cancel' ? (reason ? { reason } : {}) : {},
    schema: bookingDetailSchema,
  });
export const proposeQuote = (id: string, amountMinor: number, currency: string) =>
  api.request(`/bookings/${id}/quote`, { method: 'POST', body: { amountMinor, currency }, schema: bookingDetailSchema });
export const reviewBooking = (id: string, body: { rating: number; body?: string }) =>
  api.request(`/bookings/${id}/review`, { method: 'POST', body, schema: serviceReviewSchema });
export const replyToReview = (reviewId: string, body: string) =>
  api.request(`/service-reviews/${reviewId}/reply`, { method: 'POST', body: { body }, schema: serviceReviewSchema });

/* Côté prestataire */
export const fetchProfile = () => api.request('/me/service-profile', { schema: serviceProfileSchema });
export const saveProfile = (body: { displayName: string; bio: string | null; city: string | null; skills: string[] }) =>
  api.request('/me/service-profile', { method: 'PUT', body, schema: serviceProfileSchema });
export const fetchOwnOffers = (scope: Scope, cursor?: string) =>
  api.request(`${base(scope)}/services`, { query: { limit: 50, cursor }, schema: serviceOfferListSchema });
export const fetchOwnOffer = (scope: Scope, id: string) => api.request(`${base(scope)}/services/${id}`, { schema: serviceOfferDetailSchema });
export const createOffer = (scope: Scope, body: unknown) =>
  api.request(`${base(scope)}/services`, { method: 'POST', body, schema: serviceOfferDetailSchema });
export const updateOffer = (scope: Scope, id: string, body: unknown) =>
  api.request(`${base(scope)}/services/${id}`, { method: 'PATCH', body, schema: serviceOfferDetailSchema });
export const archiveOffer = (scope: Scope, id: string) => api.request(`${base(scope)}/services/${id}`, { method: 'DELETE' });
export const setAvailability = (scope: Scope, id: string, body: unknown) =>
  api.request(`${base(scope)}/services/${id}/availability`, { method: 'PUT', body, schema: availabilitySchema });
export const fetchReceived = (scope: Scope, status: BookingStatus | undefined, cursor?: string) =>
  api.request(scope === 'me' ? '/me/service-bookings' : `/orgs/${scope}/service-bookings`, {
    query: { status, limit: PAGE, cursor },
    schema: bookingListSchema,
  });

export type { ServiceOffer };

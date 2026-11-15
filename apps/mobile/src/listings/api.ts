import { listingListSchema, listingSchema, type CreateListingRequest, type ListingKind } from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

export interface ListingFilters {
  kind?: ListingKind;
  q?: string;
}

export const listingKeys = {
  all: ['listings'] as const,
  list: (f: ListingFilters) => ['listings', 'list', f] as const,
  mine: ['listings', 'mine'] as const,
  one: (id: string) => ['listings', 'one', id] as const,
};

export const fetchListings = (f: ListingFilters, cursor?: string) =>
  api.request('/listings', { query: { kind: f.kind, q: f.q || undefined, limit: PAGE, cursor }, schema: listingListSchema });
export const fetchMyListings = (cursor?: string) => api.request('/listings/mine', { query: { limit: PAGE, cursor }, schema: listingListSchema });
export const fetchListing = (id: string) => api.request(`/listings/${id}`, { schema: listingSchema });
export const createListing = (body: CreateListingRequest) => api.request('/listings', { method: 'POST', body, schema: listingSchema });
export const closeListing = (id: string) => api.request(`/listings/${id}/close`, { method: 'POST', schema: listingSchema });

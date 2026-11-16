import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** Classified ads (lot 15). Contact goes through CASELIND messaging; no payment, no verification partner. */
export const listingKindSchema = z.enum(['property_rent', 'property_sale', 'roommate', 'vehicle', 'used_item', 'lost', 'found']);
export type ListingKind = z.infer<typeof listingKindSchema>;

const currencySchema = z.string().regex(/^[A-Z]{3}$/);

const listingFields = {
  kind: listingKindSchema,
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000),
  /** Both or neither; lost/found items carry no price. */
  priceMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  currency: currencySchema.nullable(),
  city: z.string().trim().min(2).max(80),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  mediaIds: z.array(z.uuid()).max(8),
};

const refine = <T extends z.ZodType<{ kind?: ListingKind; priceMinor?: number | null; currency?: string | null; latitude?: number | null; longitude?: number | null }>>(s: T) =>
  s
    .refine((v) => (v.priceMinor === null || v.priceMinor === undefined) === (v.currency === null || v.currency === undefined), {
      path: ['currency'],
      message: 'priceMinor and currency go together',
    })
    .refine((v) => (v.latitude === null || v.latitude === undefined) === (v.longitude === null || v.longitude === undefined), {
      path: ['longitude'],
      message: 'latitude and longitude go together',
    })
    .refine((v) => !(v.kind === 'lost' || v.kind === 'found') || v.priceMinor === null || v.priceMinor === undefined, {
      path: ['priceMinor'],
      message: 'lost and found items have no price',
    });

export const createListingRequestSchema = refine(
  z.object({
    ...listingFields,
    description: listingFields.description.default(''),
    priceMinor: listingFields.priceMinor.default(null),
    currency: listingFields.currency.default(null),
    latitude: listingFields.latitude.default(null),
    longitude: listingFields.longitude.default(null),
    mediaIds: listingFields.mediaIds.default([]),
  }),
);
export type CreateListingRequest = z.infer<typeof createListingRequestSchema>;

/** Owner edit: the kind cannot change; every other field is optional. */
export const updateListingRequestSchema = refine(z.object(listingFields).omit({ kind: true }).partial());
export type UpdateListingRequest = z.infer<typeof updateListingRequestSchema>;

export const listingListQuerySchema = pageQuerySchema.extend({
  kind: listingKindSchema.optional(),
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(80).optional(),
  currency: currencySchema.optional(),
  minPriceMinor: z.coerce.number().int().min(0).optional(),
  maxPriceMinor: z.coerce.number().int().min(0).optional(),
});
export type ListingListQuery = z.infer<typeof listingListQuerySchema>;

export const listingSchema = z.object({
  id: z.uuid(),
  kind: listingKindSchema,
  title: z.string(),
  description: z.string(),
  priceMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  city: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  status: z.enum(['active', 'closed']),
  mediaIds: z.array(z.uuid()),
  owner: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  mine: z.boolean(),
  createdAt: z.string(),
});
export type Listing = z.infer<typeof listingSchema>;

export const listingListSchema = z.object({ items: z.array(listingSchema), nextCursor: z.string().nullable() });
export type ListingList = z.infer<typeof listingListSchema>;

/** Listing alerts (lot 15b): up to 5 per person, private, at least one criterion. */
export const MAX_LISTING_ALERTS = 5;
export const createListingAlertRequestSchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    kind: listingKindSchema.optional(),
  })
  .refine((v) => v.q !== undefined || v.city !== undefined || v.kind !== undefined, { path: ['q'], message: 'at least one criterion is required' });
export type CreateListingAlertRequest = z.infer<typeof createListingAlertRequestSchema>;
export const listingAlertSchema = z.object({
  id: z.uuid(),
  q: z.string().nullable(),
  city: z.string().nullable(),
  kind: listingKindSchema.nullable(),
  createdAt: z.string(),
});
export type ListingAlert = z.infer<typeof listingAlertSchema>;
export const listingAlertListSchema = z.object({ items: z.array(listingAlertSchema) });
export type ListingAlertList = z.infer<typeof listingAlertListSchema>;

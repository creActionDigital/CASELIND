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

/** Vehicle ads only (lot 15e), all optional. */
export const vehicleFuelSchema = z.enum(['petrol', 'diesel', 'hybrid', 'electric', 'other']);
export const vehicleTransmissionSchema = z.enum(['manual', 'automatic']);
export const VEHICLE_YEAR_MIN = 1950;
const vehicleFields = {
  make: z.string().trim().min(1).max(40).nullable(),
  model: z.string().trim().min(1).max(40).nullable(),
  year: z.number().int().min(VEHICLE_YEAR_MIN).max(new Date().getFullYear() + 1).nullable(),
  mileageKm: z.number().int().min(0).max(2_000_000).nullable(),
  fuel: vehicleFuelSchema.nullable(),
  transmission: vehicleTransmissionSchema.nullable(),
};
export const VEHICLE_KEYS = ['make', 'model', 'year', 'mileageKm', 'fuel', 'transmission'] as const;

type RefinedShape = {
  kind?: ListingKind;
  priceMinor?: number | null;
  currency?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  make?: unknown;
  model?: unknown;
  year?: unknown;
  mileageKm?: unknown;
  fuel?: unknown;
  transmission?: unknown;
};
const refine = <T extends z.ZodType<RefinedShape>>(s: T) =>
  s
    .refine((v) => v.kind === undefined || v.kind === 'vehicle' || VEHICLE_KEYS.every((k) => v[k] === null || v[k] === undefined), {
      path: ['make'],
      message: 'vehicle fields are only for vehicle ads',
    })
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
    make: vehicleFields.make.default(null),
    model: vehicleFields.model.default(null),
    year: vehicleFields.year.default(null),
    mileageKm: vehicleFields.mileageKm.default(null),
    fuel: vehicleFields.fuel.default(null),
    transmission: vehicleFields.transmission.default(null),
  }),
);
export type CreateListingRequest = z.infer<typeof createListingRequestSchema>;

/** Owner edit: the kind cannot change; every other field is optional. */
export const updateListingRequestSchema = refine(z.object({ ...listingFields, ...vehicleFields }).omit({ kind: true }).partial());
export type UpdateListingRequest = z.infer<typeof updateListingRequestSchema>;

export const listingListQuerySchema = pageQuerySchema.extend({
  kind: listingKindSchema.optional(),
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(80).optional(),
  currency: currencySchema.optional(),
  minPriceMinor: z.coerce.number().int().min(0).optional(),
  maxPriceMinor: z.coerce.number().int().min(0).optional(),
  yearMin: z.coerce.number().int().min(VEHICLE_YEAR_MIN).optional(),
  yearMax: z.coerce.number().int().optional(),
  mileageMax: z.coerce.number().int().min(0).optional(),
  fuel: vehicleFuelSchema.optional(),
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
  make: vehicleFields.make,
  model: vehicleFields.model,
  year: vehicleFields.year,
  mileageKm: vehicleFields.mileageKm,
  fuel: vehicleFields.fuel,
  transmission: vehicleFields.transmission,
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

/** Visit appointments (lot 15c). The precise place is only exposed once confirmed, and only to the two parties. */
export const MAX_PENDING_VISITS = 5;
export const MAX_VISIT_DAYS_AHEAD = 60;
export const createVisitRequestSchema = z.object({
  scheduledAt: z.iso.datetime(),
  message: z.string().trim().max(300).default(''),
});
export type CreateVisitRequest = z.infer<typeof createVisitRequestSchema>;
export const confirmVisitRequestSchema = z.object({ place: z.string().trim().min(1).max(200).optional() });
export type ConfirmVisitRequest = z.infer<typeof confirmVisitRequestSchema>;
export const listingVisitSchema = z.object({
  id: z.uuid(),
  listingId: z.uuid(),
  listingTitle: z.string(),
  status: z.enum(['requested', 'confirmed', 'declined', 'cancelled']),
  scheduledAt: z.string(),
  message: z.string(),
  /** Only when confirmed. */
  place: z.string().nullable(),
  /** The caller's side: the visitor who asked, or the ad's owner who answers. */
  role: z.enum(['visitor', 'owner']),
  other: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  createdAt: z.string(),
});
export type ListingVisit = z.infer<typeof listingVisitSchema>;
export const listingVisitListSchema = z.object({ items: z.array(listingVisitSchema) });
export type ListingVisitList = z.infer<typeof listingVisitListSchema>;

/** Guided negotiation (lot 15d). Indicative only: accepting sells nothing and triggers no payment. */
export const MAX_OPEN_OFFERS = 5;
export const MIN_OFFER_PERCENT = 10;
export const createOfferRequestSchema = z.object({
  amountMinor: z.number().int().min(1).max(1_000_000_000_000),
  message: z.string().trim().max(300).default(''),
});
export type CreateOfferRequest = z.infer<typeof createOfferRequestSchema>;
export const counterOfferRequestSchema = z.object({ amountMinor: z.number().int().min(1).max(1_000_000_000_000) });
export type CounterOfferRequest = z.infer<typeof counterOfferRequestSchema>;
export const listingOfferSchema = z.object({
  id: z.uuid(),
  listingId: z.uuid(),
  listingTitle: z.string(),
  status: z.enum(['offered', 'countered', 'accepted', 'declined', 'cancelled']),
  offerMinor: z.number().int(),
  counterMinor: z.number().int().nullable(),
  /** The listing's currency, fixed when the offer was made. */
  currency: z.string(),
  askingMinor: z.number().int().nullable(),
  message: z.string(),
  /** The caller's side: the buyer who offers, or the ad's owner who answers. */
  role: z.enum(['buyer', 'owner']),
  other: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  createdAt: z.string(),
});
export type ListingOffer = z.infer<typeof listingOfferSchema>;
export const listingOfferListSchema = z.object({ items: z.array(listingOfferSchema) });
export type ListingOfferList = z.infer<typeof listingOfferListSchema>;

/** Vehicle comparison (lot 15d): 2 to 3 active vehicle ads, same order as requested. */
export const compareListingsQuerySchema = z.object({ ids: z.string().min(1).max(200) });
export type CompareListingsQuery = z.infer<typeof compareListingsQuerySchema>;
export const compareListingsResponseSchema = z.object({ items: z.array(listingSchema) });
export type CompareListingsResponse = z.infer<typeof compareListingsResponseSchema>;

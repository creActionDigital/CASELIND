import { z } from 'zod';
import { latSchema, lngSchema } from './places.js';

/* Lot 9: local services and bookings. Payment is on site only (ADR-017). See docs/architecture/API_CONTRACTS.md. */

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM expected');
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD expected');
const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code expected');

export const serviceCategorySchema = z.object({ id: z.uuid(), slug: z.string(), name: z.string() });
export type ServiceCategory = z.infer<typeof serviceCategorySchema>;
export const serviceCategoryListSchema = z.object({ items: z.array(serviceCategorySchema) });
export type ServiceCategoryList = z.infer<typeof serviceCategoryListSchema>;

export const serviceOfferStatusSchema = z.enum(['draft', 'published', 'archived']);
export const servicePriceKindSchema = z.enum(['fixed', 'quote']);

/* ------------------------------------------------------------------ provider profile */

export const upsertServiceProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(1000).nullable().optional(),
  city: z.string().trim().min(1).max(100).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type UpsertServiceProfileRequest = z.infer<typeof upsertServiceProfileRequestSchema>;

export const serviceProfileSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  bio: z.string().nullable(),
  city: z.string().nullable(),
  skills: z.array(z.string()),
  verified: z.boolean(),
  verificationLabel: z.enum(['non vérifié', 'vérifié']),
  createdAt: z.iso.datetime(),
});
export type ServiceProfile = z.infer<typeof serviceProfileSchema>;

/* ------------------------------------------------------------------ availability */

export const availabilityRuleSchema = z
  .object({ weekday: z.number().int().min(1).max(7), start: timeSchema, end: timeSchema })
  .refine((v) => v.start < v.end, { message: 'start must be before end' });
export const availabilityExceptionSchema = z
  .object({ date: daySchema, closed: z.boolean(), start: timeSchema.optional(), end: timeSchema.optional() })
  .refine((v) => (v.closed ? v.start === undefined && v.end === undefined : v.start !== undefined && v.end !== undefined && v.start < v.end), {
    message: 'a closed day has no window; an open exception needs start < end',
  });

/** PUT .../availability: replaces the whole schedule. `weekday` is ISO (1 = Monday ... 7 = Sunday), times are local. */
export const setAvailabilityRequestSchema = z.object({
  rules: z.array(availabilityRuleSchema).max(70).default([]),
  exceptions: z.array(availabilityExceptionSchema).max(200).default([]),
});
export type SetAvailabilityRequest = z.infer<typeof setAvailabilityRequestSchema>;

export const availabilitySchema = z.object({
  rules: z.array(z.object({ weekday: z.number().int(), start: z.string(), end: z.string() })),
  exceptions: z.array(z.object({ date: z.string(), closed: z.boolean(), start: z.string().optional(), end: z.string().optional() })),
});
export type Availability = z.infer<typeof availabilitySchema>;

/* ------------------------------------------------------------------ offers */

const offerFields = {
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).nullable().optional(),
  categoryId: z.uuid(),
  priceKind: servicePriceKindSchema,
  priceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: currencySchema.optional(),
  durationMin: z.number().int().min(15).max(720),
  cancelNoticeHours: z.number().int().min(0).max(720).default(24),
  city: z.string().trim().min(1).max(100),
  /** Organisation offers default to the organisation location; individual offers must give their own. */
  lat: latSchema.optional(),
  lng: lngSchema.optional(),
  radiusKm: z.number().int().min(1).max(100).default(10),
  /** Minutes east of UTC of the provider's local time (no DST handling). */
  utcOffsetMinutes: z.number().int().min(-720).max(840).default(0),
  urgentAvailable: z.boolean().default(false),
  guaranteeNote: z.string().trim().min(1).max(200).nullable().optional(),
  mediaIds: z.array(z.uuid()).max(10).default([]),
};

export const createServiceOfferRequestSchema = z
  .object({ ...offerFields, status: z.enum(['draft', 'published']).default('draft') })
  .refine((v) => (v.priceKind === 'fixed' ? v.priceMinor !== undefined && v.currency !== undefined : v.priceMinor === undefined), {
    message: 'a fixed price needs priceMinor and currency; a quote offer has no price',
    path: ['priceMinor'],
  });
export type CreateServiceOfferRequest = z.infer<typeof createServiceOfferRequestSchema>;

export const updateServiceOfferRequestSchema = z
  .object({
    title: offerFields.title.optional(),
    description: offerFields.description,
    categoryId: offerFields.categoryId.optional(),
    priceKind: servicePriceKindSchema.optional(),
    priceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    currency: currencySchema.nullable().optional(),
    durationMin: offerFields.durationMin.optional(),
    cancelNoticeHours: z.number().int().min(0).max(720).optional(),
    city: offerFields.city.optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    radiusKm: z.number().int().min(1).max(100).optional(),
    utcOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    urgentAvailable: z.boolean().optional(),
    guaranteeNote: offerFields.guaranteeNote,
    mediaIds: offerFields.mediaIds.optional(),
    status: serviceOfferStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type UpdateServiceOfferRequest = z.infer<typeof updateServiceOfferRequestSchema>;

export const serviceProviderRefSchema = z.object({
  kind: z.enum(['org', 'individual']),
  orgId: z.uuid().nullable(),
  orgSlug: z.string().nullable(),
  userId: z.uuid().nullable(),
  handle: z.string().nullable(),
  name: z.string(),
  /** Always "non vérifié" until a verification exists. */
  verified: z.boolean(),
  verificationLabel: z.enum(['non vérifié', 'vérifié']),
});
export type ServiceProviderRef = z.infer<typeof serviceProviderRefSchema>;

export const serviceOfferSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  categoryId: z.uuid(),
  status: serviceOfferStatusSchema,
  hidden: z.boolean(),
  priceKind: servicePriceKindSchema,
  priceMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  /** Always "on_site": the platform never collects the amount. */
  paymentMode: z.literal('on_site'),
  durationMin: z.number().int(),
  cancelNoticeHours: z.number().int(),
  city: z.string(),
  lat: z.number(),
  lng: z.number(),
  radiusKm: z.number().int(),
  utcOffsetMinutes: z.number().int(),
  urgentAvailable: z.boolean(),
  guaranteeNote: z.string().nullable(),
  media: z.array(z.object({ id: z.uuid(), mime: z.string().nullable(), contentUrl: z.string() })),
  provider: serviceProviderRefSchema,
  /** Discovery with a position only: distance to the offer, and whether the point is inside its service zone. */
  distanceKm: z.number().nullable(),
  inServiceZone: z.boolean().nullable(),
  ratingCount: z.number().int(),
  averageRating: z.number().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ServiceOffer = z.infer<typeof serviceOfferSchema>;

export const serviceOfferDetailSchema = serviceOfferSchema.extend({ availability: availabilitySchema });
export type ServiceOfferDetail = z.infer<typeof serviceOfferDetailSchema>;

export const serviceOfferListSchema = z.object({ items: z.array(serviceOfferSchema), nextCursor: z.string().nullable() });
export type ServiceOfferList = z.infer<typeof serviceOfferListSchema>;

/** GET /v1/services: with lat+lng the list is sorted by distance within radiusKm (default 10, max 100). */
export const serviceDiscoveryQuerySchema = z
  .object({
    categoryId: z.uuid().optional(),
    q: z.string().trim().min(1).max(100).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(100).default(10),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(200).optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), { message: 'lat and lng go together', path: ['lat'] });
export type ServiceDiscoveryQuery = z.infer<typeof serviceDiscoveryQuerySchema>;

export const ownServiceListQuerySchema = z.object({
  status: serviceOfferStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type OwnServiceListQuery = z.infer<typeof ownServiceListQuerySchema>;

/* ------------------------------------------------------------------ slots */

/** GET /v1/services/:id/slots: ISO instants, at most 14 days; defaults to the next 7 days. */
export const slotsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

export const slotListSchema = z.object({
  items: z.array(z.object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() })),
});
export type SlotList = z.infer<typeof slotListSchema>;

/* ------------------------------------------------------------------ bookings */

export const bookingStatusSchema = z.enum(['requested', 'confirmed', 'completed', 'cancelled', 'declined', 'no_show']);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export const quoteStatusSchema = z.enum(['none', 'proposed', 'accepted', 'declined']);

export const createBookingRequestSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().min(1).max(500).optional(),
});
export type CreateBookingRequest = z.infer<typeof createBookingRequestSchema>;

export const proposeQuoteRequestSchema = z.object({
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: currencySchema,
});
export type ProposeQuoteRequest = z.infer<typeof proposeQuoteRequestSchema>;

export const bookingNoteRequestSchema = z.object({ reason: z.string().trim().min(1).max(300).optional() });
export type BookingNoteRequest = z.infer<typeof bookingNoteRequestSchema>;

export const bookingEventSchema = z.object({
  fromStatus: z.string().nullable(),
  status: z.string(),
  actorKind: z.enum(['client', 'provider', 'system']),
  actorUserId: z.uuid().nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const bookingSchema = z.object({
  id: z.uuid(),
  offerId: z.uuid(),
  offerTitle: z.string(),
  status: bookingStatusSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  note: z.string().nullable(),
  paymentMode: z.literal('on_site'),
  priceKind: servicePriceKindSchema,
  amountMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  quoteStatus: quoteStatusSchema,
  cancelNoticeHours: z.number().int(),
  statusChangedAt: z.iso.datetime(),
  statusChangedBy: z.enum(['client', 'provider', 'system']),
  client: z.object({ userId: z.uuid(), handle: z.string(), displayName: z.string() }),
  provider: serviceProviderRefSchema,
  reviewId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const bookingDetailSchema = bookingSchema.extend({ events: z.array(bookingEventSchema) });
export type BookingDetail = z.infer<typeof bookingDetailSchema>;

export const bookingListSchema = z.object({ items: z.array(bookingSchema), nextCursor: z.string().nullable() });
export type BookingList = z.infer<typeof bookingListSchema>;

export const bookingListQuerySchema = z.object({
  status: bookingStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

/* ------------------------------------------------------------------ reviews */

export const createServiceReviewRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(1).max(2000).optional(),
});
export type CreateServiceReviewRequest = z.infer<typeof createServiceReviewRequestSchema>;

export const serviceReviewReplyRequestSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export type ServiceReviewReplyRequest = z.infer<typeof serviceReviewReplyRequestSchema>;

export const serviceReviewSchema = z.object({
  id: z.uuid(),
  offerId: z.uuid(),
  bookingId: z.uuid(),
  rating: z.number().int(),
  body: z.string().nullable(),
  author: z.object({ userId: z.uuid(), handle: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }),
  verifiedBooking: z.literal(true),
  reply: z.object({ body: z.string(), repliedAt: z.iso.datetime() }).nullable(),
  createdAt: z.iso.datetime(),
});
export type ServiceReview = z.infer<typeof serviceReviewSchema>;

export const serviceReviewListSchema = z.object({
  items: z.array(serviceReviewSchema),
  nextCursor: z.string().nullable(),
  summary: z.object({
    ratingCount: z.number().int(),
    averageRating: z.number().nullable(),
    distribution: z.object({ '1': z.number().int(), '2': z.number().int(), '3': z.number().int(), '4': z.number().int(), '5': z.number().int() }),
  }),
});
export type ServiceReviewList = z.infer<typeof serviceReviewListSchema>;

/** Account export (lot 9): own provider profile and offers, own bookings as client, own reviews. */
export const exportedServicesSchema = z.object({
  profile: z.object({ displayName: z.string(), bio: z.string().nullable(), city: z.string().nullable(), skills: z.array(z.string()), createdAt: z.iso.datetime() }).nullable(),
  offers: z.array(z.object({ id: z.uuid(), title: z.string(), status: z.string(), createdAt: z.iso.datetime() })),
  bookings: z.array(z.object({ id: z.uuid(), offerTitle: z.string(), status: z.string(), startsAt: z.iso.datetime(), note: z.string().nullable(), createdAt: z.iso.datetime() })),
  reviews: z.array(z.object({ id: z.uuid(), offerId: z.uuid(), rating: z.number().int(), body: z.string().nullable(), createdAt: z.iso.datetime() })),
});
export type ExportedServices = z.infer<typeof exportedServicesSchema>;

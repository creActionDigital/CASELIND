import { z } from 'zod';

/* On-demand courier outside any order (parcels and documents) and the courier's route plan.
 * Cash to the courier, no money transits. The couriers are approved mobility drivers (KYC level 1).
 * Before acceptance a courier sees rounded coordinates and no label, no note. */

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const iso = z.iso.datetime();

export const COURIER_REQUEST_OPEN_MAX = 5;
export const COURIER_REQUEST_TTL_MINUTES = 30;
export const COURIER_REQUEST_MAX_KM = 50;
export const COURIER_SCHEDULE_MIN_HOURS = 2;
export const COURIER_SCHEDULE_MAX_DAYS = 7;
export const COURIER_ROUTE_MAX_STOPS = 20;
export const COURIER_CODE_LENGTH = 6;

export const courierRequestKindSchema = z.enum(['parcel', 'document']);
export type CourierRequestKind = z.infer<typeof courierRequestKindSchema>;
export const courierRequestSizeSchema = z.enum(['small', 'medium', 'large']);
export type CourierRequestSize = z.infer<typeof courierRequestSizeSchema>;
export const courierRequestStatusSchema = z.enum(['requested', 'accepted', 'picked_up', 'delivered', 'cancelled', 'expired']);
export type CourierRequestStatus = z.infer<typeof courierRequestStatusSchema>;

export const courierPointSchema = z.object({ lat: latSchema, lng: lngSchema, label: z.string().trim().min(1).max(160) });
export type CourierPoint = z.infer<typeof courierPointSchema>;

const routeFields = {
  kind: courierRequestKindSchema,
  pickup: courierPointSchema,
  dropoff: courierPointSchema,
  /** Parcel: required. Document: absent. */
  size: courierRequestSizeSchema.optional(),
  currency: currencySchema.optional(),
};
const sizeRule = (v: { kind: string; size?: string | undefined }, ctx: z.RefinementCtx): void => {
  if (v.kind === 'parcel' && !v.size) ctx.addIssue({ code: 'custom', path: ['size'], message: 'a parcel needs a size' });
  if (v.kind === 'document' && v.size) ctx.addIssue({ code: 'custom', path: ['size'], message: 'a document has no size' });
};

export const courierRequestEstimateRequestSchema = z.object(routeFields).superRefine(sizeRule);
export type CourierRequestEstimateRequest = z.infer<typeof courierRequestEstimateRequestSchema>;

export const createCourierRequestSchema = z
  .object({
    ...routeFields,
    /** Only the parties see it (the courier after acceptance). */
    note: z.string().trim().min(1).max(300).optional(),
    /** Slot: 2 hours to 7 days ahead (400 schedule_out_of_range). The couriers see it 60 minutes before. */
    scheduledFor: iso.optional(),
  })
  .superRefine(sizeRule);
export type CreateCourierRequest = z.infer<typeof createCourierRequestSchema>;

export const courierRequestEstimateSchema = z.object({
  estimated: z.literal(true),
  currency: currencySchema,
  distanceKm: z.number(),
  durationMin: z.number().int(),
  feeMinor: z.number().int(),
  paymentMode: z.literal('cash'),
  note: z.string(),
});
export type CourierRequestEstimate = z.infer<typeof courierRequestEstimateSchema>;

export const courierPartySchema = z.object({ userId: z.uuid(), handle: z.string(), displayName: z.string() });
export type CourierParty = z.infer<typeof courierPartySchema>;

/** A request as seen by one of its parties (requester, or courier once accepted). */
export const courierRequestSchema = z.object({
  id: z.uuid(),
  role: z.enum(['requester', 'courier']),
  kind: courierRequestKindSchema,
  size: courierRequestSizeSchema.nullable(),
  status: courierRequestStatusSchema,
  pickup: courierPointSchema,
  dropoff: courierPointSchema,
  /** Null for the courier when there is none; the courier only gets it once accepted (always the case here). */
  note: z.string().nullable(),
  currency: currencySchema,
  feeMinor: z.number().int(),
  distanceKm: z.number(),
  /** Requester only, while the request is live: the code to give to the courier on delivery. */
  proofCode: z.string().nullable(),
  proofLockedUntil: iso.nullable(),
  /** The other party (the courier for the requester, the requester for the courier). */
  counterpart: courierPartySchema.nullable(),
  locationSharing: z.boolean(),
  /** Requester only, picked up only, last position only. */
  location: z.object({ lat: z.number(), lng: z.number(), updatedAt: iso }).nullable(),
  /** Rating given by the caller to the other party, and received from them. */
  ratingGiven: z.number().int().nullable(),
  ratingReceived: z.number().int().nullable(),
  scheduledFor: iso.nullable(),
  expiresAt: iso,
  acceptedAt: iso.nullable(),
  pickedUpAt: iso.nullable(),
  deliveredAt: iso.nullable(),
  cancelledAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type CourierRequest = z.infer<typeof courierRequestSchema>;

export const courierRequestListQuerySchema = z.object({
  /** active = requested, accepted or picked up; done = the others. */
  scope: z.enum(['active', 'done', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
export type CourierRequestListQuery = z.infer<typeof courierRequestListQuerySchema>;
export const courierRequestListSchema = z.object({ items: z.array(courierRequestSchema), nextCursor: z.string().nullable() });
export type CourierRequestList = z.infer<typeof courierRequestListSchema>;

/* ---- courier side -------------------------------------------------------------------------- */

export const courierOffersQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.5).max(50).optional(),
});
export type CourierOffersQuery = z.infer<typeof courierOffersQuerySchema>;

/** Public to couriers before acceptance: coordinates rounded to 3 decimals, no label, no note, no requester. */
export const courierOfferSchema = z.object({
  id: z.uuid(),
  kind: courierRequestKindSchema,
  size: courierRequestSizeSchema.nullable(),
  pickup: z.object({ lat: z.number(), lng: z.number() }),
  dropoff: z.object({ lat: z.number(), lng: z.number() }),
  pickupDistanceKm: z.number(),
  tripKm: z.number(),
  currency: currencySchema,
  feeMinor: z.number().int(),
  scheduledFor: iso.nullable(),
  expiresAt: iso,
  createdAt: iso,
});
export type CourierOffer = z.infer<typeof courierOfferSchema>;
export const courierOfferListSchema = z.object({ items: z.array(courierOfferSchema) });
export type CourierOfferList = z.infer<typeof courierOfferListSchema>;

export const courierDeliveredRequestSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'expected 6 digits') });
export type CourierDeliveredRequest = z.infer<typeof courierDeliveredRequestSchema>;

export const rateCourierRequestSchema = z.object({ rating: z.number().int().min(1).max(5) });
export type RateCourierRequest = z.infer<typeof rateCourierRequestSchema>;

export const myCourierJobsQuerySchema = z.object({
  scope: z.enum(['active', 'done']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type MyCourierJobsQuery = z.infer<typeof myCourierJobsQuerySchema>;
export const myCourierJobsSchema = z.object({ items: z.array(courierRequestSchema) });
export type MyCourierJobs = z.infer<typeof myCourierJobsSchema>;

/* ---- route plan ---------------------------------------------------------------------------- */

/** Ids of the courier's own accepted requests and assigned deliveries (comma separated), and the courier position. */
export const courierRoutePlanQuerySchema = z.object({
  ids: z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()).filter((s) => s.length > 0))
    .pipe(z.array(z.uuid()).min(1).max(COURIER_ROUTE_MAX_STOPS)),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type CourierRoutePlanQuery = z.infer<typeof courierRoutePlanQuerySchema>;

export const courierRouteStopSchema = z.object({
  type: z.enum(['courier_request', 'delivery']),
  id: z.uuid(),
  step: z.enum(['pickup', 'dropoff', 'delivery']),
  label: z.string(),
  /** Null for an order delivery (the order address has no coordinates): such stops come last. */
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** Straight line times the detour factor from the previous stop, null without coordinates. */
  legKm: z.number().nullable(),
  express: z.boolean(),
});
export type CourierRouteStop = z.infer<typeof courierRouteStopSchema>;

export const courierRoutePlanSchema = z.object({
  stops: z.array(courierRouteStopSchema),
  totalKm: z.number(),
  /** Stops without coordinates, appended in due order. */
  unlocated: z.number().int(),
});
export type CourierRoutePlan = z.infer<typeof courierRoutePlanSchema>;

/* ---- account export ------------------------------------------------------------------------ */

export const exportedCourierRequestSchema = z.object({
  id: z.uuid(),
  role: z.enum(['requester', 'courier']),
  kind: courierRequestKindSchema,
  status: courierRequestStatusSchema,
  pickupLabel: z.string(),
  dropoffLabel: z.string(),
  /** The requester's own note; the courier's export leaves it out. */
  note: z.string().nullable(),
  feeMinor: z.number().int(),
  currency: z.string(),
  ratingGiven: z.number().int().nullable(),
  ratingReceived: z.number().int().nullable(),
  createdAt: iso,
  deliveredAt: iso.nullable(),
});
export type ExportedCourierRequest = z.infer<typeof exportedCourierRequestSchema>;

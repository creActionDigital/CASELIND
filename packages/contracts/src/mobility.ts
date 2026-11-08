import { z } from 'zod';

/** Lot 11: mobility (taxi and moto-taxi rides). No operator is integrated; fares are estimates; cash to the driver (ADR-017). */

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const iso = z.iso.datetime();

export const ridePointSchema = z.object({ lat: latSchema, lng: lngSchema, label: z.string().trim().min(1).max(160) });
export type RidePoint = z.infer<typeof ridePointSchema>;

export const rideVehicleSchema = z.enum(['moto', 'standard', 'confort']);
export type RideVehicle = z.infer<typeof rideVehicleSchema>;
export const driverVehicleKindSchema = z.enum(['moto', 'car']);
export type DriverVehicleKind = z.infer<typeof driverVehicleKindSchema>;

export const rideStatusSchema = z.enum([
  'scheduled',
  'requested',
  'accepted',
  'driver_arriving',
  'in_progress',
  'completed',
  'cancelled_by_rider',
  'cancelled_by_driver',
  'expired',
]);
export type RideStatus = z.infer<typeof rideStatusSchema>;

/** Closed lists of cancellation reasons. */
export const riderCancelReasonSchema = z.enum(['changed_mind', 'wait_too_long', 'wrong_address', 'found_other', 'other']);
export const driverCancelReasonSchema = z.enum(['rider_unreachable', 'rider_no_show', 'vehicle_issue', 'too_far', 'safety', 'other']);
export const cancelReasonSchema = z.union([riderCancelReasonSchema, driverCancelReasonSchema]);
export type CancelReason = z.infer<typeof cancelReasonSchema>;
export const cancelRideRequestSchema = z.object({ reason: cancelReasonSchema });
export type CancelRideRequest = z.infer<typeof cancelRideRequestSchema>;

/* ---- estimate ------------------------------------------------------------------------------ */

export const rideEstimateRequestSchema = z.object({
  pickup: ridePointSchema,
  stop: ridePointSchema.optional(),
  dropoff: ridePointSchema,
  vehicle: rideVehicleSchema,
  currency: currencySchema.optional(),
});
export type RideEstimateRequest = z.infer<typeof rideEstimateRequestSchema>;

export const rideFareOptionSchema = z.object({
  vehicle: rideVehicleSchema,
  fareMinor: z.number().int(),
  fareMin: z.number().int(),
  fareMax: z.number().int(),
});
export type RideFareOption = z.infer<typeof rideFareOptionSchema>;

export const rideEstimateSchema = z.object({
  estimated: z.literal(true),
  vehicle: rideVehicleSchema,
  currency: currencySchema,
  distanceKm: z.number(),
  durationMin: z.number().int(),
  fareMinor: z.number().int(),
  fareMin: z.number().int(),
  fareMax: z.number().int(),
  /** The fare of each ride type for the same route, to compare before ordering. */
  options: z.array(rideFareOptionSchema),
  paymentMode: z.literal('cash'),
  note: z.string(),
});
export type RideEstimate = z.infer<typeof rideEstimateSchema>;

/* ---- driver -------------------------------------------------------------------------------- */

export const driverStatusSchema = z.enum(['pending', 'approved', 'rejected', 'suspended']);
export type DriverStatus = z.infer<typeof driverStatusSchema>;

export const upsertDriverRequestSchema = z.object({
  vehicleKind: driverVehicleKindSchema,
  /** A car driver who offers the "confort" type. */
  comfort: z.boolean().default(false),
  make: z.string().trim().min(1).max(60),
  plate: z.string().trim().min(2).max(20),
  color: z.string().trim().min(1).max(30),
  zone: z.string().trim().min(1).max(80),
  photoMediaId: z.uuid().nullable().optional(),
});
export type UpsertDriverRequest = z.infer<typeof upsertDriverRequestSchema>;

export const driverVehicleSchema = z.object({
  kind: driverVehicleKindSchema,
  comfort: z.boolean(),
  make: z.string(),
  plate: z.string(),
  color: z.string(),
  photoUrl: z.string().nullable(),
});
export type DriverVehicle = z.infer<typeof driverVehicleSchema>;

export const driverProfileSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  status: driverStatusSchema,
  vehicle: driverVehicleSchema,
  zone: z.string(),
  online: z.boolean(),
  decisionReason: z.string().nullable(),
  ratingAverage: z.number().nullable(),
  ratingCount: z.number().int(),
  /** Cancellations by the driver, counted for follow-up only (no fee: cash payment). */
  cancellations: z.number().int(),
  createdAt: iso,
  updatedAt: iso,
});
export type DriverProfile = z.infer<typeof driverProfileSchema>;

export const setOnlineRequestSchema = z.object({ online: z.boolean() });
export type SetOnlineRequest = z.infer<typeof setOnlineRequestSchema>;
export const driverLocationRequestSchema = z.object({ lat: latSchema, lng: lngSchema });
export type DriverLocationRequest = z.infer<typeof driverLocationRequestSchema>;

export const adminDriverListQuerySchema = z.object({
  status: driverStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminDriverListQuery = z.infer<typeof adminDriverListQuerySchema>;
export const adminDriverListSchema = z.object({ items: z.array(driverProfileSchema) });
export type AdminDriverList = z.infer<typeof adminDriverListSchema>;
export const driverDecisionRequestSchema = z.object({
  decision: z.enum(['approve', 'reject', 'suspend']),
  reason: z.string().trim().min(1).max(300).optional(),
});
export type DriverDecisionRequest = z.infer<typeof driverDecisionRequestSchema>;

/* ---- rides --------------------------------------------------------------------------------- */

export const RIDE_MIN_SCHEDULE_MINUTES = 30;
export const RIDE_MAX_SCHEDULE_DAYS = 7;

export const createRideRequestSchema = z.object({
  pickup: ridePointSchema,
  stop: ridePointSchema.optional(),
  dropoff: ridePointSchema,
  vehicle: rideVehicleSchema,
  currency: currencySchema.optional(),
  /** 30 minutes to 7 days ahead; drivers receive the request 10 minutes before. */
  scheduledAt: iso.optional(),
});
export type CreateRideRequest = z.infer<typeof createRideRequestSchema>;

export const rideFareSchema = z.object({
  estimated: z.literal(true),
  currency: currencySchema,
  fareMinor: z.number().int(),
  fareMin: z.number().int(),
  fareMax: z.number().int(),
});

export const rideDriverSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  vehicle: driverVehicleSchema,
  ratingAverage: z.number().nullable(),
});

export const rideLocationSchema = z.object({ lat: latSchema, lng: lngSchema, updatedAt: iso });

export const rideViewSchema = z.object({
  id: z.uuid(),
  role: z.enum(['rider', 'driver']),
  status: rideStatusSchema,
  vehicle: rideVehicleSchema,
  pickup: ridePointSchema,
  stop: ridePointSchema.nullable(),
  dropoff: ridePointSchema,
  scheduledAt: iso.nullable(),
  fare: rideFareSchema,
  /** Fare recalculated with the measured distance, once completed. */
  finalFareMinor: z.number().int().nullable(),
  distanceKm: z.number(),
  durationMin: z.number().int(),
  paymentMode: z.literal('cash'),
  rider: z.object({ userId: z.uuid(), displayName: z.string() }),
  driver: rideDriverSchema.nullable(),
  /** Rider only, while the driver is on the way or driving. Null otherwise. */
  driverLocation: rideLocationSchema.nullable(),
  /** 4-digit start code, rider only, until the ride starts. */
  startCode: z.string().nullable(),
  cancelReason: cancelReasonSchema.nullable(),
  sharing: z.boolean(),
  requestedAt: iso.nullable(),
  acceptedAt: iso.nullable(),
  startedAt: iso.nullable(),
  completedAt: iso.nullable(),
  cancelledAt: iso.nullable(),
  createdAt: iso,
});
export type RideView = z.infer<typeof rideViewSchema>;

export const myRidesQuerySchema = z.object({
  scope: z.enum(['active', 'done', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MyRidesQuery = z.infer<typeof myRidesQuerySchema>;
export const rideListSchema = z.object({ items: z.array(rideViewSchema) });
export type RideList = z.infer<typeof rideListSchema>;

export const rideOffersSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      vehicle: rideVehicleSchema,
      pickup: ridePointSchema,
      stop: ridePointSchema.nullable(),
      dropoff: ridePointSchema,
      pickupDistanceKm: z.number(),
      fare: rideFareSchema,
      distanceKm: z.number(),
      requestedAt: iso,
    }),
  ),
});
export type RideOffers = z.infer<typeof rideOffersSchema>;

export const START_CODE_LENGTH = 4;
export const startRideRequestSchema = z.object({ code: z.string().regex(/^\d{4}$/) });
export type StartRideRequest = z.infer<typeof startRideRequestSchema>;

export const rideShareSchema = z.object({ token: z.string(), path: z.string(), validWhile: z.literal('ride_active') });
export type RideShare = z.infer<typeof rideShareSchema>;

export const sharedRideSchema = z.object({
  status: rideStatusSchema,
  vehicle: rideVehicleSchema,
  pickupLabel: z.string(),
  dropoffLabel: z.string(),
  driver: z.object({ displayName: z.string(), make: z.string(), color: z.string(), plate: z.string() }).nullable(),
  driverLocation: rideLocationSchema.nullable(),
});
export type SharedRide = z.infer<typeof sharedRideSchema>;

/* ---- safety, ratings, messages ------------------------------------------------------------- */

export const rateRideRequestSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() });
export type RateRideRequest = z.infer<typeof rateRideRequestSchema>;
export const rideRatingSchema = z.object({ rideId: z.uuid(), rating: z.number().int(), comment: z.string().nullable(), createdAt: iso });
export type RideRating = z.infer<typeof rideRatingSchema>;

export const rideAlertResultSchema = z.object({ notified: z.number().int() });
export type RideAlertResult = z.infer<typeof rideAlertResultSchema>;

export const setTrustedContactsRequestSchema = z.object({ handles: z.array(z.string().trim().min(1).max(40)).max(3) });
export type SetTrustedContactsRequest = z.infer<typeof setTrustedContactsRequestSchema>;
export const trustedContactListSchema = z.object({
  items: z.array(z.object({ userId: z.uuid(), handle: z.string(), displayName: z.string() })),
});
export type TrustedContactList = z.infer<typeof trustedContactListSchema>;

/** Predefined quick messages (no free text). */
export const QUICK_MESSAGES = {
  arriving: "J'arrive",
  here: 'Je suis là',
  wait_please: 'Merci de patienter quelques minutes',
  cannot_find: 'Je ne vous trouve pas',
  thanks: 'Merci',
} as const;
export const quickMessageCodeSchema = z.enum(['arriving', 'here', 'wait_please', 'cannot_find', 'thanks']);
export type QuickMessageCode = z.infer<typeof quickMessageCodeSchema>;
export const sendQuickMessageRequestSchema = z.object({ code: quickMessageCodeSchema });
export type SendQuickMessageRequest = z.infer<typeof sendQuickMessageRequestSchema>;
export const rideMessageSchema = z.object({
  id: z.uuid(),
  code: quickMessageCodeSchema,
  text: z.string(),
  fromRole: z.enum(['rider', 'driver']),
  mine: z.boolean(),
  createdAt: iso,
});
export type RideMessage = z.infer<typeof rideMessageSchema>;
export const rideMessageListSchema = z.object({ items: z.array(rideMessageSchema) });
export type RideMessageList = z.infer<typeof rideMessageListSchema>;

/* ---- favourite places, receipts ------------------------------------------------------------ */

export const MAX_FAVORITE_PLACES = 5;
export const favoritePlaceKindSchema = z.enum(['home', 'work', 'other']);
export const createFavoritePlaceRequestSchema = z.object({
  kind: favoritePlaceKindSchema,
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(1).max(160),
  lat: latSchema,
  lng: lngSchema,
});
export type CreateFavoritePlaceRequest = z.infer<typeof createFavoritePlaceRequestSchema>;
export const favoritePlaceSchema = createFavoritePlaceRequestSchema.extend({ id: z.uuid(), createdAt: iso });
export type FavoritePlace = z.infer<typeof favoritePlaceSchema>;
export const favoritePlaceListSchema = z.object({ items: z.array(favoritePlaceSchema) });
export type FavoritePlaceList = z.infer<typeof favoritePlaceListSchema>;

export const rideReceiptSchema = z.object({
  rideId: z.uuid(),
  vehicle: rideVehicleSchema,
  pickup: ridePointSchema,
  stop: ridePointSchema.nullable(),
  dropoff: ridePointSchema,
  distanceKm: z.number(),
  durationMin: z.number().int(),
  fareMinor: z.number().int(),
  currency: currencySchema,
  /** Cash to the driver: nothing was collected by the platform. */
  paymentMode: z.literal('cash'),
  fareEstimated: z.literal(true),
  driverName: z.string().nullable(),
  plate: z.string().nullable(),
  startedAt: iso.nullable(),
  completedAt: iso,
});
export type RideReceipt = z.infer<typeof rideReceiptSchema>;

/** Account export (lot 11): own driver profile, rides, favourite places and trusted contacts. */
export const exportedMobilitySchema = z.object({
  driver: z
    .object({ status: z.string(), vehicleKind: z.string(), make: z.string(), plate: z.string(), color: z.string(), zone: z.string(), createdAt: iso })
    .nullable(),
  rides: z.array(
    z.object({
      id: z.uuid(),
      role: z.enum(['rider', 'driver']),
      status: z.string(),
      vehicle: z.string(),
      pickupLabel: z.string(),
      dropoffLabel: z.string(),
      fareMinor: z.number().int(),
      finalFareMinor: z.number().int().nullable(),
      currency: z.string(),
      distanceKm: z.number(),
      createdAt: iso,
      completedAt: iso.nullable(),
    }),
  ),
  favoritePlaces: z.array(z.object({ kind: z.string(), label: z.string(), address: z.string(), lat: z.number(), lng: z.number() })),
  trustedContacts: z.array(z.object({ handle: z.string() })),
});
export type ExportedMobility = z.infer<typeof exportedMobilitySchema>;

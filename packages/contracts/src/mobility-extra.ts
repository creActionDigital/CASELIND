import { z } from 'zod';
import { ridePointSchema } from './mobility.js';

/**
 * Mobilite, seconde partie : covoiturage, location de vehicules par des organisations, depannage.
 * Aucun paiement en ligne : especes entre les parties. Le prix par place est plafonne cote serveur (2 fois le tarif
 * estime du trajet), le total d'une location est calcule cote serveur (jours x tarif journalier).
 */

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const iso = z.iso.datetime();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cursorSchema = z.string().max(300).optional();

export const personRefSchema = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string() });
export type PersonRef = z.infer<typeof personRefSchema>;

/* ============================================================================ covoiturage */

export const CARPOOL_MIN_LEAD_MINUTES = 30;
export const CARPOOL_MAX_LEAD_DAYS = 60;
export const CARPOOL_SEATS_MAX = 8;
export const CARPOOL_BOOKING_SEATS_MAX = 4;
export const CARPOOL_OPEN_TRIPS_MAX = 5;
/** Prix maximum par place : ce facteur fois le tarif estime du trajet complet. */
export const CARPOOL_PRICE_FACTOR = 2;

export const carpoolTripStatusSchema = z.enum(['open', 'full', 'departed', 'completed', 'cancelled']);
export type CarpoolTripStatus = z.infer<typeof carpoolTripStatusSchema>;
export const carpoolBookingStatusSchema = z.enum(['requested', 'accepted', 'declined', 'cancelled', 'completed']);
export type CarpoolBookingStatus = z.infer<typeof carpoolBookingStatusSchema>;

export const createCarpoolTripRequestSchema = z.object({
  origin: ridePointSchema,
  destination: ridePointSchema,
  /** 30 minutes a 60 jours dans le futur (400 departure_out_of_range). */
  departsAt: iso,
  seatsTotal: z.number().int().min(1).max(CARPOOL_SEATS_MAX),
  pricePerSeatMinor: z.number().int().min(0).max(1_000_000_000),
  currency: currencySchema.optional(),
  /** Visible de tous dans la recherche : signalable. */
  note: z.string().trim().min(1).max(200).optional(),
  vehicleLabel: z.string().trim().min(1).max(60).optional(),
});
export type CreateCarpoolTripRequest = z.infer<typeof createCarpoolTripRequestSchema>;

export const carpoolQuoteRequestSchema = z.object({
  origin: z.object({ lat: latSchema, lng: lngSchema }),
  destination: z.object({ lat: latSchema, lng: lngSchema }),
  currency: currencySchema.optional(),
});
export type CarpoolQuoteRequest = z.infer<typeof carpoolQuoteRequestSchema>;
export const carpoolQuoteSchema = z.object({
  estimated: z.literal(true),
  currency: currencySchema,
  distanceKm: z.number(),
  estimatedFareMinor: z.number().int(),
  maxPricePerSeatMinor: z.number().int(),
  paymentMode: z.literal('cash'),
});
export type CarpoolQuote = z.infer<typeof carpoolQuoteSchema>;

export const carpoolSearchQuerySchema = z
  .object({
    originLat: z.coerce.number().min(-90).max(90),
    originLng: z.coerce.number().min(-180).max(180),
    destLat: z.coerce.number().min(-90).max(90).optional(),
    destLng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(1).max(100).default(25),
    /** Jour UTC AAAA-MM-JJ ; sans date : tous les trajets a venir. */
    date: day.optional(),
    cursor: cursorSchema,
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((q) => (q.destLat === undefined) === (q.destLng === undefined), { message: 'destLat and destLng go together', path: ['destLat'] });
export type CarpoolSearchQuery = z.infer<typeof carpoolSearchQuerySchema>;

export const carpoolDriverSchema = personRefSchema.extend({ ratingAvg: z.number().nullable(), ratingCount: z.number().int() });
export type CarpoolDriver = z.infer<typeof carpoolDriverSchema>;

export const carpoolBookingSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  seats: z.number().int(),
  status: carpoolBookingStatusSchema,
  passenger: personRefSchema,
  createdAt: iso,
});
export type CarpoolBooking = z.infer<typeof carpoolBookingSchema>;

export const carpoolTripSchema = z.object({
  id: z.uuid(),
  status: carpoolTripStatusSchema,
  role: z.enum(['driver', 'passenger', 'viewer']),
  /** Faux pour un non-participant : les coordonnees sont arrondies a 3 decimales (environ 110 m). */
  exact: z.boolean(),
  origin: ridePointSchema,
  destination: ridePointSchema,
  distanceKm: z.number(),
  departsAt: iso,
  seatsTotal: z.number().int(),
  seatsFree: z.number().int(),
  pricePerSeatMinor: z.number().int(),
  currency: currencySchema,
  note: z.string().nullable(),
  vehicleLabel: z.string().nullable(),
  driver: carpoolDriverSchema,
  /** La reservation du demandeur (passager). */
  myBooking: carpoolBookingSchema.nullable(),
  /** Demandes et reservations : conducteur seulement. */
  bookings: z.array(carpoolBookingSchema),
  /** Personnes que l'on peut encore evaluer (trajet termine). */
  toRate: z.array(personRefSchema),
  paymentMode: z.literal('cash'),
  createdAt: iso,
});
export type CarpoolTrip = z.infer<typeof carpoolTripSchema>;

export const carpoolTripListSchema = z.object({ items: z.array(carpoolTripSchema), nextCursor: z.string().nullable() });
export type CarpoolTripList = z.infer<typeof carpoolTripListSchema>;

export const carpoolMineQuerySchema = z.object({
  role: z.enum(['driver', 'passenger']).default('driver'),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type CarpoolMineQuery = z.infer<typeof carpoolMineQuerySchema>;
export const carpoolMineListSchema = z.object({ items: z.array(carpoolTripSchema) });
export type CarpoolMineList = z.infer<typeof carpoolMineListSchema>;

export const createCarpoolBookingRequestSchema = z.object({ seats: z.number().int().min(1).max(CARPOOL_BOOKING_SEATS_MAX).default(1) });
export type CreateCarpoolBookingRequest = z.infer<typeof createCarpoolBookingRequestSchema>;

export const carpoolRatingRequestSchema = z.object({ userId: z.uuid(), rating: z.number().int().min(1).max(5) });
export type CarpoolRatingRequest = z.infer<typeof carpoolRatingRequestSchema>;
export const carpoolRatingSchema = z.object({ tripId: z.uuid(), userId: z.uuid(), rating: z.number().int() });
export type CarpoolRating = z.infer<typeof carpoolRatingSchema>;

/* ============================================================================ location de vehicules */

export const RENTAL_MAX_DAYS = 30;
export const RENTAL_MAX_PHOTOS = 4;
export const RENTAL_OPEN_BOOKINGS_MAX = 5;
/** Une location ne peut pas commencer plus d'un an a l'avance. */
export const RENTAL_MAX_LEAD_DAYS = 366;

export const rentalKindSchema = z.enum(['car', 'moto', 'van', 'bike']);
export type RentalKind = z.infer<typeof rentalKindSchema>;
export const rentalTransmissionSchema = z.enum(['manual', 'auto']);
export const rentalFuelSchema = z.enum(['petrol', 'diesel', 'electric', 'hybrid']);
export const rentalBookingStatusSchema = z.enum(['requested', 'confirmed', 'declined', 'cancelled', 'picked_up', 'returned']);
export type RentalBookingStatus = z.infer<typeof rentalBookingStatusSchema>;

const rentalVehicleFields = {
  title: z.string().trim().min(1).max(80),
  kind: rentalKindSchema,
  make: z.string().trim().min(1).max(40).optional(),
  model: z.string().trim().min(1).max(40).optional(),
  year: z.number().int().min(1950).max(2100).optional(),
  seats: z.number().int().min(1).max(60).optional(),
  transmission: rentalTransmissionSchema.optional(),
  fuel: rentalFuelSchema.optional(),
  dailyRateMinor: z.number().int().min(1).max(1_000_000_000),
  currency: currencySchema.optional(),
  depositMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  city: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500).optional(),
  /** Medias de finalite "listing", prets, a vous : 4 au plus. */
  mediaIds: z.array(z.uuid()).max(RENTAL_MAX_PHOTOS).optional(),
  active: z.boolean().optional(),
};
export const createRentalVehicleRequestSchema = z.object(rentalVehicleFields);
export type CreateRentalVehicleRequest = z.infer<typeof createRentalVehicleRequestSchema>;
/** Les champs facultatifs peuvent etre remis a vide avec null. */
export const updateRentalVehicleRequestSchema = z
  .object({
    title: rentalVehicleFields.title,
    kind: rentalKindSchema,
    make: rentalVehicleFields.make.nullable(),
    model: rentalVehicleFields.model.nullable(),
    year: rentalVehicleFields.year.nullable(),
    seats: rentalVehicleFields.seats.nullable(),
    transmission: rentalTransmissionSchema.nullable(),
    fuel: rentalFuelSchema.nullable(),
    dailyRateMinor: rentalVehicleFields.dailyRateMinor,
    depositMinor: rentalVehicleFields.depositMinor.nullable(),
    city: rentalVehicleFields.city,
    description: rentalVehicleFields.description.nullable(),
    mediaIds: rentalVehicleFields.mediaIds,
    active: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateRentalVehicleRequest = z.infer<typeof updateRentalVehicleRequestSchema>;

export const rentalVehicleSchema = z.object({
  id: z.uuid(),
  org: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  title: z.string(),
  kind: rentalKindSchema,
  make: z.string().nullable(),
  model: z.string().nullable(),
  year: z.number().int().nullable(),
  seats: z.number().int().nullable(),
  transmission: rentalTransmissionSchema.nullable(),
  fuel: rentalFuelSchema.nullable(),
  dailyRateMinor: z.number().int(),
  currency: currencySchema,
  depositMinor: z.number().int().nullable(),
  city: z.string(),
  description: z.string().nullable(),
  photoUrls: z.array(z.string()),
  mediaIds: z.array(z.uuid()),
  active: z.boolean(),
  /** Si la recherche donnait une periode : nombre de jours et total calcule par le serveur. */
  days: z.number().int().nullable(),
  totalMinor: z.number().int().nullable(),
  /** Periodes deja confirmees (detail seulement) : dates, sans aucune personne. */
  busy: z.array(z.object({ from: day, to: day })),
  paymentNote: z.string(),
  createdAt: iso,
});
export type RentalVehicle = z.infer<typeof rentalVehicleSchema>;

const periodRule = (q: { from?: string | undefined; to?: string | undefined }) => (q.from === undefined) === (q.to === undefined) && (q.from === undefined || q.to === undefined || q.to >= q.from);
export const rentalSearchQuerySchema = z
  .object({
    city: z.string().trim().min(1).max(80).optional(),
    kind: rentalKindSchema.optional(),
    from: day.optional(),
    to: day.optional(),
    cursor: cursorSchema,
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine(periodRule, { message: 'from and to go together, to is not before from', path: ['to'] });
export type RentalSearchQuery = z.infer<typeof rentalSearchQuerySchema>;
export const rentalDetailQuerySchema = z
  .object({ from: day.optional(), to: day.optional() })
  .refine(periodRule, { message: 'from and to go together, to is not before from', path: ['to'] });
export type RentalDetailQuery = z.infer<typeof rentalDetailQuerySchema>;

export const rentalVehicleListSchema = z.object({ items: z.array(rentalVehicleSchema), nextCursor: z.string().nullable() });
export type RentalVehicleList = z.infer<typeof rentalVehicleListSchema>;
export const orgRentalListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
export type OrgRentalListQuery = z.infer<typeof orgRentalListQuerySchema>;

export const createRentalBookingRequestSchema = z
  .object({ startsOn: day, endsOn: day, note: z.string().trim().min(1).max(200).optional() })
  .refine((b) => b.endsOn >= b.startsOn, { message: 'endsOn is before startsOn', path: ['endsOn'] });
export type CreateRentalBookingRequest = z.infer<typeof createRentalBookingRequestSchema>;

export const rentalBookingSchema = z.object({
  id: z.uuid(),
  vehicleId: z.uuid(),
  vehicleTitle: z.string(),
  orgId: z.uuid(),
  orgName: z.string(),
  startsOn: day,
  endsOn: day,
  days: z.number().int(),
  dailyRateMinor: z.number().int(),
  depositMinor: z.number().int().nullable(),
  totalMinor: z.number().int(),
  currency: currencySchema,
  status: rentalBookingStatusSchema,
  note: z.string().nullable(),
  /** Pour l'organisation seulement. */
  renter: personRefSchema.nullable(),
  paymentNote: z.string(),
  createdAt: iso,
});
export type RentalBooking = z.infer<typeof rentalBookingSchema>;
export const rentalBookingListSchema = z.object({ items: z.array(rentalBookingSchema) });
export type RentalBookingList = z.infer<typeof rentalBookingListSchema>;
export const rentalBookingListQuerySchema = z.object({
  status: rentalBookingStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RentalBookingListQuery = z.infer<typeof rentalBookingListQuerySchema>;

/* ============================================================================ depannage */

export const ROADSIDE_OPEN_MAX = 3;
export const ROADSIDE_TTL_MINUTES = 30;
/** Aucun numero d'urgence officiel n'est invente : un simple rappel. */
export const ROADSIDE_SAFETY_NOTE = 'En cas de danger immediat, contactez les secours locaux.';

export const roadsideKindSchema = z.enum(['tow', 'battery', 'tire', 'fuel', 'lockout', 'other']);
export type RoadsideKind = z.infer<typeof roadsideKindSchema>;
export const roadsideStatusSchema = z.enum(['requested', 'accepted', 'on_the_way', 'done', 'cancelled', 'expired']);
export type RoadsideStatus = z.infer<typeof roadsideStatusSchema>;

export const createRoadsideRequestSchema = z.object({
  kind: roadsideKindSchema,
  position: ridePointSchema,
  vehicleLabel: z.string().trim().min(1).max(60).optional(),
  note: z.string().trim().min(1).max(200).optional(),
});
export type CreateRoadsideRequest = z.infer<typeof createRoadsideRequestSchema>;

export const roadsideOffersQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(100).optional(),
});
export type RoadsideOffersQuery = z.infer<typeof roadsideOffersQuerySchema>;

/** Avant acceptation : coordonnees arrondies, ni libelle, ni note, ni demandeur. */
export const roadsideOfferSchema = z.object({
  id: z.uuid(),
  kind: roadsideKindSchema,
  position: z.object({ lat: z.number(), lng: z.number() }),
  distanceKm: z.number(),
  expiresAt: iso,
  createdAt: iso,
});
export type RoadsideOffer = z.infer<typeof roadsideOfferSchema>;
export const roadsideOfferListSchema = z.object({ items: z.array(roadsideOfferSchema) });
export type RoadsideOfferList = z.infer<typeof roadsideOfferListSchema>;

export const roadsideRequestSchema = z.object({
  id: z.uuid(),
  role: z.enum(['requester', 'provider']),
  kind: roadsideKindSchema,
  status: roadsideStatusSchema,
  position: ridePointSchema,
  vehicleLabel: z.string().nullable(),
  note: z.string().nullable(),
  etaMinutes: z.number().int().nullable(),
  /** L'autre partie une fois la demande acceptee. */
  counterpart: personRefSchema.nullable(),
  locationSharing: z.boolean(),
  /** Position du prestataire, avec son consentement, pour le demandeur seulement. */
  providerLocation: z.object({ lat: z.number(), lng: z.number(), updatedAt: iso }).nullable(),
  expiresAt: iso,
  createdAt: iso,
  safetyNote: z.string(),
  paymentNote: z.string(),
});
export type RoadsideRequest = z.infer<typeof roadsideRequestSchema>;
export const roadsideRequestListSchema = z.object({ items: z.array(roadsideRequestSchema) });
export type RoadsideRequestList = z.infer<typeof roadsideRequestListSchema>;

export const roadsideMineQuerySchema = z.object({
  role: z.enum(['requester', 'provider']).default('requester'),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type RoadsideMineQuery = z.infer<typeof roadsideMineQuerySchema>;

export const roadsideOnTheWayRequestSchema = z.object({ etaMinutes: z.number().int().min(1).max(480) });
export type RoadsideOnTheWayRequest = z.infer<typeof roadsideOnTheWayRequestSchema>;
export const roadsideLocationConsentRequestSchema = z.object({ granted: z.boolean() });
export type RoadsideLocationConsentRequest = z.infer<typeof roadsideLocationConsentRequestSchema>;
export const roadsideLocationRequestSchema = z.object({ lat: latSchema, lng: lngSchema });
export type RoadsideLocationRequest = z.infer<typeof roadsideLocationRequestSchema>;

/* ============================================================================ export de compte */

export const exportedMobilityExtraSchema = z.object({
  carpoolTrips: z.array(
    z.object({
      id: z.uuid(),
      status: z.string(),
      originLabel: z.string(),
      destinationLabel: z.string(),
      departsAt: iso,
      seatsTotal: z.number().int(),
      pricePerSeatMinor: z.number().int(),
      currency: z.string(),
      note: z.string().nullable(),
      vehicleLabel: z.string().nullable(),
      createdAt: iso,
    }),
  ),
  carpoolBookings: z.array(z.object({ id: z.uuid(), tripId: z.uuid(), seats: z.number().int(), status: z.string(), createdAt: iso })),
  rentalBookings: z.array(
    z.object({
      id: z.uuid(),
      vehicleTitle: z.string(),
      startsOn: day,
      endsOn: day,
      totalMinor: z.number().int(),
      currency: z.string(),
      status: z.string(),
      note: z.string().nullable(),
      createdAt: iso,
    }),
  ),
  roadsideRequests: z.array(
    z.object({
      id: z.uuid(),
      role: z.enum(['requester', 'provider']),
      kind: z.string(),
      status: z.string(),
      label: z.string(),
      vehicleLabel: z.string().nullable(),
      note: z.string().nullable(),
      createdAt: iso,
    }),
  ),
});
export type ExportedMobilityExtra = z.infer<typeof exportedMobilityExtraSchema>;

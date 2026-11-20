import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CARPOOL_OPEN_TRIPS_MAX,
  type CarpoolBooking,
  type CarpoolBookingStatus,
  type CarpoolMineList,
  type CarpoolMineQuery,
  type CarpoolQuote,
  type CarpoolQuoteRequest,
  type CarpoolRating,
  type CarpoolRatingRequest,
  type CarpoolSearchQuery,
  type CarpoolTrip,
  type CarpoolTripList,
  type CarpoolTripStatus,
  type CreateCarpoolBookingRequest,
  type CreateCarpoolTripRequest,
  type PersonRef,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { fareFor, forbiddenBecause, HAVERSINE_SQL, haversineKm, conflict, routeMetrics, tariffFor, UUID_RE, validation } from '../mobility/mobility.shared.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { Tx } from '../orgs/orgs.service.js';
import { KycPort } from '../wallet/kyc.port.js';
import { canSeat, dayWindow, departureInRange, maxSeatPriceMinor, roundCoord, statusForSeats } from './carpool.logic.js';
import { blockedBetween, decodeCursor, encodeCursor, type Exec, isoOf, isUniqueViolation, num, requireApprovedDriver, rowsOf, uuidList } from './extra.shared.js';

/** A passenger has at most this many live requests at once. */
const BOOKING_OPEN_MAX = 5;
/** The driver may mark the departure from one hour before the announced time. */
const DEPART_EARLY_MINUTES = 60;

const tripNotFound = () => AppError.notFound('Trip not found');
const bookingNotFound = () => AppError.notFound('Booking not found');

interface TripRow {
  id: string;
  driver_id: string;
  origin_lat: number;
  origin_lng: number;
  origin_label: string;
  dest_lat: number;
  dest_lng: number;
  dest_label: string;
  distance_km: number;
  departs_at: Date;
  seats_total: number;
  seats_free: number;
  price_per_seat_minor: string | number;
  currency: string;
  note: string | null;
  vehicle_label: string | null;
  status: CarpoolTripStatus;
  hidden: boolean;
  created_at: Date;
  cur_ts: string;
  d_handle: string;
  d_name: string;
  r_avg: number | null;
  r_count: number;
}
interface BookingRow {
  id: string;
  trip_id: string;
  passenger_id: string;
  seats: number;
  status: CarpoolBookingStatus;
  created_at: Date;
  handle: string;
  display_name: string;
}

const TRIP_SELECT = sql`
  SELECT t.*, to_char(t.departs_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cur_ts,
         u.handle::text AS d_handle, u.display_name AS d_name,
         (SELECT avg(r.rating)::float8 FROM carpool_ratings r WHERE r.ratee_id = t.driver_id) AS r_avg,
         (SELECT count(*)::int FROM carpool_ratings r WHERE r.ratee_id = t.driver_id) AS r_count
  FROM carpool_trips t JOIN users u ON u.id = t.driver_id`;

@Injectable()
export class CarpoolService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly kyc: KycPort,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationRegistry,
  ) {}

  onModuleInit(): void {
    // The free note is visible to everybody in the search: it can be reported and hidden.
    this.moderation.register('carpool_trip', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const r = await rowsOf<{ driver_id: string; status: string; hidden: boolean }>(this.db, sql`SELECT driver_id, status, hidden FROM carpool_trips WHERE id = ${id}::uuid`);
        const t = r[0];
        if (!t || t.hidden || t.driver_id === viewerId) return false;
        return !(await blockedBetween(this.db, viewerId, t.driver_id));
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        return (await rowsOf<{ a: string }>(this.db, sql`SELECT driver_id AS a FROM carpool_trips WHERE id = ${id}::uuid`))[0]?.a ?? null;
      },
      setHidden: async (id, hidden) => {
        if (UUID_RE.test(id)) await this.db.execute(sql`UPDATE carpool_trips SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
  }

  /* ------------------------------------------------------------------ quote and creation */

  private quoteOf(origin: { lat: number; lng: number }, dest: { lat: number; lng: number }, currencyIn?: string) {
    const currency = currencyIn ?? 'USD';
    const tariff = tariffFor(this.env.MOBILITY_TARIFFS, currency, 'standard');
    if (!tariff) throw validation('currency', 'no tariff for this currency', 'currency_unsupported');
    if (haversineKm(origin, dest) < 0.5) throw validation('destination', 'origin and destination are the same place', 'same_point');
    const m = routeMetrics({ pickup: { ...origin, label: '' }, dropoff: { ...dest, label: '' } }, 'standard', this.env.MOBILITY_DETOUR_FACTOR);
    const estimatedFareMinor = fareFor(tariff, m.distanceKm, m.durationMin);
    return { currency, distanceKm: m.distanceKm, estimatedFareMinor, maxPricePerSeatMinor: maxSeatPriceMinor(estimatedFareMinor) };
  }

  quote(body: CarpoolQuoteRequest): CarpoolQuote {
    const q = this.quoteOf(body.origin, body.destination, body.currency);
    return { estimated: true, ...q, paymentMode: 'cash' };
  }

  async createTrip(userId: string, body: CreateCarpoolTripRequest, meta: RequestMeta): Promise<CarpoolTrip> {
    await requireApprovedDriver(this.db, this.kyc, userId);
    const departsAt = new Date(body.departsAt);
    if (!departureInRange(departsAt, new Date())) throw validation('departsAt', 'must be between 30 minutes and 60 days ahead', 'departure_out_of_range');
    const q = this.quoteOf(body.origin, body.destination, body.currency);
    if (body.pricePerSeatMinor > q.maxPricePerSeatMinor) {
      throw validation('pricePerSeatMinor', `the price per seat is limited to ${q.maxPricePerSeatMinor}`, 'price_too_high');
    }
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'carpool-driver:' + userId}))`);
      const [c] = await rowsOf<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM carpool_trips WHERE driver_id = ${userId}::uuid AND status IN ('open', 'full') AND departs_at > now()`);
      if ((c?.n ?? 0) >= CARPOOL_OPEN_TRIPS_MAX) throw conflict('Too many open trips', 'open_limit', { max: CARPOOL_OPEN_TRIPS_MAX });
      const [r] = await rowsOf<{ id: string }>(
        tx,
        sql`INSERT INTO carpool_trips (driver_id, origin_lat, origin_lng, origin_label, dest_lat, dest_lng, dest_label, distance_km, departs_at, seats_total, seats_free,
              price_per_seat_minor, currency, note, vehicle_label)
            VALUES (${userId}::uuid, ${body.origin.lat}, ${body.origin.lng}, ${body.origin.label}, ${body.destination.lat}, ${body.destination.lng}, ${body.destination.label},
              ${q.distanceKm}, ${departsAt.toISOString()}::timestamptz, ${body.seatsTotal}, ${body.seatsTotal}, ${body.pricePerSeatMinor}, ${q.currency},
              ${body.note ?? null}, ${body.vehicleLabel ?? null})
            RETURNING id`,
      );
      await this.audit.record(
        { action: 'carpool.trip_created', actorUserId: userId, meta, metadata: { tripId: r!.id, seatsTotal: body.seatsTotal, currency: q.currency, pricePerSeatMinor: body.pricePerSeatMinor } },
        tx,
      );
      return r!.id;
    });
    return this.get(userId, id);
  }

  /* ------------------------------------------------------------------ reading */

  /** Open trips to come near an origin (and a destination), soonest first. Points are rounded for everyone: drivers see exact ones in their own trips. */
  async search(viewerId: string, q: CarpoolSearchQuery): Promise<CarpoolTripList> {
    const filters = [
      sql`t.status = 'open' AND NOT t.hidden AND t.departs_at > now() AND t.driver_id <> ${viewerId}::uuid`,
      sql`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = t.driver_id AND b.blocked_id = ${viewerId}::uuid) OR (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = t.driver_id))`,
      sql.raw(`${HAVERSINE_SQL(String(q.originLat), String(q.originLng), 'round(t.origin_lat::numeric, 3)::float8', 'round(t.origin_lng::numeric, 3)::float8')} <= ${Number(q.radiusKm)}`),
    ];
    if (q.destLat !== undefined && q.destLng !== undefined) {
      filters.push(sql.raw(`${HAVERSINE_SQL(String(q.destLat), String(q.destLng), 'round(t.dest_lat::numeric, 3)::float8', 'round(t.dest_lng::numeric, 3)::float8')} <= ${Number(q.radiusKm)}`));
    }
    if (q.date) {
      const w = dayWindow(q.date);
      if (!w) throw validation('date', 'not a calendar date', 'invalid_date');
      filters.push(sql`t.departs_at >= ${w.start.toISOString()}::timestamptz AND t.departs_at < ${w.end.toISOString()}::timestamptz`);
    }
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c || !UUID_RE.test(c.id)) throw validation('cursor', 'invalid cursor', 'invalid_cursor');
      filters.push(sql`(t.departs_at, t.id) > (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await rowsOf<TripRow>(this.db, sql`${TRIP_SELECT} WHERE ${sql.join(filters, sql` AND `)} ORDER BY t.departs_at, t.id LIMIT ${q.limit + 1}`);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { items: await this.views(page, viewerId), nextCursor: rows.length > q.limit && last ? encodeCursor(last.cur_ts, last.id) : null };
  }

  async get(viewerId: string, id: string): Promise<CarpoolTrip> {
    if (!UUID_RE.test(id)) throw tripNotFound();
    const [row] = await rowsOf<TripRow>(this.db, sql`${TRIP_SELECT} WHERE t.id = ${id}::uuid`);
    if (!row) throw tripNotFound();
    if (row.driver_id !== viewerId) {
      const [mine] = await rowsOf(this.db, sql`SELECT 1 FROM carpool_bookings WHERE trip_id = ${id}::uuid AND passenger_id = ${viewerId}::uuid LIMIT 1`);
      // Others only see a trip that is still on offer, not hidden, and not from someone who blocked them (or whom they blocked).
      if (!mine && ((row.status !== 'open' && row.status !== 'full') || row.hidden)) throw tripNotFound();
      if (await blockedBetween(this.db, viewerId, row.driver_id)) throw tripNotFound();
    }
    return (await this.views([row], viewerId))[0]!;
  }

  async mine(userId: string, q: CarpoolMineQuery): Promise<CarpoolMineList> {
    const where = q.role === 'driver' ? sql`t.driver_id = ${userId}::uuid` : sql`EXISTS (SELECT 1 FROM carpool_bookings b WHERE b.trip_id = t.id AND b.passenger_id = ${userId}::uuid)`;
    const rows = await rowsOf<TripRow>(this.db, sql`${TRIP_SELECT} WHERE ${where} ORDER BY t.departs_at DESC, t.id DESC LIMIT ${q.limit}`);
    return { items: await this.views(rows, userId) };
  }

  /* ------------------------------------------------------------------ bookings */

  async book(userId: string, tripId: string, body: CreateCarpoolBookingRequest, meta: RequestMeta): Promise<CarpoolBooking> {
    if (!UUID_RE.test(tripId)) throw tripNotFound();
    let booked: { id: string; driverId: string };
    try {
      booked = await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'carpool-passenger:' + userId}))`);
        const [t] = await rowsOf<TripRow>(tx, sql`SELECT * FROM carpool_trips WHERE id = ${tripId}::uuid FOR SHARE`);
        if (!t || t.hidden) throw tripNotFound();
        if (t.driver_id === userId) throw forbiddenBecause('You cannot book your own trip', 'own_trip');
        if (await blockedBetween(tx, userId, t.driver_id)) throw tripNotFound();
        if (t.status !== 'open' || t.departs_at.getTime() <= Date.now()) throw conflict('This trip is no longer open', 'trip_unavailable', { status: t.status });
        if (body.seats > t.seats_free) throw conflict('Not enough seats left', 'not_enough_seats', { seatsFree: t.seats_free });
        const [c] = await rowsOf<{ n: number }>(
          tx,
          sql`SELECT count(*)::int AS n FROM carpool_bookings b JOIN carpool_trips x ON x.id = b.trip_id
              WHERE b.passenger_id = ${userId}::uuid AND b.status IN ('requested', 'accepted') AND x.status IN ('open', 'full', 'departed')`,
        );
        if ((c?.n ?? 0) >= BOOKING_OPEN_MAX) throw conflict('Too many live bookings', 'booking_limit', { max: BOOKING_OPEN_MAX });
        const [b] = await rowsOf<{ id: string }>(tx, sql`INSERT INTO carpool_bookings (trip_id, passenger_id, seats) VALUES (${tripId}::uuid, ${userId}::uuid, ${body.seats}) RETURNING id`);
        await this.audit.record({ action: 'carpool.booking_status_changed', actorUserId: userId, meta, metadata: { tripId, bookingId: b!.id, from: null, to: 'requested', seats: body.seats } }, tx);
        return { id: b!.id, driverId: t.driver_id };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('You already have a request on this trip', 'already_booked');
      throw e;
    }
    await this.tell(booked.driverId, 'Un passager demande une place sur votre trajet.', tripId);
    return this.bookingView(booked.id);
  }

  /** The driver accepts: the seats are taken under the trip row lock, so two requests never share the last seat. */
  async accept(driverId: string, bookingId: string, meta: RequestMeta): Promise<CarpoolBooking> {
    const passenger = await this.withLockedBooking(bookingId, async (tx, t, b) => {
      if (t.driver_id !== driverId) throw bookingNotFound();
      if (b.status !== 'requested') throw conflict(`A ${b.status} booking cannot be accepted`, 'invalid_transition', { from: b.status });
      if (t.status !== 'open' || t.departs_at.getTime() <= Date.now()) throw conflict('This trip is no longer open', 'trip_unavailable', { status: t.status });
      if (!canSeat(t.seats_free, b.seats)) throw conflict('Not enough seats left', 'not_enough_seats', { seatsFree: t.seats_free });
      const left = t.seats_free - b.seats;
      await tx.execute(sql`UPDATE carpool_trips SET seats_free = ${left}, status = ${statusForSeats(left)} WHERE id = ${t.id}::uuid`);
      await this.setBooking(tx, b, 'accepted', driverId, meta);
      return b.passenger_id;
    });
    await this.tell(passenger, 'Votre demande de place a été acceptée.', undefined, bookingId);
    return this.bookingView(bookingId);
  }

  async decline(driverId: string, bookingId: string, meta: RequestMeta): Promise<CarpoolBooking> {
    const passenger = await this.withLockedBooking(bookingId, async (tx, t, b) => {
      if (t.driver_id !== driverId) throw bookingNotFound();
      if (b.status !== 'requested') throw conflict(`A ${b.status} booking cannot be declined`, 'invalid_transition', { from: b.status });
      await this.setBooking(tx, b, 'declined', driverId, meta);
      return b.passenger_id;
    });
    await this.tell(passenger, 'Votre demande de place a été refusée.', undefined, bookingId);
    return this.bookingView(bookingId);
  }

  /** Either party, before departure; an accepted booking gives its seats back. */
  async cancelBooking(userId: string, bookingId: string, meta: RequestMeta): Promise<CarpoolBooking> {
    const other = await this.withLockedBooking(bookingId, async (tx, t, b) => {
      if (t.driver_id !== userId && b.passenger_id !== userId) throw bookingNotFound();
      if (b.status !== 'requested' && b.status !== 'accepted') throw conflict(`A ${b.status} booking cannot be cancelled`, 'invalid_transition', { from: b.status });
      if (t.status !== 'open' && t.status !== 'full') throw conflict('The trip has already left or ended', 'trip_departed', { status: t.status });
      if (b.status === 'accepted') {
        const free = t.seats_free + b.seats;
        await tx.execute(sql`UPDATE carpool_trips SET seats_free = ${free}, status = ${statusForSeats(free)} WHERE id = ${t.id}::uuid`);
      }
      await this.setBooking(tx, b, 'cancelled', userId, meta);
      return userId === t.driver_id ? b.passenger_id : t.driver_id;
    });
    await this.tell(other, 'Une réservation de covoiturage a été annulée.', undefined, bookingId);
    return this.bookingView(bookingId);
  }

  /* ------------------------------------------------------------------ trip steps */

  async depart(driverId: string, tripId: string, meta: RequestMeta): Promise<CarpoolTrip> {
    const told = await this.withLockedTrip(tripId, driverId, async (tx, t) => {
      if (t.status !== 'open' && t.status !== 'full') throw conflict(`A ${t.status} trip cannot depart`, 'invalid_transition', { from: t.status });
      if (t.departs_at.getTime() - DEPART_EARLY_MINUTES * 60_000 > Date.now()) throw conflict('Too early to depart', 'too_early');
      const dropped = await rowsOf<{ passenger_id: string }>(tx, sql`UPDATE carpool_bookings SET status = 'declined', updated_at = now() WHERE trip_id = ${t.id}::uuid AND status = 'requested' RETURNING passenger_id`);
      const riding = await rowsOf<{ passenger_id: string }>(tx, sql`SELECT passenger_id FROM carpool_bookings WHERE trip_id = ${t.id}::uuid AND status = 'accepted'`);
      await this.setTrip(tx, t, 'departed', driverId, meta);
      return { dropped: dropped.map((d) => d.passenger_id), riding: riding.map((d) => d.passenger_id) };
    });
    for (const p of told.dropped) await this.tell(p, 'Le trajet est parti : votre demande n’a pas été retenue.', tripId);
    for (const p of told.riding) await this.tell(p, 'Votre trajet de covoiturage est parti.', tripId);
    return this.get(driverId, tripId);
  }

  async complete(driverId: string, tripId: string, meta: RequestMeta): Promise<CarpoolTrip> {
    const riding = await this.withLockedTrip(tripId, driverId, async (tx, t) => {
      if (t.status !== 'departed') throw conflict(`A ${t.status} trip cannot be completed`, 'invalid_transition', { from: t.status });
      const done = await rowsOf<{ passenger_id: string }>(tx, sql`UPDATE carpool_bookings SET status = 'completed', updated_at = now() WHERE trip_id = ${t.id}::uuid AND status = 'accepted' RETURNING passenger_id`);
      await this.setTrip(tx, t, 'completed', driverId, meta);
      return done.map((d) => d.passenger_id);
    });
    for (const p of riding) await this.tell(p, 'Trajet terminé : vous pouvez évaluer le conducteur.', tripId);
    return this.get(driverId, tripId);
  }

  async cancelTrip(driverId: string, tripId: string, meta: RequestMeta): Promise<CarpoolTrip> {
    const told = await this.withLockedTrip(tripId, driverId, async (tx, t) => {
      if (t.status !== 'open' && t.status !== 'full') throw conflict(`A ${t.status} trip cannot be cancelled`, 'invalid_transition', { from: t.status });
      const hit = await rowsOf<{ passenger_id: string }>(tx, sql`UPDATE carpool_bookings SET status = 'cancelled', updated_at = now() WHERE trip_id = ${t.id}::uuid AND status IN ('requested', 'accepted') RETURNING passenger_id`);
      await this.setTrip(tx, t, 'cancelled', driverId, meta);
      return hit.map((d) => d.passenger_id);
    });
    for (const p of told) await this.tell(p, 'Le conducteur a annulé le trajet.', tripId);
    return this.get(driverId, tripId);
  }

  /** Reciprocal stars after a completed trip: the driver rates a passenger who rode, a passenger rates the driver. */
  async rate(userId: string, tripId: string, body: CarpoolRatingRequest): Promise<CarpoolRating> {
    if (!UUID_RE.test(tripId)) throw tripNotFound();
    const [t] = await rowsOf<TripRow>(this.db, sql`SELECT * FROM carpool_trips WHERE id = ${tripId}::uuid`);
    if (!t) throw tripNotFound();
    const rode = async (uid: string, statuses = "'completed'") => (await rowsOf(this.db, sql`SELECT 1 FROM carpool_bookings WHERE trip_id = ${tripId}::uuid AND passenger_id = ${uid}::uuid AND status IN (${sql.raw(statuses)}) LIMIT 1`)).length > 0;
    const isDriver = t.driver_id === userId;
    if (!isDriver && !(await rode(userId, "'accepted', 'completed'"))) throw tripNotFound();
    if (t.status !== 'completed') throw conflict('Only a completed trip can be rated', 'trip_not_completed');
    if (!(isDriver ? await rode(body.userId) : body.userId === t.driver_id)) throw validation('userId', 'you can only rate someone who shared this trip', 'not_a_participant');
    const done = await rowsOf(this.db, sql`INSERT INTO carpool_ratings (trip_id, rater_id, ratee_id, rating) VALUES (${tripId}::uuid, ${userId}::uuid, ${body.userId}::uuid, ${body.rating}) ON CONFLICT DO NOTHING RETURNING trip_id`);
    if (done.length === 0) throw conflict('You already rated this person', 'already_rated');
    return { tripId, userId: body.userId, rating: body.rating };
  }

  /* ------------------------------------------------------------------ internals */

  /** Trip row first, then the booking row: every writer takes the locks in the same order. */
  private async withLockedBooking<T>(bookingId: string, fn: (tx: Tx, t: TripRow, b: BookingRow) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(bookingId)) throw bookingNotFound();
    return this.db.transaction(async (tx) => {
      const [ref] = await rowsOf<{ trip_id: string }>(tx, sql`SELECT trip_id FROM carpool_bookings WHERE id = ${bookingId}::uuid`);
      if (!ref) throw bookingNotFound();
      const [t] = await rowsOf<TripRow>(tx, sql`SELECT * FROM carpool_trips WHERE id = ${ref.trip_id}::uuid FOR UPDATE`);
      const [b] = await rowsOf<BookingRow>(tx, sql`SELECT * FROM carpool_bookings WHERE id = ${bookingId}::uuid FOR UPDATE`);
      if (!t || !b) throw bookingNotFound();
      return fn(tx, t, b);
    });
  }

  private async withLockedTrip<T>(tripId: string, driverId: string, fn: (tx: Tx, t: TripRow) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(tripId)) throw tripNotFound();
    return this.db.transaction(async (tx) => {
      const [t] = await rowsOf<TripRow>(tx, sql`SELECT * FROM carpool_trips WHERE id = ${tripId}::uuid AND driver_id = ${driverId}::uuid FOR UPDATE`);
      if (!t) throw tripNotFound();
      return fn(tx, t);
    });
  }

  private async setBooking(tx: Tx, b: BookingRow, to: CarpoolBookingStatus, actor: string, meta: RequestMeta): Promise<void> {
    await tx.execute(sql`UPDATE carpool_bookings SET status = ${to}, updated_at = now() WHERE id = ${b.id}::uuid`);
    await this.audit.record({ action: 'carpool.booking_status_changed', actorUserId: actor, meta, metadata: { tripId: b.trip_id, bookingId: b.id, from: b.status, to } }, tx);
  }

  private async setTrip(tx: Tx, t: TripRow, to: CarpoolTripStatus, actor: string, meta: RequestMeta): Promise<void> {
    await tx.execute(sql`UPDATE carpool_trips SET status = ${to} WHERE id = ${t.id}::uuid`);
    await this.audit.record({ action: 'carpool.trip_status_changed', actorUserId: actor, meta, metadata: { tripId: t.id, from: t.status, to } }, tx);
  }

  private async tell(userId: string, body: string, tripId?: string, bookingId?: string): Promise<void> {
    await this.notifications.notify({ userId, category: 'system', title: 'Covoiturage', body, data: { ...(tripId ? { tripId } : {}), ...(bookingId ? { bookingId } : {}) } });
  }

  private async bookingView(id: string): Promise<CarpoolBooking> {
    const [b] = await rowsOf<BookingRow>(this.db, sql`SELECT b.*, u.handle::text AS handle, u.display_name FROM carpool_bookings b JOIN users u ON u.id = b.passenger_id WHERE b.id = ${id}::uuid`);
    return bookingOf(b!);
  }

  /** Views for one viewer: the driver sees every booking, a passenger only their own; exact points only for the parties of a seat. */
  private async views(rows: TripRow[], viewerId: string): Promise<CarpoolTrip[]> {
    if (rows.length === 0) return [];
    const tripIds = rows.map((r) => r.id);
    const books = await rowsOf<BookingRow>(
      this.db,
      sql`SELECT b.*, u.handle::text AS handle, u.display_name FROM carpool_bookings b JOIN users u ON u.id = b.passenger_id JOIN carpool_trips t ON t.id = b.trip_id
          WHERE b.trip_id IN (${uuidList(tripIds)}) AND (t.driver_id = ${viewerId}::uuid OR b.passenger_id = ${viewerId}::uuid) ORDER BY b.created_at, b.id`,
    );
    const rated = await rowsOf<{ trip_id: string; ratee_id: string }>(this.db, sql`SELECT trip_id, ratee_id FROM carpool_ratings WHERE rater_id = ${viewerId}::uuid AND trip_id IN (${uuidList(tripIds)})`);
    const ratedSet = new Set(rated.map((r) => `${r.trip_id}:${r.ratee_id}`));
    return rows.map((r) => {
      const isDriver = r.driver_id === viewerId;
      const mine = books.find((b) => b.trip_id === r.id && b.passenger_id === viewerId && (b.status === 'requested' || b.status === 'accepted' || b.status === 'completed')) ?? books.find((b) => b.trip_id === r.id && b.passenger_id === viewerId);
      const exact = isDriver || mine?.status === 'accepted' || mine?.status === 'completed';
      const pt = (lat: number, lng: number, label: string) => (exact ? { lat, lng, label } : { lat: roundCoord(lat), lng: roundCoord(lng), label });
      const tripBooks = isDriver ? books.filter((b) => b.trip_id === r.id) : [];
      const toRate: PersonRef[] = [];
      if (r.status === 'completed') {
        if (isDriver) {
          for (const b of tripBooks) if (b.status === 'completed' && !ratedSet.has(`${r.id}:${b.passenger_id}`)) toRate.push({ id: b.passenger_id, handle: b.handle, displayName: b.display_name });
        } else if (mine?.status === 'completed' && !ratedSet.has(`${r.id}:${r.driver_id}`)) {
          toRate.push({ id: r.driver_id, handle: r.d_handle, displayName: r.d_name });
        }
      }
      return {
        id: r.id,
        status: r.status,
        role: isDriver ? ('driver' as const) : mine ? ('passenger' as const) : ('viewer' as const),
        exact,
        origin: pt(r.origin_lat, r.origin_lng, r.origin_label),
        destination: pt(r.dest_lat, r.dest_lng, r.dest_label),
        distanceKm: r.distance_km,
        departsAt: isoOf(r.departs_at),
        seatsTotal: r.seats_total,
        seatsFree: r.seats_free,
        pricePerSeatMinor: num(r.price_per_seat_minor),
        currency: r.currency.trim(),
        note: r.note,
        vehicleLabel: r.vehicle_label,
        driver: { id: r.driver_id, handle: r.d_handle, displayName: r.d_name, ratingAvg: r.r_avg === null ? null : Math.round(r.r_avg * 10) / 10, ratingCount: r.r_count },
        myBooking: mine ? bookingOf(mine) : null,
        bookings: tripBooks.map(bookingOf),
        toRate,
        paymentMode: 'cash' as const,
        createdAt: isoOf(r.created_at),
      };
    });
  }
}

const bookingOf = (b: BookingRow): CarpoolBooking => ({
  id: b.id,
  tripId: b.trip_id,
  seats: b.seats,
  status: b.status,
  passenger: { id: b.passenger_id, handle: b.handle, displayName: b.display_name },
  createdAt: isoOf(b.created_at),
});

export type { Exec };

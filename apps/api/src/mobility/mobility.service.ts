import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type AdminDriverList,
  type AdminDriverListQuery,
  type CancelRideRequest,
  type CreateFavoritePlaceRequest,
  type CreateRideRequest,
  type DriverDecisionRequest,
  type DriverProfile,
  ErrorCodes,
  type FavoritePlace,
  type FavoritePlaceList,
  MAX_FAVORITE_PLACES,
  type MyRidesQuery,
  QUICK_MESSAGES,
  type QuickMessageCode,
  type RateRideRequest,
  RIDE_MAX_SCHEDULE_DAYS,
  RIDE_MIN_SCHEDULE_MINUTES,
  type RideAlertResult,
  type RideEstimate,
  type RideEstimateRequest,
  type RideList,
  type RideMessageList,
  type RideOffers,
  type RideRating,
  type RideReceipt,
  type RideShare,
  type RideVehicle,
  type RideView,
  type SharedRide,
  type TrustedContactList,
  type UpsertDriverRequest,
} from '@caselind/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { contentUrlOf } from '../media/media.service.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { type Tx } from '../orgs/orgs.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { KycPort } from '../wallet/kyc.port.js';
import {
  ACTIVE_RIDER_STATUSES,
  conflict,
  DRIVER_CANCEL_REASONS,
  DRIVER_CANCEL_STATUSES,
  DRIVER_POSITION_MAX_AGE_SECONDS,
  type DriverRow,
  FINAL_STATUSES,
  fareFor,
  fareOptions,
  fareRange,
  forbiddenBecause,
  haversineKm,
  HAVERSINE_SQL,
  isoOf,
  isoOrNull,
  LIVE_STATUSES,
  MAX_NOTIFIED_DRIVERS,
  MAX_SCHEDULED_RIDES,
  MAX_TRUSTED_CONTACTS,
  pointOf,
  REQUEST_TTL_MINUTES,
  RIDER_CANCEL_REASONS,
  RIDER_CANCEL_STATUSES,
  RideCodes,
  type RideRow,
  rideNotFound,
  SCHEDULE_DISPATCH_LEAD_MINUTES,
  servedVehicles,
  START_CODE_LOCK_MINUTES,
  START_CODE_MAX_ATTEMPTS,
  tariffFor,
  UUID_RE,
  validation,
} from './mobility.shared.js';

type Exec = Pick<Db, 'execute'>;
/** Raw rows: timestamps (columns named *_at) come back as text from this driver, normalise them to Date. */
const rowsOf = async <T>(e: Exec, q: SQL): Promise<T[]> =>
  (await e.execute(q)).rows.map((r) => {
    const row = r as Record<string, unknown>;
    for (const k of Object.keys(row)) if ((k.endsWith('_at') || k.endsWith('_until')) && typeof row[k] === 'string') row[k] = new Date(row[k]);
    return row;
  }) as T[];
const ids = (list: string[]): SQL => sql.join(list.map((i) => sql`${i}::uuid`), sql`, `);
const num = (v: string | number | null): number => (v === null ? 0 : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;

const NOTE = 'Tarif estimé à partir de la distance à vol d’oiseau : il peut varier. Paiement en espèces au chauffeur. Aucune disponibilité n’est garantie.';

interface DriverUserRow extends DriverRow {
  handle: string;
  display_name: string;
  rating_avg: string | number | null;
  rating_count: string | number;
  cancellations: string | number;
}

const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
};

@Injectable()
export class MobilityService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly codes: RideCodes,
    private readonly kyc: KycPort,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly moderation: ModerationRegistry,
  ) {}

  onModuleInit(): void {
    this.moderation.register('ride', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const r = await rowsOf(this.db, sql`SELECT 1 FROM mobility_rides WHERE id = ${id}::uuid AND (rider_id = ${viewerId}::uuid OR driver_id = ${viewerId}::uuid)`);
        return r.length > 0;
      },
      // The party a report is about is the driver once there is one, else the rider.
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const r = await rowsOf<{ a: string }>(this.db, sql`SELECT coalesce(driver_id, rider_id) AS a FROM mobility_rides WHERE id = ${id}::uuid`);
        return r[0]?.a ?? null;
      },
      // A ride is a private event between two people: nothing to hide for others.
      setHidden: async () => undefined,
    });
  }

  /* ------------------------------------------------------------------ estimate */

  estimate(body: RideEstimateRequest): RideEstimate {
    const currency = body.currency ?? 'USD';
    const q = fareOptions(this.env.MOBILITY_TARIFFS, currency, body, this.env.MOBILITY_DETOUR_FACTOR);
    if (!q) throw validation('currency', 'no tariff for this currency', 'currency_unsupported');
    const chosen = q.options.find((o) => o.vehicle === body.vehicle)!;
    const m = q.metrics[body.vehicle];
    return {
      estimated: true,
      vehicle: body.vehicle,
      currency,
      distanceKm: m.distanceKm,
      durationMin: m.durationMin,
      fareMinor: chosen.fareMinor,
      fareMin: chosen.fareMin,
      fareMax: chosen.fareMax,
      options: q.options,
      paymentMode: 'cash',
      note: NOTE,
    };
  }

  /* ------------------------------------------------------------------ driver profile */

  async upsertDriver(userId: string, body: UpsertDriverRequest): Promise<DriverProfile> {
    if (body.photoMediaId) {
      const ok = await rowsOf(
        this.db,
        sql`SELECT 1 FROM media_assets WHERE id = ${body.photoMediaId}::uuid AND owner_user_id = ${userId}::uuid AND status = 'ready' AND purpose <> 'kyc_document'`,
      );
      if (ok.length === 0) throw validation('photoMediaId', 'must be a ready upload of yours', 'media_not_found');
    }
    const comfort = body.vehicleKind === 'car' && body.comfort;
    const [existing] = await rowsOf<DriverRow>(this.db, sql`SELECT * FROM mobility_drivers WHERE user_id = ${userId}::uuid`);
    if (existing?.status === 'suspended') throw conflict('The driver profile is suspended', 'driver_suspended');
    // Absent = keep the current photo, null = remove it. Treating absent as null used to erase the photo
    // and, by counting it as a change, sent an approved driver back to review on any profile save.
    const photo = body.photoMediaId === undefined ? (existing?.photo_media_id ?? null) : body.photoMediaId;
    if (!existing) {
      await this.db.execute(sql`
        INSERT INTO mobility_drivers (user_id, vehicle_kind, comfort, make, plate, color, photo_media_id, zone)
        VALUES (${userId}::uuid, ${body.vehicleKind}, ${comfort}, ${body.make}, ${body.plate}, ${body.color}, ${photo}::uuid, ${body.zone})`);
    } else {
      // Any change of the vehicle or the zone sends an approved driver back to review (and offline).
      const changed =
        existing.vehicle_kind !== body.vehicleKind || existing.comfort !== comfort || existing.make !== body.make || existing.plate !== body.plate ||
        existing.color !== body.color || existing.zone !== body.zone || (existing.photo_media_id ?? null) !== photo;
      const resubmit = existing.status === 'rejected' || (existing.status === 'approved' && changed);
      if (existing.status === 'approved' && changed) await this.assertNoLiveRideAsDriver(this.db, userId);
      await this.db.execute(sql`
        UPDATE mobility_drivers SET vehicle_kind = ${body.vehicleKind}, comfort = ${comfort}, make = ${body.make}, plate = ${body.plate},
          color = ${body.color}, photo_media_id = ${photo}::uuid, zone = ${body.zone}, updated_at = now(),
          status = ${resubmit ? 'pending' : existing.status}, decision_reason = ${resubmit ? null : existing.decision_reason},
          online = ${resubmit ? false : existing.online},
          last_lat = ${resubmit ? null : existing.last_lat}, last_lng = ${resubmit ? null : existing.last_lng},
          last_location_at = ${resubmit ? null : existing.last_location_at ? existing.last_location_at.toISOString() : null}::timestamptz
        WHERE user_id = ${userId}::uuid`);
    }
    return this.getDriver(userId);
  }

  async getDriver(userId: string): Promise<DriverProfile> {
    const [row] = await this.loadDriverProfiles(sql`d.user_id = ${userId}::uuid`);
    if (!row) throw AppError.notFound('No driver profile');
    return row;
  }

  private async loadDriverProfiles(where: SQL, limit = 50): Promise<DriverProfile[]> {
    const rows = await rowsOf<DriverUserRow>(
      this.db,
      sql`SELECT d.*, u.handle, u.display_name,
            (SELECT avg(rating) FROM mobility_ride_ratings WHERE ratee_id = d.user_id) AS rating_avg,
            (SELECT count(*) FROM mobility_ride_ratings WHERE ratee_id = d.user_id) AS rating_count,
            (SELECT count(*) FROM mobility_rides WHERE driver_id = d.user_id AND status = 'cancelled_by_driver') AS cancellations
          FROM mobility_drivers d JOIN users u ON u.id = d.user_id WHERE ${where} ORDER BY d.created_at DESC, d.user_id LIMIT ${limit}`,
    );
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      status: r.status,
      vehicle: this.vehicleOf(r),
      zone: r.zone,
      online: r.online,
      decisionReason: r.decision_reason,
      ratingAverage: r.rating_avg === null ? null : round2(Number(r.rating_avg)),
      ratingCount: num(r.rating_count),
      cancellations: num(r.cancellations),
      createdAt: isoOf(r.created_at),
      updatedAt: isoOf(r.updated_at),
    }));
  }

  private vehicleOf(r: DriverRow) {
    return {
      kind: r.vehicle_kind,
      comfort: r.comfort,
      make: r.make,
      plate: r.plate,
      color: r.color,
      photoUrl: r.photo_media_id ? contentUrlOf(r.photo_media_id) : null,
    };
  }

  /** Approved driver whose KYC level is at least 1: the condition to go online, accept and drive. */
  private async requireReadyDriver(exec: Exec, userId: string, lock = false): Promise<DriverRow> {
    const [d] = await rowsOf<DriverRow>(exec, lock ? sql`SELECT * FROM mobility_drivers WHERE user_id = ${userId}::uuid FOR UPDATE` : sql`SELECT * FROM mobility_drivers WHERE user_id = ${userId}::uuid`);
    if (!d) throw forbiddenBecause('Register as a driver first', 'driver_not_registered');
    if (d.status !== 'approved') throw forbiddenBecause('The driver profile is not approved', 'driver_not_approved');
    if ((await this.kyc.limitsFor(userId, 'USD')).tier < 1) throw forbiddenBecause('Identity verification (level 1) is required', 'kyc_required');
    return d;
  }

  async setOnline(userId: string, online: boolean): Promise<DriverProfile> {
    if (online) {
      await this.requireReadyDriver(this.db, userId);
      await this.db.execute(sql`UPDATE mobility_drivers SET online = true, updated_at = now() WHERE user_id = ${userId}::uuid`);
    } else {
      const [d] = await rowsOf<DriverRow>(this.db, sql`SELECT * FROM mobility_drivers WHERE user_id = ${userId}::uuid`);
      if (!d) throw AppError.notFound('No driver profile');
      await this.assertNoLiveRideAsDriver(this.db, userId);
      await this.db.execute(sql`UPDATE mobility_drivers SET online = false, last_lat = NULL, last_lng = NULL, last_location_at = NULL, updated_at = now() WHERE user_id = ${userId}::uuid`);
    }
    return this.getDriver(userId);
  }

  private async assertNoLiveRideAsDriver(exec: Exec, userId: string): Promise<void> {
    const live = await rowsOf(exec, sql`SELECT 1 FROM mobility_rides WHERE driver_id = ${userId}::uuid AND status IN ('accepted', 'driver_arriving', 'in_progress') LIMIT 1`);
    if (live.length > 0) throw conflict('Finish or cancel the current ride first', 'ride_live');
  }

  /**
   * Last known position of an online driver (sent every 15 to 30 seconds). Overwrites the previous one; while a ride
   * is in progress, only the distance covered is accumulated.
   */
  async postLocation(userId: string, lat: number, lng: number): Promise<void> {
    const now = new Date();
    const pushed = await this.db.transaction(async (tx) => {
      const [d] = await rowsOf<DriverRow>(tx, sql`SELECT * FROM mobility_drivers WHERE user_id = ${userId}::uuid FOR UPDATE`);
      if (!d || d.status !== 'approved' || !d.online) throw forbiddenBecause('Go online first', 'driver_offline');
      await tx.execute(sql`UPDATE mobility_drivers SET last_lat = ${lat}, last_lng = ${lng}, last_location_at = ${now.toISOString()}::timestamptz, updated_at = now() WHERE user_id = ${userId}::uuid`);
      const [ride] = await rowsOf<RideRow>(tx, sql`SELECT * FROM mobility_rides WHERE driver_id = ${userId}::uuid AND status IN ('accepted', 'driver_arriving', 'in_progress') FOR UPDATE`);
      if (!ride) return null;
      if (ride.status === 'in_progress') {
        const add = ride.track_lat !== null && ride.track_lng !== null ? haversineKm({ lat: ride.track_lat, lng: ride.track_lng }, { lat, lng }) : 0;
        await tx.execute(sql`UPDATE mobility_rides SET actual_distance_km = actual_distance_km + ${add}, track_lat = ${lat}, track_lng = ${lng} WHERE id = ${ride.id}::uuid`);
      }
      return ride;
    });
    if (pushed) this.realtime.emitToUser(pushed.rider_id, 'ride.location', { rideId: pushed.id, lat, lng, updatedAt: now.toISOString() });
  }

  /* ------------------------------------------------------------------ admin */

  async adminListDrivers(q: AdminDriverListQuery): Promise<AdminDriverList> {
    return { items: await this.loadDriverProfiles(q.status ? sql`d.status = ${q.status}` : sql`true`, q.limit) };
  }

  async adminDecide(adminId: string, driverUserId: string, body: DriverDecisionRequest, meta: RequestMeta): Promise<DriverProfile> {
    if (!UUID_RE.test(driverUserId)) throw AppError.notFound('Driver not found');
    if (body.decision !== 'approve' && !body.reason) throw validation('reason', 'a reason is required', 'reason_required');
    if (driverUserId === adminId) throw AppError.forbidden('You cannot decide on your own driver profile');
    const status = await this.db.transaction(async (tx) => {
      const [d] = await rowsOf<DriverRow>(tx, sql`SELECT * FROM mobility_drivers WHERE user_id = ${driverUserId}::uuid FOR UPDATE`);
      if (!d) throw AppError.notFound('Driver not found');
      if (body.decision === 'approve') {
        if (d.status === 'approved') throw conflict('Already approved', 'already_decided');
        if ((await this.kyc.limitsFor(driverUserId, 'USD')).tier < 1) throw conflict('The driver must have a level 1 identity verification', 'kyc_required');
        await tx.execute(sql`UPDATE mobility_drivers SET status = 'approved', decision_reason = NULL, decided_by = ${adminId}::uuid, decided_at = now(), updated_at = now() WHERE user_id = ${driverUserId}::uuid`);
      } else if (body.decision === 'reject') {
        if (d.status !== 'pending') throw conflict('Only a pending profile can be rejected', 'invalid_transition');
        await tx.execute(sql`UPDATE mobility_drivers SET status = 'rejected', decision_reason = ${body.reason!}, decided_by = ${adminId}::uuid, decided_at = now(), updated_at = now() WHERE user_id = ${driverUserId}::uuid`);
      } else {
        if (d.status !== 'approved') throw conflict('Only an approved driver can be suspended', 'invalid_transition');
        await tx.execute(sql`UPDATE mobility_drivers SET status = 'suspended', decision_reason = ${body.reason!}, decided_by = ${adminId}::uuid, decided_at = now(), online = false, last_lat = NULL, last_lng = NULL, last_location_at = NULL, updated_at = now() WHERE user_id = ${driverUserId}::uuid`);
      }
      await this.audit.record({ action: 'mobility.driver_decided', actorUserId: adminId, subjectUserId: driverUserId, meta, metadata: { driverUserId, decision: body.decision } }, tx);
      return body.decision;
    });
    await this.notifications.notify({
      userId: driverUserId,
      category: 'system',
      title: 'Profil chauffeur',
      body: status === 'approve' ? 'Votre profil chauffeur est approuvé.' : status === 'reject' ? 'Votre profil chauffeur a été refusé.' : 'Votre profil chauffeur est suspendu.',
      data: { kind: 'driver_decision' },
    });
    return this.getDriver(driverUserId);
  }

  /* ------------------------------------------------------------------ rides: creation and reads */

  async createRide(riderId: string, body: CreateRideRequest): Promise<RideView> {
    const currency = body.currency ?? 'USD';
    const q = fareOptions(this.env.MOBILITY_TARIFFS, currency, body, this.env.MOBILITY_DETOUR_FACTOR);
    if (!q) throw validation('currency', 'no tariff for this currency', 'currency_unsupported');
    const option = q.options.find((o) => o.vehicle === body.vehicle)!;
    const m = q.metrics[body.vehicle];
    const now = new Date();
    let scheduledAt: Date | null = null;
    if (body.scheduledAt) {
      scheduledAt = new Date(body.scheduledAt);
      const t = scheduledAt.getTime();
      if (t < now.getTime() + RIDE_MIN_SCHEDULE_MINUTES * 60_000 || t > now.getTime() + RIDE_MAX_SCHEDULE_DAYS * 86_400_000) {
        throw validation('scheduledAt', `must be between ${RIDE_MIN_SCHEDULE_MINUTES} minutes and ${RIDE_MAX_SCHEDULE_DAYS} days ahead`, 'schedule_out_of_range');
      }
    }
    const id = randomUUID();
    const nonce = randomBytes(16).toString('hex');
    const hash = this.codes.hash(id, this.codes.codeFor(id, nonce));
    const status = scheduledAt ? 'scheduled' : 'requested';
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'ride-rider:' + riderId}))`);
      if (scheduledAt) {
        const [c] = await rowsOf<{ n: string }>(tx, sql`SELECT count(*) AS n FROM mobility_rides WHERE rider_id = ${riderId}::uuid AND status = 'scheduled'`);
        if (num(c!.n) >= MAX_SCHEDULED_RIDES) throw conflict('Too many scheduled rides', 'scheduled_limit');
      } else {
        const act = await rowsOf(tx, sql`SELECT 1 FROM mobility_rides WHERE rider_id = ${riderId}::uuid AND status IN ('requested', 'accepted', 'driver_arriving', 'in_progress') LIMIT 1`);
        if (act.length > 0) throw conflict('You already have a ride in progress', 'active_ride');
      }
      const stop = body.stop;
      const [r] = await rowsOf<RideRow>(
        tx,
        sql`INSERT INTO mobility_rides (id, rider_id, vehicle, status, pickup_lat, pickup_lng, pickup_label, stop_lat, stop_lng, stop_label,
              dropoff_lat, dropoff_lng, dropoff_label, currency, est_distance_km, est_duration_min, fare_minor, fare_min_minor, fare_max_minor,
              scheduled_at, code_nonce, code_hash, requested_at)
            VALUES (${id}::uuid, ${riderId}::uuid, ${body.vehicle}, ${status}, ${body.pickup.lat}, ${body.pickup.lng}, ${body.pickup.label},
              ${stop?.lat ?? null}, ${stop?.lng ?? null}, ${stop?.label ?? null},
              ${body.dropoff.lat}, ${body.dropoff.lng}, ${body.dropoff.label}, ${currency}, ${m.distanceKm}, ${m.durationMin},
              ${option.fareMinor}, ${option.fareMin}, ${option.fareMax},
              ${scheduledAt ? scheduledAt.toISOString() : null}::timestamptz, ${nonce}, ${hash}, ${scheduledAt ? null : now.toISOString()}::timestamptz)
            RETURNING *`,
      );
      return r!;
    });
    if (row.status === 'requested') await this.notifyNearbyDrivers(row);
    return (await this.views([row], riderId))[0]!;
  }

  /** Online approved drivers of the right type within the pick-up radius, nearest first. */
  private async nearbyDrivers(ride: RideRow): Promise<{ user_id: string; d: number }[]> {
    const kinds = ride.vehicle === 'moto' ? sql`d.vehicle_kind = 'moto'` : ride.vehicle === 'confort' ? sql`d.vehicle_kind = 'car' AND d.comfort` : sql`d.vehicle_kind = 'car'`;
    const dist = sql.raw(HAVERSINE_SQL('d.last_lat', 'd.last_lng', String(ride.pickup_lat), String(ride.pickup_lng)));
    return rowsOf(
      this.db,
      sql`SELECT user_id, d FROM (
            SELECT d.user_id, ${dist} AS d FROM mobility_drivers d
            WHERE d.status = 'approved' AND d.online AND d.last_lat IS NOT NULL
              AND d.last_location_at > now() - make_interval(secs => ${DRIVER_POSITION_MAX_AGE_SECONDS})
              AND d.user_id <> ${ride.rider_id}::uuid AND ${kinds}
              AND NOT EXISTS (SELECT 1 FROM mobility_rides l WHERE l.driver_id = d.user_id AND l.status IN ('accepted', 'driver_arriving', 'in_progress'))
          ) x WHERE d <= ${this.env.MOBILITY_PICKUP_RADIUS_KM} ORDER BY d, user_id LIMIT ${MAX_NOTIFIED_DRIVERS}`,
    );
  }

  private async notifyNearbyDrivers(ride: RideRow): Promise<void> {
    const drivers = await this.nearbyDrivers(ride);
    await this.notifications.notifyMany(
      drivers.map((d) => ({
        userId: d.user_id,
        category: 'system' as const,
        title: 'Course',
        body: 'Une demande de course est disponible près de vous.',
        data: { rideId: ride.id },
      })),
    );
  }

  /** Requests a driver could accept right now: requested rides in the pick-up radius that the vehicle can serve, nearest first. */
  async offersFor(userId: string): Promise<RideOffers> {
    const d = await this.requireReadyDriver(this.db, userId);
    if (!d.online || d.last_lat === null || d.last_lng === null) return { items: [] };
    const dist = sql.raw(HAVERSINE_SQL(String(d.last_lat), String(d.last_lng), 'r.pickup_lat', 'r.pickup_lng'));
    const vehicles = servedVehicles(d.vehicle_kind, d.comfort);
    const rows = await rowsOf<RideRow & { pd: number }>(
      this.db,
      sql`SELECT * FROM (SELECT r.*, ${dist} AS pd FROM mobility_rides r
            WHERE r.status = 'requested' AND r.rider_id <> ${userId}::uuid AND r.vehicle IN (${sql.join(vehicles.map((v) => sql`${v}`), sql`, `)})) x
          WHERE pd <= ${this.env.MOBILITY_PICKUP_RADIUS_KM} ORDER BY pd, created_at, id LIMIT 20`,
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        vehicle: r.vehicle,
        pickup: pointOf(r.pickup_lat, r.pickup_lng, r.pickup_label),
        stop: r.stop_label !== null ? pointOf(r.stop_lat!, r.stop_lng!, r.stop_label) : null,
        dropoff: pointOf(r.dropoff_lat, r.dropoff_lng, r.dropoff_label),
        pickupDistanceKm: round2(r.pd),
        fare: this.fareOf(r),
        distanceKm: r.est_distance_km,
        requestedAt: isoOf(r.requested_at!),
      })),
    };
  }

  async getRide(userId: string, rideId: string): Promise<RideView> {
    return (await this.views([await this.participantRide(this.db, userId, rideId)], userId))[0]!;
  }

  async myRides(userId: string, q: MyRidesQuery): Promise<RideList> {
    const scope = q.scope === 'active' ? sql`AND status NOT IN ('completed', 'cancelled_by_rider', 'cancelled_by_driver', 'expired')` : q.scope === 'done' ? sql`AND status IN ('completed', 'cancelled_by_rider', 'cancelled_by_driver', 'expired')` : sql``;
    const rows = await rowsOf<RideRow>(this.db, sql`SELECT * FROM mobility_rides WHERE (rider_id = ${userId}::uuid OR driver_id = ${userId}::uuid) ${scope} ORDER BY created_at DESC, id LIMIT ${q.limit}`);
    return { items: await this.views(rows, userId) };
  }

  /** Trip receipt: route, distance, duration, price, cash mode. Completed rides only. */
  async receipt(userId: string, rideId: string): Promise<RideReceipt> {
    const r = await this.participantRide(this.db, userId, rideId);
    if (r.status !== 'completed') throw conflict('Only a completed ride has a receipt', 'ride_not_completed');
    const drv = r.driver_id ? (await this.driverUsers([r.driver_id])).get(r.driver_id) : undefined;
    const measured = num(r.actual_distance_km) >= 0.1;
    return {
      rideId: r.id,
      vehicle: r.vehicle,
      pickup: pointOf(r.pickup_lat, r.pickup_lng, r.pickup_label),
      stop: r.stop_label !== null ? pointOf(r.stop_lat!, r.stop_lng!, r.stop_label) : null,
      dropoff: pointOf(r.dropoff_lat, r.dropoff_lng, r.dropoff_label),
      distanceKm: measured ? round2(r.actual_distance_km) : r.est_distance_km,
      durationMin: this.elapsedMinutes(r) ?? r.est_duration_min,
      fareMinor: num(r.final_fare_minor ?? r.fare_minor),
      currency: r.currency.trim(),
      paymentMode: 'cash',
      fareEstimated: true,
      driverName: drv?.display_name ?? null,
      plate: drv?.plate ?? null,
      startedAt: isoOrNull(r.started_at),
      completedAt: isoOf(r.completed_at!),
    };
  }

  /* ------------------------------------------------------------------ rides: transitions */

  async accept(driverId: string, rideId: string): Promise<RideView> {
    if (!UUID_RE.test(rideId)) throw rideNotFound();
    await this.requireReadyDriver(this.db, driverId);
    let row: RideRow;
    try {
      row = await this.db.transaction(async (tx) => {
        // Driver first, then ride: two drivers racing for one request queue on the ride row, the second one sees it taken.
        const d = await this.requireReadyDriver(tx, driverId, true);
        const [r] = await rowsOf<RideRow>(tx, sql`SELECT * FROM mobility_rides WHERE id = ${rideId}::uuid FOR UPDATE`);
        if (!r) throw rideNotFound();
        if (r.rider_id === driverId) throw forbiddenBecause('You cannot accept your own ride', 'own_ride');
        if (r.status !== 'requested') throw conflict('This ride is no longer available', 'ride_unavailable');
        if (!servedVehicles(d.vehicle_kind, d.comfort).includes(r.vehicle)) throw forbiddenBecause('Your vehicle does not serve this ride type', 'vehicle_mismatch');
        if (!d.online || d.last_lat === null || d.last_lng === null) throw forbiddenBecause('Go online and share your position first', 'driver_offline');
        if (haversineKm({ lat: d.last_lat, lng: d.last_lng }, { lat: r.pickup_lat, lng: r.pickup_lng }) > this.env.MOBILITY_PICKUP_RADIUS_KM) {
          throw forbiddenBecause('The pick-up point is too far', 'out_of_range');
        }
        await this.assertNoLiveRideAsDriver(tx, driverId).catch(() => {
          throw conflict('You already have a ride in progress', 'driver_busy');
        });
        const [u] = await rowsOf<RideRow>(tx, sql`UPDATE mobility_rides SET status = 'accepted', driver_id = ${driverId}::uuid, accepted_at = now(), updated_at = now() WHERE id = ${rideId}::uuid RETURNING *`);
        return u!;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('You already have a ride in progress', 'driver_busy');
      throw e;
    }
    await this.after(row, 'Un chauffeur a accepté votre course.');
    return (await this.views([row], driverId))[0]!;
  }

  async arriving(driverId: string, rideId: string): Promise<RideView> {
    const row = await this.driverStep(driverId, rideId, 'accepted', sql`status = 'driver_arriving', arrived_at = now()`);
    await this.after(row, 'Votre chauffeur arrive.');
    return (await this.views([row], driverId))[0]!;
  }

  async start(driverId: string, rideId: string, code: string): Promise<RideView> {
    if (!UUID_RE.test(rideId)) throw rideNotFound();
    const out = await this.db.transaction(async (tx) => {
      const r = await this.lockDriverRide(tx, driverId, rideId);
      if (r.status !== 'driver_arriving') throw conflict(`A ride ${r.status} cannot start`, 'invalid_transition', { from: r.status, to: 'in_progress' });
      if (r.code_locked_until && r.code_locked_until.getTime() > Date.now()) return { kind: 'locked' as const };
      if (!this.codes.matches(r.id, code, r.code_hash)) {
        const attempts = r.code_attempts + 1;
        const locked = attempts >= START_CODE_MAX_ATTEMPTS;
        await tx.execute(
          locked
            ? sql`UPDATE mobility_rides SET code_attempts = 0, code_locked_until = now() + make_interval(mins => ${START_CODE_LOCK_MINUTES}) WHERE id = ${r.id}::uuid`
            : sql`UPDATE mobility_rides SET code_attempts = ${attempts} WHERE id = ${r.id}::uuid`,
        );
        return { kind: 'bad' as const, remaining: Math.max(0, START_CODE_MAX_ATTEMPTS - attempts), locked };
      }
      const [d] = await rowsOf<DriverRow>(tx, sql`SELECT * FROM mobility_drivers WHERE user_id = ${driverId}::uuid`);
      const [u] = await rowsOf<RideRow>(
        tx,
        sql`UPDATE mobility_rides SET status = 'in_progress', started_at = now(), code_attempts = 0, actual_distance_km = 0,
              track_lat = ${d?.last_lat ?? null}, track_lng = ${d?.last_lng ?? null}, updated_at = now() WHERE id = ${r.id}::uuid RETURNING *`,
      );
      return { kind: 'ok' as const, row: u! };
    });
    if (out.kind === 'locked') throw new AppError(429, ErrorCodes.rateLimited, 'Too many wrong codes: wait before trying again', { reason: 'code_locked' });
    if (out.kind === 'bad') {
      if (out.locked) throw new AppError(429, ErrorCodes.rateLimited, 'Too many wrong codes: wait before trying again', { reason: 'code_locked' });
      throw new AppError(403, ErrorCodes.forbidden, 'The start code is not valid', { reason: 'invalid_start_code', remainingAttempts: out.remaining });
    }
    await this.after(out.row, 'Votre course a démarré.');
    return (await this.views([out.row], driverId))[0]!;
  }

  /** The price is the estimate, recalculated with the measured distance when positions were received. */
  async complete(driverId: string, rideId: string): Promise<RideView> {
    if (!UUID_RE.test(rideId)) throw rideNotFound();
    const row = await this.db.transaction(async (tx) => {
      const r = await this.lockDriverRide(tx, driverId, rideId);
      if (r.status !== 'in_progress') throw conflict(`A ride ${r.status} cannot be completed`, 'invalid_transition', { from: r.status, to: 'completed' });
      let final = num(r.fare_minor);
      const km = num(r.actual_distance_km);
      const t = tariffFor(this.env.MOBILITY_TARIFFS, r.currency.trim(), r.vehicle);
      if (t && km >= 0.1) {
        const minutes = Math.max(1, Math.ceil((Date.now() - (r.started_at?.getTime() ?? Date.now())) / 60_000));
        final = fareRange(t, fareFor(t, km, minutes)).fareMinor;
      }
      const [u] = await rowsOf<RideRow>(
        tx,
        sql`UPDATE mobility_rides SET status = 'completed', completed_at = now(), final_fare_minor = ${final}, share_hash = NULL, track_lat = NULL, track_lng = NULL, updated_at = now()
            WHERE id = ${r.id}::uuid RETURNING *`,
      );
      await tx.execute(sql`DELETE FROM mobility_ride_messages WHERE ride_id = ${r.id}::uuid`);
      return u!;
    });
    await this.after(row, 'Course terminée. Vous pouvez évaluer votre chauffeur.');
    return (await this.views([row], driverId))[0]!;
  }

  /** Rider or driver, closed list of reasons per side. No fee: payment is in cash, cancellations are only counted. */
  async cancel(userId: string, rideId: string, body: CancelRideRequest): Promise<RideView> {
    if (!UUID_RE.test(rideId)) throw rideNotFound();
    const row = await this.db.transaction(async (tx) => {
      const [r] = await rowsOf<RideRow>(tx, sql`SELECT * FROM mobility_rides WHERE id = ${rideId}::uuid AND (rider_id = ${userId}::uuid OR driver_id = ${userId}::uuid) FOR UPDATE`);
      if (!r) throw rideNotFound();
      const asRider = r.rider_id === userId;
      const reasons = asRider ? RIDER_CANCEL_REASONS : DRIVER_CANCEL_REASONS;
      if (!reasons.includes(body.reason)) throw validation('reason', `must be one of ${reasons.join(', ')}`, 'reason_not_allowed');
      const allowed = asRider ? RIDER_CANCEL_STATUSES : DRIVER_CANCEL_STATUSES;
      const to = asRider ? 'cancelled_by_rider' : 'cancelled_by_driver';
      if (!allowed.includes(r.status)) throw conflict(`A ride ${r.status} cannot be cancelled`, 'invalid_transition', { from: r.status, to });
      const [u] = await rowsOf<RideRow>(
        tx,
        sql`UPDATE mobility_rides SET status = ${to}, cancel_reason = ${body.reason}, cancelled_at = now(), share_hash = NULL, track_lat = NULL, track_lng = NULL, updated_at = now()
            WHERE id = ${r.id}::uuid RETURNING *`,
      );
      await tx.execute(sql`DELETE FROM mobility_ride_messages WHERE ride_id = ${r.id}::uuid`);
      return u!;
    });
    await this.after(row, row.status === 'cancelled_by_driver' ? 'Le chauffeur a annulé la course.' : 'Le passager a annulé la course.', userId);
    return (await this.views([row], userId))[0]!;
  }

  /* ------------------------------------------------------------------ jobs */

  /** Scheduled rides enter the dispatch 10 minutes before their time; unanswered requests expire after 3 minutes. */
  async runOnce(now: Date = new Date()): Promise<{ dispatched: number; expired: number }> {
    const at = now.toISOString();
    const due = await rowsOf<RideRow>(
      this.db,
      sql`UPDATE mobility_rides SET status = 'requested', requested_at = ${at}::timestamptz, updated_at = now()
          WHERE status = 'scheduled' AND scheduled_at - make_interval(mins => ${SCHEDULE_DISPATCH_LEAD_MINUTES}) <= ${at}::timestamptz RETURNING *`,
    );
    for (const r of due) await this.notifyNearbyDrivers(r);
    const expired = await rowsOf<RideRow>(
      this.db,
      sql`UPDATE mobility_rides SET status = 'expired', cancelled_at = ${at}::timestamptz, updated_at = now()
          WHERE status = 'requested' AND requested_at + make_interval(mins => ${REQUEST_TTL_MINUTES}) <= ${at}::timestamptz RETURNING *`,
    );
    for (const r of expired) {
      this.realtime.emitToUser(r.rider_id, 'ride.updated', { rideId: r.id, status: r.status });
      await this.notifications.notify({
        userId: r.rider_id,
        category: 'system',
        title: 'Course',
        body: 'Aucun chauffeur n’a accepté votre demande. Vous pouvez la renouveler.',
        data: { rideId: r.id },
      });
    }
    return { dispatched: due.length, expired: expired.length };
  }

  /* ------------------------------------------------------------------ share, safety, ratings, messages */

  async share(userId: string, rideId: string): Promise<RideShare> {
    if (!UUID_RE.test(rideId)) throw rideNotFound();
    const token = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const done = await this.db.transaction(async (tx) => {
      const [r] = await rowsOf<RideRow>(tx, sql`SELECT * FROM mobility_rides WHERE id = ${rideId}::uuid AND rider_id = ${userId}::uuid FOR UPDATE`);
      if (!r) throw rideNotFound();
      if (!LIVE_STATUSES.includes(r.status)) throw conflict('Only a ride in progress can be shared', 'ride_not_active');
      await tx.execute(sql`UPDATE mobility_rides SET share_hash = ${hash} WHERE id = ${r.id}::uuid`);
      return true;
    });
    void done;
    return { token, path: `/v1/rides/shared/${token}`, validWhile: 'ride_active' };
  }

  async unshare(userId: string, rideId: string): Promise<void> {
    await this.participantRide(this.db, userId, rideId, 'rider');
    await this.db.execute(sql`UPDATE mobility_rides SET share_hash = NULL WHERE id = ${rideId}::uuid`);
  }

  /** Read-only view for whoever holds the link; valid only while a driver is on the way or driving. */
  async sharedView(token: string): Promise<SharedRide> {
    const hash = createHash('sha256').update(token).digest('hex');
    const [r] = await rowsOf<RideRow>(this.db, sql`SELECT * FROM mobility_rides WHERE share_hash = ${hash} AND status IN ('accepted', 'driver_arriving', 'in_progress')`);
    if (!r) throw rideNotFound();
    const drv = r.driver_id ? (await this.driverUsers([r.driver_id])).get(r.driver_id) : undefined;
    return {
      status: r.status,
      vehicle: r.vehicle,
      pickupLabel: r.pickup_label,
      dropoffLabel: r.dropoff_label,
      driver: drv ? { displayName: drv.display_name, make: drv.make, color: drv.color, plate: drv.plate } : null,
      driverLocation: drv ? this.locationOf(drv) : null,
    };
  }

  async setTrustedContacts(userId: string, handles: string[]): Promise<TrustedContactList> {
    const unique = [...new Set(handles.map((h) => h.replace(/^@/, '')))];
    const found = unique.length
      ? await rowsOf<{ id: string; handle: string; display_name: string }>(
          this.db,
          sql`SELECT id, handle, display_name FROM users WHERE handle IN (${sql.join(unique.map((h) => sql`${h}`), sql`, `)}) AND status = 'active' AND id <> ${userId}::uuid`,
        )
      : [];
    if (found.length !== unique.length) throw validation('handles', 'unknown handle or yourself', 'contact_not_found');
    if (found.length > MAX_TRUSTED_CONTACTS) throw validation('handles', `at most ${MAX_TRUSTED_CONTACTS}`, 'too_many');
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM mobility_trusted_contacts WHERE user_id = ${userId}::uuid`);
      for (const f of found) await tx.execute(sql`INSERT INTO mobility_trusted_contacts (user_id, contact_user_id) VALUES (${userId}::uuid, ${f.id}::uuid)`);
    });
    return this.trustedContacts(userId);
  }

  async trustedContacts(userId: string): Promise<TrustedContactList> {
    const rows = await rowsOf<{ id: string; handle: string; display_name: string }>(
      this.db,
      sql`SELECT u.id, u.handle, u.display_name FROM mobility_trusted_contacts t JOIN users u ON u.id = t.contact_user_id WHERE t.user_id = ${userId}::uuid ORDER BY t.created_at, u.id`,
    );
    return { items: rows.map((r) => ({ userId: r.id, handle: r.handle, displayName: r.display_name })) };
  }

  /** Alert button: tells the trusted contacts of the caller. No position, no ride id, no address in the notification. */
  async alert(userId: string, rideId: string): Promise<RideAlertResult> {
    const r = await this.participantRide(this.db, userId, rideId);
    if (!LIVE_STATUSES.includes(r.status)) throw conflict('Alerts are only possible during a ride', 'ride_not_active');
    const [me] = await rowsOf<{ display_name: string }>(this.db, sql`SELECT display_name FROM users WHERE id = ${userId}::uuid`);
    const contacts = await rowsOf<{ contact_user_id: string }>(this.db, sql`SELECT contact_user_id FROM mobility_trusted_contacts WHERE user_id = ${userId}::uuid`);
    await this.db.execute(sql`UPDATE mobility_rides SET alert_count = alert_count + 1 WHERE id = ${r.id}::uuid`);
    await this.notifications.notifyMany(
      contacts.map((c) => ({
        userId: c.contact_user_id,
        category: 'security' as const,
        title: 'Alerte de sécurité',
        body: `${me?.display_name ?? 'Un proche'} a déclenché une alerte pendant une course. Essayez de le ou la joindre.`,
        data: { kind: 'ride_alert', fromUserId: userId },
      })),
    );
    return { notified: contacts.length };
  }

  async rate(userId: string, rideId: string, body: RateRideRequest): Promise<RideRating> {
    const r = await this.participantRide(this.db, userId, rideId);
    if (r.status !== 'completed' || !r.driver_id) throw conflict('Only a completed ride can be rated', 'ride_not_completed');
    const ratee = r.rider_id === userId ? r.driver_id : r.rider_id;
    const inserted = await rowsOf<{ created_at: Date }>(
      this.db,
      sql`INSERT INTO mobility_ride_ratings (ride_id, rater_id, ratee_id, rating, comment) VALUES (${r.id}::uuid, ${userId}::uuid, ${ratee}::uuid, ${body.rating}, ${body.comment ?? null})
          ON CONFLICT (ride_id, rater_id) DO NOTHING RETURNING created_at`,
    );
    if (inserted.length === 0) throw conflict('You already rated this ride', 'already_rated');
    return { rideId: r.id, rating: body.rating, comment: body.comment ?? null, createdAt: isoOf(inserted[0]!.created_at) };
  }

  /** Quick predefined messages, only while the ride is live; deleted when it ends. */
  async sendMessage(userId: string, rideId: string, code: QuickMessageCode): Promise<RideMessageList> {
    const r = await this.participantRide(this.db, userId, rideId);
    if (!LIVE_STATUSES.includes(r.status)) throw conflict('Messages are only possible during a ride', 'ride_not_active');
    await this.db.execute(sql`INSERT INTO mobility_ride_messages (ride_id, sender_id, code) VALUES (${r.id}::uuid, ${userId}::uuid, ${code})`);
    const other = r.rider_id === userId ? r.driver_id! : r.rider_id;
    this.realtime.emitToUser(other, 'ride.message', { rideId: r.id, code, text: QUICK_MESSAGES[code], fromRole: r.rider_id === userId ? 'rider' : 'driver' });
    await this.notifications.notify({ userId: other, category: 'message', title: 'Course', body: QUICK_MESSAGES[code], data: { rideId: r.id } });
    return this.listMessages(userId, rideId);
  }

  async listMessages(userId: string, rideId: string): Promise<RideMessageList> {
    const r = await this.participantRide(this.db, userId, rideId);
    const rows = await rowsOf<{ id: string; sender_id: string; code: QuickMessageCode; created_at: Date }>(
      this.db,
      sql`SELECT id, sender_id, code, created_at FROM mobility_ride_messages WHERE ride_id = ${r.id}::uuid ORDER BY created_at, id LIMIT 100`,
    );
    return {
      items: rows.map((m) => ({
        id: m.id,
        code: m.code,
        text: QUICK_MESSAGES[m.code] ?? m.code,
        fromRole: m.sender_id === r.rider_id ? ('rider' as const) : ('driver' as const),
        mine: m.sender_id === userId,
        createdAt: isoOf(m.created_at),
      })),
    };
  }

  /* ------------------------------------------------------------------ favourite places */

  async listFavorites(userId: string): Promise<FavoritePlaceList> {
    const rows = await rowsOf<FavRow>(this.db, sql`SELECT * FROM mobility_favorite_places WHERE user_id = ${userId}::uuid ORDER BY created_at, id`);
    return { items: rows.map(toFavorite) };
  }

  async addFavorite(userId: string, body: CreateFavoritePlaceRequest): Promise<FavoritePlace> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'ride-fav:' + userId}))`);
      const [c] = await rowsOf<{ n: string }>(tx, sql`SELECT count(*) AS n FROM mobility_favorite_places WHERE user_id = ${userId}::uuid`);
      if (num(c!.n) >= MAX_FAVORITE_PLACES) throw conflict(`At most ${MAX_FAVORITE_PLACES} favourite places`, 'favorites_limit');
      if (body.kind !== 'other') {
        const dup = await rowsOf(tx, sql`SELECT 1 FROM mobility_favorite_places WHERE user_id = ${userId}::uuid AND kind = ${body.kind}`);
        if (dup.length > 0) throw conflict('This place already exists: delete it first', 'kind_taken');
      }
      const [r] = await rowsOf<FavRow>(
        tx,
        sql`INSERT INTO mobility_favorite_places (user_id, kind, label, address, lat, lng) VALUES (${userId}::uuid, ${body.kind}, ${body.label}, ${body.address}, ${body.lat}, ${body.lng}) RETURNING *`,
      );
      return toFavorite(r!);
    });
  }

  async deleteFavorite(userId: string, id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Place not found');
    const gone = await rowsOf(this.db, sql`DELETE FROM mobility_favorite_places WHERE id = ${id}::uuid AND user_id = ${userId}::uuid RETURNING id`);
    if (gone.length === 0) throw AppError.notFound('Place not found');
  }

  /* ------------------------------------------------------------------ internals */

  private async participantRide(exec: Exec, userId: string, rideId: string, only?: 'rider'): Promise<RideRow> {
    if (!UUID_RE.test(rideId)) throw rideNotFound();
    const [r] = await rowsOf<RideRow>(
      exec,
      only ? sql`SELECT * FROM mobility_rides WHERE id = ${rideId}::uuid AND rider_id = ${userId}::uuid` : sql`SELECT * FROM mobility_rides WHERE id = ${rideId}::uuid AND (rider_id = ${userId}::uuid OR driver_id = ${userId}::uuid)`,
    );
    if (!r) throw rideNotFound();
    return r;
  }

  private async lockDriverRide(tx: Tx, driverId: string, rideId: string): Promise<RideRow> {
    const [r] = await rowsOf<RideRow>(tx, sql`SELECT * FROM mobility_rides WHERE id = ${rideId}::uuid AND driver_id = ${driverId}::uuid FOR UPDATE`);
    if (!r) throw rideNotFound();
    return r;
  }

  private async driverStep(driverId: string, rideId: string, from: RideRow['status'], set: SQL): Promise<RideRow> {
    if (!UUID_RE.test(rideId)) throw rideNotFound();
    return this.db.transaction(async (tx) => {
      const r = await this.lockDriverRide(tx, driverId, rideId);
      if (r.status !== from) throw conflict(`A ride ${r.status} cannot take this step`, 'invalid_transition', { from: r.status });
      const [u] = await rowsOf<RideRow>(tx, sql`UPDATE mobility_rides SET ${set}, updated_at = now() WHERE id = ${r.id}::uuid RETURNING *`);
      return u!;
    });
  }

  /** After a commit: realtime to both sides and a plain notification to the other party. */
  private async after(row: RideRow, text: string, actor?: string): Promise<void> {
    const targets = [row.rider_id, ...(row.driver_id ? [row.driver_id] : [])];
    for (const t of targets) this.realtime.emitToUser(t, 'ride.updated', { rideId: row.id, status: row.status });
    const to = actor ? targets.filter((t) => t !== actor) : [row.rider_id];
    await this.notifications.notifyMany(to.map((userId) => ({ userId, category: 'system' as const, title: 'Course', body: text, data: { rideId: row.id } })));
  }

  private elapsedMinutes(r: RideRow): number | null {
    return r.started_at && r.completed_at ? Math.max(1, Math.ceil((r.completed_at.getTime() - r.started_at.getTime()) / 60_000)) : null;
  }

  private fareOf(r: RideRow) {
    return { estimated: true as const, currency: r.currency.trim(), fareMinor: num(r.fare_minor), fareMin: num(r.fare_min_minor), fareMax: num(r.fare_max_minor) };
  }

  private locationOf(d: { last_lat: number | null; last_lng: number | null; last_location_at: Date | null }) {
    return d.last_lat !== null && d.last_lng !== null && d.last_location_at ? { lat: d.last_lat, lng: d.last_lng, updatedAt: isoOf(d.last_location_at) } : null;
  }

  private async driverUsers(driverIds: string[]): Promise<Map<string, DriverUserRow>> {
    if (driverIds.length === 0) return new Map();
    const rows = await rowsOf<DriverUserRow>(
      this.db,
      sql`SELECT d.*, u.handle, u.display_name,
            (SELECT avg(rating) FROM mobility_ride_ratings WHERE ratee_id = d.user_id) AS rating_avg, 0 AS rating_count, 0 AS cancellations
          FROM mobility_drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id IN (${ids([...new Set(driverIds)])})`,
    );
    return new Map(rows.map((r) => [r.user_id, r]));
  }

  /** API views (drivers and riders loaded in two queries). The start code, the position and the driver are rider-side only. */
  private async views(rows: RideRow[], viewerId: string): Promise<RideView[]> {
    if (rows.length === 0) return [];
    const drivers = await this.driverUsers(rows.map((r) => r.driver_id).filter((v): v is string => v !== null));
    const riders = await rowsOf<{ id: string; display_name: string }>(this.db, sql`SELECT id, display_name FROM users WHERE id IN (${ids([...new Set(rows.map((r) => r.rider_id))])})`);
    const riderNames = new Map(riders.map((r) => [r.id, r.display_name]));
    return rows.map((r) => {
      const role = r.rider_id === viewerId ? ('rider' as const) : ('driver' as const);
      const d = r.driver_id ? drivers.get(r.driver_id) : undefined;
      const live = LIVE_STATUSES.includes(r.status);
      return {
        id: r.id,
        role,
        status: r.status,
        vehicle: r.vehicle,
        pickup: pointOf(r.pickup_lat, r.pickup_lng, r.pickup_label),
        stop: r.stop_label !== null ? pointOf(r.stop_lat!, r.stop_lng!, r.stop_label) : null,
        dropoff: pointOf(r.dropoff_lat, r.dropoff_lng, r.dropoff_label),
        scheduledAt: isoOrNull(r.scheduled_at),
        fare: this.fareOf(r),
        finalFareMinor: r.final_fare_minor === null ? null : num(r.final_fare_minor),
        distanceKm: r.est_distance_km,
        durationMin: r.est_duration_min,
        paymentMode: 'cash' as const,
        rider: { userId: r.rider_id, displayName: riderNames.get(r.rider_id) ?? '' },
        driver: d
          ? { userId: d.user_id, handle: d.handle, displayName: d.display_name, vehicle: this.vehicleOf(d), ratingAverage: d.rating_avg === null ? null : round2(Number(d.rating_avg)) }
          : null,
        driverLocation: role === 'rider' && live && d ? this.locationOf(d) : null,
        startCode: role === 'rider' && (r.status === 'accepted' || r.status === 'driver_arriving') ? this.codes.codeFor(r.id, r.code_nonce) : null,
        cancelReason: r.cancel_reason,
        sharing: role === 'rider' && r.share_hash !== null && live,
        requestedAt: isoOrNull(r.requested_at),
        acceptedAt: isoOrNull(r.accepted_at),
        startedAt: isoOrNull(r.started_at),
        completedAt: isoOrNull(r.completed_at),
        cancelledAt: isoOrNull(r.cancelled_at),
        createdAt: isoOf(r.created_at),
      };
    });
  }
}

interface FavRow {
  id: string;
  kind: 'home' | 'work' | 'other';
  label: string;
  address: string;
  lat: number;
  lng: number;
  created_at: Date;
}
const toFavorite = (r: FavRow): FavoritePlace => ({ id: r.id, kind: r.kind, label: r.label, address: r.address, lat: r.lat, lng: r.lng, createdAt: isoOf(r.created_at) });

export { ACTIVE_RIDER_STATUSES, FINAL_STATUSES };
export type { RideVehicle };

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type CancelReason,
  ErrorCodes,
  type RideFareOption,
  type RidePoint,
  type RideStatus,
  type RideVehicle,
  START_CODE_LENGTH,
} from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { ENV, type Env, type MobilityTariffsOverride } from '../config/env.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const rideNotFound = () => AppError.notFound('Ride not found');
export const validation = (path: string, message: string, reason: string) =>
  new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message, reason }]);
export const conflict = (message: string, reason: string, extra: Record<string, unknown> = {}) =>
  AppError.conflict(message, { reason, ...extra });
export const forbiddenBecause = (message: string, reason: string) => new AppError(403, ErrorCodes.forbidden, message, { reason });

/** A ride is live (a driver is committed) in these statuses. */
export const LIVE_STATUSES: readonly RideStatus[] = ['accepted', 'driver_arriving', 'in_progress'];
/** The rider has an ongoing request or ride in these statuses (a scheduled ride does not count). */
export const ACTIVE_RIDER_STATUSES: readonly RideStatus[] = ['requested', 'accepted', 'driver_arriving', 'in_progress'];
export const FINAL_STATUSES: readonly RideStatus[] = ['completed', 'cancelled_by_rider', 'cancelled_by_driver', 'expired'];

export const RIDER_CANCEL_STATUSES: readonly RideStatus[] = ['scheduled', 'requested', 'accepted', 'driver_arriving'];
export const DRIVER_CANCEL_STATUSES: readonly RideStatus[] = ['accepted', 'driver_arriving'];
export const RIDER_CANCEL_REASONS: readonly CancelReason[] = ['changed_mind', 'wait_too_long', 'wrong_address', 'found_other', 'other'];
export const DRIVER_CANCEL_REASONS: readonly CancelReason[] = ['rider_unreachable', 'rider_no_show', 'vehicle_issue', 'too_far', 'safety', 'other'];

export const REQUEST_TTL_MINUTES = 3;
export const SCHEDULE_DISPATCH_LEAD_MINUTES = 10;
export const START_CODE_MAX_ATTEMPTS = 5;
export const START_CODE_LOCK_MINUTES = 10;
export const DRIVER_POSITION_MAX_AGE_SECONDS = 120;
export const MAX_SCHEDULED_RIDES = 5;
export const MAX_TRUSTED_CONTACTS = 3;
export const MAX_NOTIFIED_DRIVERS = 20;

/* ------------------------------------------------------------------------------ geometry */

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Same formula as `haversineKm`, in SQL, between two (lat, lng) column or parameter expressions. */
export const HAVERSINE_SQL = (lat1: string, lng1: string, lat2: string, lng2: string): string =>
  `(2 * ${EARTH_RADIUS_KM} * asin(least(1, sqrt(power(sin(radians((${lat2}) - (${lat1})) / 2), 2) + cos(radians(${lat1})) * cos(radians(${lat2})) * power(sin(radians((${lng2}) - (${lng1})) / 2), 2)))))`;

/* ------------------------------------------------------------------------------ tariffs */

export interface Tariff {
  baseMinor: number;
  perKmMinor: number;
  perMinMinor: number;
  minFareMinor: number;
}

/** Prudent estimates for Goma, in USD cents; CDF is derived with a rough rate (2 decimals, like the rest of the ledger). */
const USD_TARIFFS: Record<RideVehicle, Tariff> = {
  moto: { baseMinor: 50, perKmMinor: 35, perMinMinor: 3, minFareMinor: 100 },
  standard: { baseMinor: 100, perKmMinor: 70, perMinMinor: 6, minFareMinor: 200 },
  confort: { baseMinor: 150, perKmMinor: 100, perMinMinor: 8, minFareMinor: 300 },
};
const CDF_PER_USD = 2800;

export const AVERAGE_SPEED_KMH: Record<RideVehicle, number> = { moto: 28, standard: 24, confort: 24 };
export const STOP_DWELL_MINUTES = 3;
export const FARE_RANGE = 0.15;

export const RIDE_VEHICLES: readonly RideVehicle[] = ['moto', 'standard', 'confort'];

export function tariffFor(override: MobilityTariffsOverride | undefined, currency: string, vehicle: RideVehicle): Tariff | null {
  const custom = override?.[currency]?.[vehicle];
  if (custom) return custom;
  const usd = USD_TARIFFS[vehicle];
  if (currency === 'USD') return usd;
  if (currency === 'CDF') {
    return {
      baseMinor: usd.baseMinor * CDF_PER_USD,
      perKmMinor: usd.perKmMinor * CDF_PER_USD,
      perMinMinor: usd.perMinMinor * CDF_PER_USD,
      minFareMinor: usd.minFareMinor * CDF_PER_USD,
    };
  }
  return null;
}

export function fareFor(t: Tariff, km: number, minutes: number): number {
  return Math.max(t.minFareMinor, t.baseMinor + Math.round(t.perKmMinor * km) + Math.round(t.perMinMinor * minutes));
}

export function fareRange(t: Tariff, fare: number): { fareMinor: number; fareMin: number; fareMax: number } {
  return {
    fareMinor: fare,
    fareMin: Math.min(fare, Math.max(t.minFareMinor, Math.round(fare * (1 - FARE_RANGE)))),
    fareMax: Math.max(fare, Math.round(fare * (1 + FARE_RANGE))),
  };
}

export interface Route {
  pickup: RidePoint;
  stop?: RidePoint | undefined;
  dropoff: RidePoint;
}

/** Straight-line length of the legs times the detour factor, in km (2 decimals), and the duration in minutes. */
export function routeMetrics(r: Route, vehicle: RideVehicle, detour: number): { distanceKm: number; durationMin: number } {
  const legs = r.stop ? haversineKm(r.pickup, r.stop) + haversineKm(r.stop, r.dropoff) : haversineKm(r.pickup, r.dropoff);
  const distanceKm = Math.round(legs * detour * 100) / 100;
  const durationMin = Math.max(1, Math.ceil((distanceKm / AVERAGE_SPEED_KMH[vehicle]) * 60) + (r.stop ? STOP_DWELL_MINUTES : 0));
  return { distanceKm, durationMin };
}

export function fareOptions(
  override: MobilityTariffsOverride | undefined,
  currency: string,
  route: Route,
  detour: number,
): { options: RideFareOption[]; metrics: Record<RideVehicle, { distanceKm: number; durationMin: number }> } | null {
  const options: RideFareOption[] = [];
  const metrics = {} as Record<RideVehicle, { distanceKm: number; durationMin: number }>;
  for (const v of RIDE_VEHICLES) {
    const t = tariffFor(override, currency, v);
    if (!t) return null;
    const m = routeMetrics(route, v, detour);
    metrics[v] = m;
    options.push({ vehicle: v, ...fareRange(t, fareFor(t, m.distanceKm, m.durationMin)) });
  }
  return { options, metrics };
}

/** Which ride types a driver can serve. */
export function servedVehicles(kind: 'moto' | 'car', comfort: boolean): RideVehicle[] {
  if (kind === 'moto') return ['moto'];
  return comfort ? ['standard', 'confort'] : ['standard'];
}

/* ------------------------------------------------------------------------------ start code */

/**
 * 4-digit start code derived from (server key, ride id, nonce): the rider can read it back without it being stored in
 * clear. The database keeps the nonce and a keyed hash.
 */
@Injectable()
export class RideCodes {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = createHmac('sha256', env.JWT_ACCESS_SECRET).update('caselind:ride-start:v1').digest();
  }

  codeFor(rideId: string, nonce: string): string {
    const n = createHmac('sha256', this.key).update(`code:${rideId}:${nonce}`).digest().readUInt32BE(0) % 10 ** START_CODE_LENGTH;
    return String(n).padStart(START_CODE_LENGTH, '0');
  }

  hash(rideId: string, code: string): string {
    return createHmac('sha256', this.key).update(`hash:${rideId}:${code}`).digest('hex');
  }

  matches(rideId: string, code: string, storedHash: string): boolean {
    const a = Buffer.from(this.hash(rideId, code), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

/* ------------------------------------------------------------------------------ rows */

export interface RideRow {
  id: string;
  rider_id: string;
  driver_id: string | null;
  vehicle: RideVehicle;
  status: RideStatus;
  pickup_lat: number;
  pickup_lng: number;
  pickup_label: string;
  stop_lat: number | null;
  stop_lng: number | null;
  stop_label: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_label: string;
  currency: string;
  est_distance_km: number;
  est_duration_min: number;
  fare_minor: string | number;
  fare_min_minor: string | number;
  fare_max_minor: string | number;
  final_fare_minor: string | number | null;
  actual_distance_km: number;
  track_lat: number | null;
  track_lng: number | null;
  scheduled_at: Date | null;
  code_nonce: string;
  code_hash: string;
  code_attempts: number;
  code_locked_until: Date | null;
  share_hash: string | null;
  cancel_reason: CancelReason | null;
  alert_count: number;
  requested_at: Date | null;
  accepted_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DriverRow {
  user_id: string;
  vehicle_kind: 'moto' | 'car';
  comfort: boolean;
  make: string;
  plate: string;
  color: string;
  photo_media_id: string | null;
  zone: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  decision_reason: string | null;
  online: boolean;
  last_lat: number | null;
  last_lng: number | null;
  last_location_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const isoOf = (v: Date | string): string => new Date(v).toISOString();
export const isoOrNull = (v: Date | string | null): string | null => (v === null ? null : isoOf(v));
export const pointOf = (lat: number, lng: number, label: string): RidePoint => ({ lat, lng, label });

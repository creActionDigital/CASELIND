import type { CourierRequestSize } from '@caselind/contracts';
import type { MobilityTariffsOverride } from '../config/env.js';
import { fareFor, routeMetrics, tariffFor } from '../mobility/mobility.shared.js';

/** Before acceptance a courier only gets coordinates rounded to 3 decimals (about 110 m). */
export const roundCoord = (v: number): number => Math.round(v * 1000) / 1000;

/** A bigger parcel pays more than the moto tariff of the same trip; a document pays the plain tariff. */
export const SIZE_FACTOR: Record<CourierRequestSize | 'document', number> = { document: 1, small: 1, medium: 1.25, large: 1.6 };
export const MIN_TRIP_KM = 0.05;

/**
 * Server-side estimate: the mobility moto tariff (base + distance + time, with its minimum) on the straight line
 * times the detour factor, times the size factor. Null when the currency has no tariff. Never typed by the client.
 */
export function estimateCourierFee(
  override: MobilityTariffsOverride | undefined,
  currency: string,
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
  size: CourierRequestSize | null,
  detour: number,
): { distanceKm: number; durationMin: number; feeMinor: number } | null {
  const tariff = tariffFor(override, currency, 'moto');
  if (!tariff) return null;
  const m = routeMetrics({ pickup: { ...pickup, label: '' }, dropoff: { ...dropoff, label: '' } }, 'moto', detour);
  const feeMinor = Math.round(fareFor(tariff, m.distanceKm, m.durationMin) * SIZE_FACTOR[size ?? 'document']);
  return { distanceKm: m.distanceKm, durationMin: m.durationMin, feeMinor };
}

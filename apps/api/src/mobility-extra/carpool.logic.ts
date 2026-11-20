import { CARPOOL_MAX_LEAD_DAYS, CARPOOL_MIN_LEAD_MINUTES, CARPOOL_PRICE_FACTOR, type CarpoolTripStatus } from '@caselind/contracts';

/** Points shown to non-participants: 3 decimals, about 110 m. */
export const roundCoord = (v: number): number => Math.round(v * 1000) / 1000;

/** Highest price per seat: a multiple of the estimated fare of the whole trip (the driver may share, never profit hugely). */
export const maxSeatPriceMinor = (estimatedFareMinor: number): number => Math.round(estimatedFareMinor * CARPOOL_PRICE_FACTOR);

/** Departure between 30 minutes and 60 days ahead. */
export function departureInRange(departsAt: Date, now: Date): boolean {
  const t = departsAt.getTime();
  return t >= now.getTime() + CARPOOL_MIN_LEAD_MINUTES * 60_000 && t <= now.getTime() + CARPOOL_MAX_LEAD_DAYS * 86_400_000;
}

/** Status of a trip that has not left yet, from the seats left. */
export const statusForSeats = (seatsFree: number): Extract<CarpoolTripStatus, 'open' | 'full'> => (seatsFree > 0 ? 'open' : 'full');

/** Whether `seats` more seats can be handed out. */
export const canSeat = (seatsFree: number, seats: number): boolean => seats >= 1 && seats <= seatsFree;

/** UTC day window [start, end) of a YYYY-MM-DD date. Null when the date does not exist. */
export function dayWindow(date: string): { start: Date; end: Date } | null {
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== date) return null;
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

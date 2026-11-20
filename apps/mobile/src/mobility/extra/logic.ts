import { CARPOOL_MAX_LEAD_DAYS, CARPOOL_MIN_LEAD_MINUTES, RENTAL_MAX_DAYS } from '@caselind/contracts';
import type { CarpoolBookingStatus, CarpoolTripStatus, RoadsideStatus } from '@caselind/contracts';

/* Logique pure du covoiturage, de la location de véhicules et du dépannage (aucun paiement en ligne). */

/* ------------------------------------------------------------------ dates */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const dayMs = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** AAAA-MM-JJ qui existe vraiment (pas de 31 février). */
export function isDay(s: string): boolean {
  const m = DAY_RE.exec(s.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const out = new Date(Date.UTC(y, mo - 1, d));
  return out.getUTCFullYear() === y && out.getUTCMonth() === mo - 1 && out.getUTCDate() === d;
}

export const todayUtc = (now: number = Date.now()): string => new Date(now).toISOString().slice(0, 10);

export type DepartureCheck = 'ok' | 'invalid' | 'too_soon' | 'too_far';

/** De 30 minutes à 60 jours à l’avance (bornes incluses), comme le serveur (400 `departure_out_of_range`). */
export function checkDeparture(at: Date | null, now: number): DepartureCheck {
  if (!at || Number.isNaN(at.getTime())) return 'invalid';
  const delta = at.getTime() - now;
  if (delta < CARPOOL_MIN_LEAD_MINUTES * 60_000) return 'too_soon';
  if (delta > CARPOOL_MAX_LEAD_DAYS * 86_400_000) return 'too_far';
  return 'ok';
}

export type PeriodCheck = 'ok' | 'invalid' | 'order' | 'too_long' | 'past';

/** Nombre de jours, bornes incluses (du 10 au 12 : 3 jours). */
export const rentalDays = (from: string, to: string): number => Math.round((dayMs(to) - dayMs(from)) / 86_400_000) + 1;

/** Période de location : dates réelles, fin après le début, 30 jours au plus (bornes incluses), pas dans le passé. */
export function checkRentalPeriod(from: string, to: string, today: string): PeriodCheck {
  if (!isDay(from) || !isDay(to)) return 'invalid';
  if (to < from) return 'order';
  if (rentalDays(from, to) > RENTAL_MAX_DAYS) return 'too_long';
  if (from < today) return 'past';
  return 'ok';
}

/** Affichage seulement : le total qui compte est celui du serveur. */
export const rentalTotal = (days: number, dailyRateMinor: number): number => days * dailyRateMinor;

/* ------------------------------------------------------------------ covoiturage */

/** Prix saisi (« 5 » ou « 5,50 ») en unités mineures (centimes) ; null si invalide. */
export function parsePriceMinor(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function passengerActions(trip: { role: 'driver' | 'passenger' | 'viewer'; status: CarpoolTripStatus; myBookingStatus: CarpoolBookingStatus | null }): {
  book: boolean;
  cancelBooking: boolean;
  rate: boolean;
} {
  const live = trip.myBookingStatus === 'requested' || trip.myBookingStatus === 'accepted';
  return {
    book: trip.role === 'viewer' && trip.status === 'open',
    cancelBooking: trip.role === 'passenger' && live && (trip.status === 'open' || trip.status === 'full'),
    rate: trip.role === 'passenger' && trip.status === 'completed',
  };
}

export function driverActions(status: CarpoolTripStatus): { depart: boolean; complete: boolean; cancel: boolean } {
  return { depart: status === 'open' || status === 'full', complete: status === 'departed', cancel: status === 'open' || status === 'full' };
}

/** Demande d’un passager vue par le conducteur : accepter ou refuser (demandée), annuler (acceptée) tant que le trajet n’est pas parti. */
export function bookingDriverActions(b: CarpoolBookingStatus, trip: CarpoolTripStatus): { accept: boolean; decline: boolean; cancel: boolean } {
  const before = trip === 'open' || trip === 'full';
  return { accept: b === 'requested' && trip === 'open', decline: b === 'requested' && before, cancel: b === 'accepted' && before };
}

/* ------------------------------------------------------------------ dépannage */

export const ROADSIDE_LIVE: readonly RoadsideStatus[] = ['requested', 'accepted', 'on_the_way'];
export const isRoadsideLive = (s: RoadsideStatus): boolean => ROADSIDE_LIVE.includes(s);

export function roadsideActions(role: 'requester' | 'provider', s: RoadsideStatus): { cancel: boolean; onTheWay: boolean; done: boolean; release: boolean; consent: boolean } {
  const underWay = s === 'accepted' || s === 'on_the_way';
  return {
    cancel: role === 'requester' && isRoadsideLive(s),
    onTheWay: role === 'provider' && underWay,
    done: role === 'provider' && underWay,
    release: role === 'provider' && underWay,
    consent: role === 'provider' && underWay,
  };
}

/** Minutes d’arrivée saisies : entier de 1 à 480 ; null sinon. */
export function parseEta(input: string): number | null {
  if (!/^\d{1,3}$/.test(input.trim())) return null;
  const n = Number(input.trim());
  return n >= 1 && n <= 480 ? n : null;
}

/** Minutes avant l’échéance d’une demande ouverte (0 si passée). */
export const minutesLeft = (expiresAt: string, now: number): number => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));

import type { CancelReason, DriverStatus, RideStatus, RideView } from '@caselind/contracts';
import { RIDE_MAX_SCHEDULE_DAYS, RIDE_MIN_SCHEDULE_MINUTES } from '@caselind/contracts';
import { createLocationPump, type LocationPumpDeps } from '../delivery/logic';
import { parseCoordinate, roundCoordinate } from '../places/geo';
import { formatMoney } from '../shop/format';

/* Logique pure de la mobilité (lot 11) : fourchette de prix, course programmée, actions selon statut et rôle, minuterie de position. */

/* ------------------------------------------------------------------ prix */

/** « 3,00 $US – 4,00 $US » ; une seule valeur si la fourchette est réduite à un point. Toujours une estimation. */
export function formatFareRange(min: number, max: number, currency: string, locale = 'fr'): string {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (lo === hi) return formatMoney(lo, currency, locale);
  return `${formatMoney(lo, currency, locale)} – ${formatMoney(hi, currency, locale)}`;
}

/* ------------------------------------------------------------------ course programmée */

export type RideScheduleCheck = 'ok' | 'invalid' | 'too_soon' | 'too_far';

const MIN_MS = RIDE_MIN_SCHEDULE_MINUTES * 60_000;
const MAX_MS = RIDE_MAX_SCHEDULE_DAYS * 86_400_000;

/** De 30 minutes à 7 jours à l'avance (bornes incluses), comme le serveur (400 `schedule_out_of_range`). */
export function checkRideSchedule(at: Date | null, now: number): RideScheduleCheck {
  if (!at || Number.isNaN(at.getTime())) return 'invalid';
  const delta = at.getTime() - now;
  if (delta < MIN_MS) return 'too_soon';
  if (delta > MAX_MS) return 'too_far';
  return 'ok';
}

/* ------------------------------------------------------------------ statuts et actions */

export type RideRole = 'rider' | 'driver';

export const LIVE_STATUSES: readonly RideStatus[] = ['requested', 'accepted', 'driver_arriving', 'in_progress'];
/** Course vivante : demandée, acceptée, en approche ou en cours (les programmées n'en font pas partie). */
export const isLiveRide = (s: RideStatus): boolean => LIVE_STATUSES.includes(s);
export const isFinishedRide = (s: RideStatus): boolean =>
  s === 'completed' || s === 'cancelled_by_rider' || s === 'cancelled_by_driver' || s === 'expired';
/** Le chauffeur et sa position ne sont visibles que dans ces statuts. */
export const hasDriverOnTheWay = (s: RideStatus): boolean => s === 'accepted' || s === 'driver_arriving' || s === 'in_progress';

export type RideAction = 'cancel' | 'arrived' | 'start' | 'complete' | 'message' | 'share' | 'alert' | 'rate' | 'receipt' | 'report';

/**
 * Actions permises. Le serveur reste la référence : annulation passager jusqu'au départ, chauffeur avant le départ ;
 * messages, partage et alerte pendant la course seulement ; évaluation et reçu après `completed`.
 */
export function rideActions(status: RideStatus, role: RideRole): RideAction[] {
  if (role === 'rider') {
    switch (status) {
      case 'scheduled':
      case 'requested':
        return ['cancel'];
      case 'accepted':
      case 'driver_arriving':
        return ['message', 'share', 'alert', 'cancel', 'report'];
      case 'in_progress':
        return ['message', 'share', 'alert', 'report'];
      case 'completed':
        return ['rate', 'receipt', 'report'];
      default:
        return [];
    }
  }
  switch (status) {
    case 'accepted':
      return ['arrived', 'message', 'cancel', 'report'];
    case 'driver_arriving':
      return ['start', 'message', 'cancel', 'report'];
    case 'in_progress':
      return ['complete', 'message', 'report'];
    case 'completed':
      return ['rate', 'report'];
    default:
      return [];
  }
}

export const canDo = (status: RideStatus, role: RideRole, action: RideAction): boolean => rideActions(status, role).includes(action);

/** Liste fermée des motifs d'annulation de chaque côté. */
export const RIDER_CANCEL_REASONS: readonly CancelReason[] = ['changed_mind', 'wait_too_long', 'wrong_address', 'found_other', 'other'];
export const DRIVER_CANCEL_REASONS: readonly CancelReason[] = ['rider_unreachable', 'rider_no_show', 'vehicle_issue', 'too_far', 'safety', 'other'];
export const cancelReasons = (role: RideRole): readonly CancelReason[] => (role === 'rider' ? RIDER_CANCEL_REASONS : DRIVER_CANCEL_REASONS);

/** Code de départ : 4 chiffres. */
export const isCompleteStartCode = (code: string): boolean => /^\d{4}$/.test(code);

/** « 4 8 2 7 » espacé pour une lecture en grand. */
export const formatStartCode = (code: string): string => code.split('').join(' ');

export const isFavoriteLimitReached = (count: number, max = 5): boolean => count >= max;

/** Statut du chauffeur : peut passer en ligne seulement une fois approuvé. */
export const canGoOnline = (status: DriverStatus): boolean => status === 'approved';

/** Étapes de la frise de la course (hors annulation). */
export const RIDE_STEPS: readonly RideStatus[] = ['requested', 'accepted', 'driver_arriving', 'in_progress', 'completed'];

/** Prix à montrer : final une fois terminée, sinon l'estimation (fourchette). */
export function fareLine(ride: Pick<RideView, 'fare' | 'finalFareMinor'>, locale = 'fr'): { text: string; final: boolean } {
  if (ride.finalFareMinor !== null) return { text: formatMoney(ride.finalFareMinor, ride.fare.currency, locale), final: true };
  return { text: formatFareRange(ride.fare.fareMin, ride.fare.fareMax, ride.fare.currency, locale), final: false };
}

/* ------------------------------------------------------------------ minuterie de position du chauffeur */

export const DRIVER_LOCATION_INTERVAL_MS = 20_000;

/** Même minuterie que la livraison, réglée sur 20 s : un envoi immédiat, jamais deux en parallèle, arrêt hors ligne. */
export function createDriverLocationPump(deps: Omit<LocationPumpDeps, 'intervalMs'>) {
  return createLocationPump({ ...deps, intervalMs: DRIVER_LOCATION_INTERVAL_MS });
}

/** Le suivi doit s'arrêter : chauffeur hors ligne, non approuvé ou KYC retiré (403 de la position). */
export function isDriverLocationStop(status: number | null, reason: string | null | undefined): boolean {
  return status === 403 && (reason === 'driver_not_approved' || reason === 'kyc_required' || reason === 'driver_offline');
}

/* ------------------------------------------------------------------ saisie d'un lieu */

/** Nom + coordonnées saisis (« -1,6585 » ou « -1.6585 ») -> point de course ; null si invalide. */
export function parsePoint(label: string, lat: string, lng: string): { lat: number; lng: number; label: string } | null {
  const name = label.trim().slice(0, 160);
  const la = parseCoordinate(lat, 'lat');
  const ln = parseCoordinate(lng, 'lng');
  if (!name || la === null || ln === null) return null;
  return { lat: roundCoordinate(la), lng: roundCoordinate(ln), label: name };
}

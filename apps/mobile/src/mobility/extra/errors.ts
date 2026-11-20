import { ApiRequestError } from '../../lib/api';
import type { MessageKey } from '../../i18n';
import { mobilityErrorMessage } from '../errors';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Raisons propres au covoiturage, à la location et au dépannage (champ `reason` du serveur) vers une clé de texte. */
export const EXTRA_REASONS: Record<string, MessageKey> = {
  open_limit: 'extra.error.open_limit',
  departure_out_of_range: 'extra.error.departure_out_of_range',
  price_too_high: 'extra.error.price_too_high',
  same_point: 'extra.error.same_point',
  trip_unavailable: 'extra.error.trip_unavailable',
  not_enough_seats: 'extra.error.not_enough_seats',
  already_booked: 'extra.error.already_booked',
  booking_limit: 'extra.error.booking_limit',
  own_trip: 'extra.error.own_trip',
  trip_departed: 'extra.error.trip_departed',
  too_early: 'extra.error.too_early',
  invalid_transition: 'extra.error.invalid_transition',
  already_rated: 'extra.error.already_rated',
  trip_not_completed: 'extra.error.trip_not_completed',
  unavailable: 'extra.error.unavailable',
  period_too_long: 'extra.error.period_too_long',
  period_order: 'extra.error.period_order',
  in_the_past: 'extra.error.in_the_past',
  invalid_date: 'extra.error.invalid_date',
  invalid_media: 'extra.error.invalid_media',
  request_unavailable: 'extra.error.request_unavailable',
  provider_busy: 'extra.error.provider_busy',
  own_request: 'extra.error.own_request',
  location_consent_required: 'extra.error.location_consent_required',
  driver_not_approved: 'extra.error.driver_not_approved',
  kyc_required: 'extra.error.kyc_required',
};

/** Clé de la raison portée par une erreur de l’API (détail `reason`, ou premier détail de validation) ; null sinon. */
export function extraReasonKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiRequestError)) return null;
  const reason = err.detail<string>('reason');
  if (typeof reason === 'string' && EXTRA_REASONS[reason]) return EXTRA_REASONS[reason]!;
  if (Array.isArray(err.details)) {
    const first = (err.details as { reason?: string }[])[0]?.reason;
    if (first && EXTRA_REASONS[first]) return EXTRA_REASONS[first]!;
  }
  return null;
}

/** Message localisé pour les trois modules ; sinon les messages de la mobilité, puis le message générique. */
export function extraErrorMessage(err: unknown, t: T, locale = 'fr'): string {
  const key = extraReasonKey(err);
  return key ? t(key) : mobilityErrorMessage(err, t, locale);
}

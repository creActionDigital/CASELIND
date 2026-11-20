import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../lib/api';
import { extraReasonKey } from './errors';
import {
  bookingDriverActions,
  checkDeparture,
  checkRentalPeriod,
  driverActions,
  isDay,
  minutesLeft,
  parseEta,
  parsePriceMinor,
  passengerActions,
  rentalDays,
  rentalTotal,
  roadsideActions,
} from './logic';

describe('dates', () => {
  it('valide un jour réel', () => {
    expect(isDay('2026-06-30')).toBe(true);
    expect(isDay('2026-02-31')).toBe(false);
    expect(isDay('30/06/2026')).toBe(false);
  });
  it('accepte un départ de 30 minutes à 60 jours, bornes incluses', () => {
    const now = Date.parse('2026-06-01T10:00:00Z');
    expect(checkDeparture(null, now)).toBe('invalid');
    expect(checkDeparture(new Date(now + 29 * 60_000), now)).toBe('too_soon');
    expect(checkDeparture(new Date(now + 30 * 60_000), now)).toBe('ok');
    expect(checkDeparture(new Date(now + 60 * 86_400_000), now)).toBe('ok');
    expect(checkDeparture(new Date(now + 60 * 86_400_000 + 1000), now)).toBe('too_far');
  });
});

describe('location de véhicules', () => {
  it('compte les jours bornes incluses et calcule le total affiché', () => {
    expect(rentalDays('2026-06-10', '2026-06-12')).toBe(3);
    expect(rentalDays('2026-06-10', '2026-06-10')).toBe(1);
    expect(rentalTotal(3, 5000)).toBe(15000);
  });
  it('contrôle la période comme le serveur', () => {
    const today = '2026-06-01';
    expect(checkRentalPeriod('2026-06-02', '2026-06-04', today)).toBe('ok');
    expect(checkRentalPeriod('2026-06-01', '2026-06-30', today)).toBe('ok');
    expect(checkRentalPeriod('2026-06-01', '2026-07-01', today)).toBe('too_long');
    expect(checkRentalPeriod('2026-06-05', '2026-06-04', today)).toBe('order');
    expect(checkRentalPeriod('2026-05-31', '2026-06-02', today)).toBe('past');
    expect(checkRentalPeriod('2026-02-30', '2026-03-02', today)).toBe('invalid');
  });
});

describe('covoiturage', () => {
  it('lit un prix en unités mineures', () => {
    expect(parsePriceMinor('5')).toBe(500);
    expect(parsePriceMinor('5,50')).toBe(550);
    expect(parsePriceMinor('0')).toBe(0);
    expect(parsePriceMinor('-1')).toBeNull();
    expect(parsePriceMinor('5,555')).toBeNull();
    expect(parsePriceMinor('')).toBeNull();
  });
  it('propose les bonnes actions au passager', () => {
    expect(passengerActions({ role: 'viewer', status: 'open', myBookingStatus: null })).toEqual({ book: true, cancelBooking: false, rate: false });
    expect(passengerActions({ role: 'viewer', status: 'full', myBookingStatus: null }).book).toBe(false);
    expect(passengerActions({ role: 'passenger', status: 'full', myBookingStatus: 'accepted' }).cancelBooking).toBe(true);
    expect(passengerActions({ role: 'passenger', status: 'departed', myBookingStatus: 'accepted' }).cancelBooking).toBe(false);
    expect(passengerActions({ role: 'passenger', status: 'completed', myBookingStatus: 'completed' }).rate).toBe(true);
  });
  it('propose les bonnes actions au conducteur', () => {
    expect(driverActions('open')).toEqual({ depart: true, complete: false, cancel: true });
    expect(driverActions('departed')).toEqual({ depart: false, complete: true, cancel: false });
    expect(driverActions('completed')).toEqual({ depart: false, complete: false, cancel: false });
    expect(bookingDriverActions('requested', 'open')).toEqual({ accept: true, decline: true, cancel: false });
    expect(bookingDriverActions('requested', 'full').accept).toBe(false);
    expect(bookingDriverActions('accepted', 'full')).toEqual({ accept: false, decline: false, cancel: true });
    expect(bookingDriverActions('accepted', 'departed').cancel).toBe(false);
  });
});

describe('dépannage', () => {
  it('limite les actions selon le rôle et le statut', () => {
    expect(roadsideActions('requester', 'requested').cancel).toBe(true);
    expect(roadsideActions('requester', 'done').cancel).toBe(false);
    expect(roadsideActions('requester', 'accepted').onTheWay).toBe(false);
    expect(roadsideActions('provider', 'accepted')).toEqual({ cancel: false, onTheWay: true, done: true, release: true, consent: true });
    expect(roadsideActions('provider', 'requested').done).toBe(false);
  });
  it('lit une durée d’arrivée de 1 à 480 minutes', () => {
    expect(parseEta('15')).toBe(15);
    expect(parseEta('0')).toBeNull();
    expect(parseEta('481')).toBeNull();
    expect(parseEta('abc')).toBeNull();
  });
  it('compte les minutes restantes sans passer sous zéro', () => {
    const now = Date.parse('2026-06-01T10:00:00Z');
    expect(minutesLeft('2026-06-01T10:30:00Z', now)).toBe(30);
    expect(minutesLeft('2026-06-01T09:00:00Z', now)).toBe(0);
  });
});

describe('erreurs', () => {
  it('traduit la raison du serveur, dans le détail ou dans la validation', () => {
    expect(extraReasonKey(new ApiRequestError(409, 'conflict', 'x', { reason: 'not_enough_seats' }))).toBe('extra.error.not_enough_seats');
    expect(extraReasonKey(new ApiRequestError(400, 'validation_failed', 'x', [{ path: 'p', message: 'm', reason: 'price_too_high' }]))).toBe('extra.error.price_too_high');
    expect(extraReasonKey(new ApiRequestError(500, 'boom', 'x'))).toBeNull();
    expect(extraReasonKey(new Error('x'))).toBeNull();
  });
});

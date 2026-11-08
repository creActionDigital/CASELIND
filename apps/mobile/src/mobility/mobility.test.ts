import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { isRideTaken, startCodeFailure } from './errors';
import {
  canDo,
  canGoOnline,
  checkRideSchedule,
  createDriverLocationPump,
  DRIVER_LOCATION_INTERVAL_MS,
  fareLine,
  formatFareRange,
  formatStartCode,
  isCompleteStartCode,
  isDriverLocationStop,
  parsePoint,
  rideActions,
} from './logic';
import { rideTarget } from './routing';

describe('fourchette de prix', () => {
  it('affiche min et max, une seule valeur si égales, ordre corrigé', () => {
    const range = formatFareRange(300, 400, 'USD', 'fr');
    expect(range).toContain('–');
    expect(range.indexOf('3')).toBeLessThan(range.indexOf('4'));
    expect(formatFareRange(400, 300, 'USD', 'fr')).toBe(range);
    expect(formatFareRange(300, 300, 'USD', 'fr')).not.toContain('–');
  });
  it('montre le prix final une fois la course terminée, sinon la fourchette', () => {
    const fare = { estimated: true as const, currency: 'USD', fareMinor: 350, fareMin: 300, fareMax: 400 };
    expect(fareLine({ fare, finalFareMinor: null }, 'fr')).toEqual({ text: formatFareRange(300, 400, 'USD', 'fr'), final: false });
    expect(fareLine({ fare, finalFareMinor: 380 }, 'fr').final).toBe(true);
  });
});

describe('course programmée (30 min à 7 jours)', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);
  const at = (ms: number) => new Date(now + ms);
  it('refuse trop tôt, trop tard et invalide', () => {
    expect(checkRideSchedule(null, now)).toBe('invalid');
    expect(checkRideSchedule(new Date('x'), now)).toBe('invalid');
    expect(checkRideSchedule(at(29 * 60_000), now)).toBe('too_soon');
    expect(checkRideSchedule(at(-60_000), now)).toBe('too_soon');
    expect(checkRideSchedule(at(7 * 86_400_000 + 1000), now)).toBe('too_far');
  });
  it('accepte les bornes', () => {
    expect(checkRideSchedule(at(30 * 60_000), now)).toBe('ok');
    expect(checkRideSchedule(at(24 * 3600_000), now)).toBe('ok');
    expect(checkRideSchedule(at(7 * 86_400_000), now)).toBe('ok');
  });
});

describe('actions selon le statut et le rôle', () => {
  it('passager : annule jusqu\'au départ, alerte et partage pendant la course, évalue après', () => {
    expect(rideActions('requested', 'rider')).toEqual(['cancel']);
    expect(canDo('accepted', 'rider', 'cancel')).toBe(true);
    expect(canDo('in_progress', 'rider', 'cancel')).toBe(false);
    expect(canDo('in_progress', 'rider', 'alert')).toBe(true);
    expect(canDo('in_progress', 'rider', 'share')).toBe(true);
    expect(canDo('requested', 'rider', 'alert')).toBe(false);
    expect(canDo('completed', 'rider', 'rate')).toBe(true);
    expect(canDo('completed', 'rider', 'receipt')).toBe(true);
    expect(rideActions('cancelled_by_driver', 'rider')).toEqual([]);
    expect(rideActions('expired', 'rider')).toEqual([]);
  });
  it('chauffeur : arrivé, code, terminer, annulation avant le départ seulement', () => {
    expect(canDo('accepted', 'driver', 'arrived')).toBe(true);
    expect(canDo('accepted', 'driver', 'start')).toBe(false);
    expect(canDo('driver_arriving', 'driver', 'start')).toBe(true);
    expect(canDo('driver_arriving', 'driver', 'cancel')).toBe(true);
    expect(canDo('in_progress', 'driver', 'complete')).toBe(true);
    expect(canDo('in_progress', 'driver', 'cancel')).toBe(false);
    expect(canDo('completed', 'driver', 'rate')).toBe(true);
    expect(canDo('completed', 'driver', 'share')).toBe(false);
    expect(canDo('requested', 'driver', 'arrived')).toBe(false);
  });
  it('code de départ à 4 chiffres et statut du chauffeur', () => {
    expect(isCompleteStartCode('4827')).toBe(true);
    expect(isCompleteStartCode('482')).toBe(false);
    expect(isCompleteStartCode('48271')).toBe(false);
    expect(isCompleteStartCode('48a7')).toBe(false);
    expect(formatStartCode('4827')).toBe('4 8 2 7');
    expect(canGoOnline('approved')).toBe(true);
    expect(canGoOnline('pending')).toBe(false);
    expect(canGoOnline('suspended')).toBe(false);
  });
});

describe('lieu saisi', () => {
  it('accepte la virgule décimale et arrondit, refuse hors plage ou sans nom', () => {
    expect(parsePoint(' Gare ', '-1,6585', '29,2205')).toEqual({ label: 'Gare', lat: -1.6585, lng: 29.2205 });
    expect(parsePoint('', '0', '0')).toBeNull();
    expect(parsePoint('X', '91', '0')).toBeNull();
    expect(parsePoint('X', '0', 'abc')).toBeNull();
  });
});

describe('minuterie de position du chauffeur', () => {
  function harness() {
    const calls: (() => void)[] = [];
    const sent: { lat: number; lng: number }[] = [];
    const cleared: unknown[] = [];
    const intervals: number[] = [];
    const pump = createDriverLocationPump({
      getPosition: async () => ({ lat: 1, lng: 2 }),
      send: async (p) => void sent.push(p),
      setTimer: (fn, ms) => {
        calls.push(fn);
        intervals.push(ms);
        return calls.length;
      },
      clearTimer: (h) => void cleared.push(h),
    });
    return { pump, calls, sent, cleared, intervals };
  }
  it('envoie tout de suite puis toutes les 20 s, et s\'arrête hors ligne', async () => {
    const h = harness();
    h.pump.start();
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(h.intervals).toEqual([DRIVER_LOCATION_INTERVAL_MS]);
    expect(DRIVER_LOCATION_INTERVAL_MS).toBe(20_000);
    h.calls[0]!();
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    h.pump.stop();
    expect(h.cleared).toEqual([1]);
    h.calls[0]!();
    await new Promise((r) => setTimeout(r, 5));
    expect(h.sent).toHaveLength(2);
  });
  it('s\'arrête quand le serveur refuse la position', () => {
    expect(isDriverLocationStop(403, 'driver_offline')).toBe(true);
    expect(isDriverLocationStop(403, 'kyc_required')).toBe(true);
    expect(isDriverLocationStop(403, 'driver_not_approved')).toBe(true);
    expect(isDriverLocationStop(500, 'driver_offline')).toBe(false);
    expect(isDriverLocationStop(403, 'other')).toBe(false);
  });
});

describe('erreurs et routage', () => {
  it('reconnaît un code faux, un code verrouillé et une course prise par un autre', () => {
    expect(startCodeFailure(new ApiRequestError(403, 'forbidden', 'x', { reason: 'invalid_start_code', remainingAttempts: 3 }))).toEqual({ kind: 'invalid', remaining: 3 });
    expect(startCodeFailure(new ApiRequestError(429, 'rate_limited', 'x', { reason: 'code_locked' }))).toEqual({ kind: 'locked' });
    expect(startCodeFailure(new ApiRequestError(500, 'internal_error', 'x'))).toBeNull();
    expect(isRideTaken(new ApiRequestError(409, 'conflict', 'x', { reason: 'ride_unavailable' }))).toBe(true);
    expect(isRideTaken(new ApiRequestError(409, 'conflict', 'x', { reason: 'driver_busy' }))).toBe(false);
  });
  it('ouvre l\'écran de course depuis une notification', () => {
    expect(rideTarget({ rideId: 'abc' })).toEqual({ pathname: '/rides/[rideId]', params: { rideId: 'abc' } });
    expect(rideTarget({ rideId: '' })).toBeNull();
    expect(rideTarget({ orderId: 'x' })).toBeNull();
    expect(rideTarget(null)).toBeNull();
  });
});

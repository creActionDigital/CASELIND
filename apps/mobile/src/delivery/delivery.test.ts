import type { CartGroup, DeliveryZone } from '@caselind/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { isLocationStop, proofFailure, zoneRefusal } from './errors';
import {
  addressRequired,
  canShareLocation,
  courierActions,
  createLocationPump,
  distanceKm,
  feeFor,
  plannedTotals,
  stepStates,
  totalsByCurrencyWithFees,
  usableZones,
  zoneChoices,
  zoneCovers,
} from './logic';
import { deliveryTarget } from './routing';
import { canAssignCourier, courierCandidates, isCourier } from './seller-logic';
import { emptyZoneDraft, parseFee, toZoneRequest, validateZone } from './zone-form';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const zone = (o: Partial<DeliveryZone> = {}): DeliveryZone => ({
  id: ID(1), orgId: ID(9), name: 'Centre', areas: ['Goma', 'Himbi'], fees: { USD: 300, CDF: 5000 }, etaMinutes: 45, active: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
});
const group = (orgId: string, currency: string, subtotalMinor: number): CartGroup => ({ orgId, orgName: 'S', orgSlug: 's', currency, subtotalMinor, lines: [] });

describe('totaux avec frais', () => {
  const groups = [group('a', 'USD', 1000), group('b', 'USD', 500), group('c', 'CDF', 20000)];
  it('ajoute les frais de la zone choisie, 0 en retrait ou sans zone', () => {
    expect(feeFor({ fulfillment: 'delivery', zone: zone() }, 'USD')).toBe(300);
    expect(feeFor({ fulfillment: 'pickup', zone: zone() }, 'USD')).toBe(0);
    expect(feeFor({ fulfillment: 'delivery', zone: null }, 'USD')).toBe(0);
    expect(feeFor({ fulfillment: 'delivery', zone: zone({ fees: { CDF: 1 } }) }, 'USD')).toBe(0);
    const p = plannedTotals(groups, { a: { fulfillment: 'delivery', zone: zone() }, c: { fulfillment: 'delivery', zone: zone() } });
    expect(p.map((x) => x.totalMinor)).toEqual([1300, 500, 25000]);
    expect(totalsByCurrencyWithFees(p)).toEqual([{ currency: 'USD', totalMinor: 1800 }, { currency: 'CDF', totalMinor: 25000 }]);
  });
  it('le retrait retire les frais et l’obligation d’adresse', () => {
    const plans = Object.fromEntries(groups.map((g) => [g.orgId, { fulfillment: 'pickup' as const, zone: zone() }]));
    expect(totalsByCurrencyWithFees(plannedTotals(groups, plans))).toEqual([{ currency: 'USD', totalMinor: 1500 }, { currency: 'CDF', totalMinor: 20000 }]);
    expect(addressRequired(groups, { a: 'pickup', b: 'pickup', c: 'pickup' })).toBe(false);
    expect(addressRequired(groups, {})).toBe(true);
  });
  it('exige une zone seulement en livraison pour une boutique qui en a', () => {
    const modes = { a: 'delivery', b: 'delivery', c: 'pickup' } as const;
    const r = zoneChoices(groups, modes, { a: 2, b: 0, c: 3 }, { a: ID(1) });
    expect(r.choices).toEqual([{ orgId: 'a', zoneId: ID(1) }]);
    expect(r.missing).toEqual([]);
    expect(zoneChoices(groups, modes, { a: 2, b: 1 }, {}).missing).toEqual(['a', 'b']);
  });
  it('propose les zones tarifées dans la devise, celles qui couvrent l’adresse d’abord', () => {
    const far = zone({ id: ID(2), name: 'Loin', areas: ['Sake'] });
    const off = zone({ id: ID(3), active: false });
    const cdfOnly = zone({ id: ID(4), fees: { CDF: 1 } });
    expect(usableZones([far, zone(), off, cdfOnly], 'USD', 'GOMA', '').map((z) => z.name)).toEqual(['Centre', 'Loin']);
    expect(zoneCovers(zone(), 'goma', '')).toBe(true);
    expect(zoneCovers(zone(), 'Kigali', 'Himbi')).toBe(true);
    expect(zoneCovers(zone(), 'Kigali', '')).toBe(false);
  });
  it('valide et convertit une zone de vendeur', () => {
    const d = { ...emptyZoneDraft(), name: 'Centre', areas: 'Goma, Himbi, goma', eta: '45' };
    expect(validateZone(d).fees).toBe('invalid');
    const ok = { ...d, fees: { USD: '3', CDF: '0' } };
    expect(validateZone(ok)).toEqual({});
    expect(toZoneRequest(ok)).toMatchObject({ areas: ['Goma', 'Himbi', 'goma'], fees: { USD: 300, CDF: 0 }, etaMinutes: 45 });
    expect(parseFee('0', 'USD')).toBe(0);
    expect(parseFee('abc', 'USD')).toBeNull();
    expect(validateZone({ ...ok, eta: '2' }).eta).toBe('invalid');
  });
});

describe('transitions permises au livreur', () => {
  it('suit les statuts de l’API', () => {
    expect(courierActions('pending')).toEqual([]);
    expect(courierActions('assigned')).toEqual(['picked_up', 'failed']);
    expect(courierActions('picked_up')).toEqual(['in_transit', 'failed']);
    expect(courierActions('in_transit')).toEqual(['delivered', 'failed']);
    expect(courierActions('delivered')).toEqual([]);
    expect(courierActions('failed')).toEqual(['returned']);
  });
  it('la position ne se partage qu’en route', () => {
    expect(canShareLocation('in_transit')).toBe(true);
    for (const s of ['pending', 'assigned', 'picked_up', 'delivered', 'failed', 'returned'] as const) expect(canShareLocation(s)).toBe(false);
  });
  it('frise acheteur', () => {
    expect(stepStates('in_transit').map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'todo']);
    expect(stepStates('delivered').every((s) => s.state === 'done')).toBe(true);
    expect(stepStates('failed').every((s) => s.state === 'todo')).toBe(true);
  });
  it('affectation réservée avant le retrait, candidats = rôle delivery + soi-même', () => {
    expect(canAssignCourier('pending') && canAssignCourier('assigned')).toBe(true);
    expect(canAssignCourier('picked_up')).toBe(false);
    const m = (userId: string, role: string, status = 'active') => ({ userId, role, status, displayName: userId }) as never;
    const c = courierCandidates([m('x', 'delivery'), m('y', 'sales'), m('z', 'delivery', 'invited'), m('me', 'delivery')], { id: 'me', displayName: 'Moi' });
    expect(c.map((x) => x.userId)).toEqual(['me', 'x']);
    expect(isCourier([{ role: 'delivery', status: 'active' }])).toBe(true);
    expect(isCourier([{ role: 'delivery', status: 'invited' }, { role: 'owner', status: 'active' }])).toBe(false);
  });
  it('reconnaît les erreurs de code, de zone et de position', () => {
    expect(proofFailure(new ApiRequestError(403, 'forbidden', 'x', { reason: 'invalid_proof_code', remainingAttempts: 3 }))).toEqual({ kind: 'invalid', remaining: 3 });
    expect(proofFailure(new ApiRequestError(429, 'rate_limited', 'x', { reason: 'proof_locked' }))).toEqual({ kind: 'locked' });
    expect(proofFailure(new ApiRequestError(403, 'forbidden', 'x'))).toBeNull();
    expect(zoneRefusal(new ApiRequestError(400, 'validation_failed', 'x', [{ reason: 'zone_not_covered', orgId: 'o' }]))).toEqual({ reason: 'zone_not_covered', orgId: 'o' });
    expect(isLocationStop(new ApiRequestError(409, 'conflict', 'x', { reason: 'not_in_transit' }))).toBe(true);
    expect(isLocationStop(new ApiRequestError(500, 'internal_error', 'x'))).toBe(false);
  });
  it('route des notifications', () => {
    expect(deliveryTarget({ deliveryId: 'd', orderId: 'o' })).toEqual({ pathname: '/deliveries/[deliveryId]', params: { deliveryId: 'd', orderId: 'o' } });
    expect(deliveryTarget({ orgId: 'g', deliveryId: 'd' })).toBeNull();
    expect(deliveryTarget({})).toBeNull();
  });
  it('distance à vol d’oiseau', () => {
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    expect(distanceKm({ lat: -1.6585, lng: 29.2205 }, { lat: -1.6585, lng: 29.3205 })).toBeGreaterThan(10);
  });
});

describe('minuterie d’envoi de position', () => {
  function setup(opts: { send?: () => Promise<void>; position?: { lat: number; lng: number } | null } = {}) {
    let tick: (() => void) | null = null;
    let cleared = 0;
    const send = vi.fn(opts.send ?? (async () => undefined));
    const onStop = vi.fn();
    const pump = createLocationPump({
      getPosition: async () => (opts.position === undefined ? { lat: 1, lng: 2 } : opts.position),
      send,
      shouldStop: (e) => e === 'stop',
      onStop,
      setTimer: (fn, ms) => {
        expect(ms).toBe(30_000);
        tick = fn;
        return 1;
      },
      clearTimer: () => {
        cleared++;
        tick = null;
      },
    });
    return { pump, send, onStop, fire: async () => { tick?.(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }, cleared: () => cleared, armed: () => tick !== null };
  }
  it('envoie dès le démarrage puis à chaque échéance, et s’arrête sur demande', async () => {
    const s = setup();
    s.pump.start();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send).toHaveBeenCalledWith({ lat: 1, lng: 2 });
    await s.fire();
    expect(s.send).toHaveBeenCalledTimes(2);
    s.pump.stop();
    expect(s.armed()).toBe(false);
    expect(s.cleared()).toBe(1);
    expect(s.pump.isRunning()).toBe(false);
  });
  it('ne démarre qu’une fois et n’envoie rien sans position', async () => {
    const s = setup({ position: null });
    s.pump.start();
    s.pump.start();
    await s.fire();
    expect(s.send).not.toHaveBeenCalled();
    expect(s.pump.isRunning()).toBe(true);
  });
  it('s’arrête quand le serveur refuse définitivement, pas sur une erreur passagère', async () => {
    const s = setup({ send: () => Promise.reject('network') });
    s.pump.start();
    await s.fire();
    expect(s.pump.isRunning()).toBe(true);
    s.pump.stop();
    const t = setup({ send: () => Promise.reject('stop') });
    t.pump.start();
    await t.fire();
    expect(t.pump.isRunning()).toBe(false);
    expect(t.onStop).toHaveBeenCalledTimes(1);
  });
  it('ne lance pas deux envois en parallèle', async () => {
    let release: () => void = () => undefined;
    const s = setup({ send: () => new Promise<void>((r) => { release = r; }) });
    s.pump.start();
    await s.fire();
    await s.fire();
    expect(s.send).toHaveBeenCalledTimes(1);
    release();
    await s.fire();
    await s.fire();
    expect(s.send.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

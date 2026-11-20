import type { CartGroup, DeliveryZone } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { expressSupplement, feeFor } from '../delivery/logic';
import { checkSlot, expressOffered } from '../delivery/schedule-logic';
import { emptyZoneDraft, toZoneRequest, validateZone, zoneToDraft } from '../delivery/zone-form';
import { isCourierRequestTaken } from './errors';
import { courierActions, formatCourierCode, isCompleteCourierCode, isRequestReady, planIds } from './logic';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const zone = (o: Partial<DeliveryZone> = {}): DeliveryZone => ({
  id: ID(1), orgId: ID(9), name: 'Centre', areas: ['Goma'], fees: { USD: 300 }, expressFees: { USD: 150 }, etaMinutes: 45, active: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
});
const group = (orgId: string): CartGroup => ({ orgId, orgName: 'S', orgSlug: 's', currency: 'USD', subtotalMinor: 1000, lines: [] });

describe('créneau programmé', () => {
  const now = new Date(2026, 5, 1, 10, 0).getTime();
  it('accepte entre 2 heures et 7 jours, avec le format AAAA-MM-JJ HH:MM', () => {
    expect(checkSlot('2026-06-01 13:00', now)).toEqual({ ok: true, iso: new Date(2026, 5, 1, 13, 0).toISOString() });
    expect(checkSlot('2026-06-05 09:30', now).ok).toBe(true);
  });
  it('refuse trop proche, trop loin et format invalide', () => {
    expect(checkSlot('2026-06-01 11:00', now)).toEqual({ ok: false, reason: 'too_soon' });
    expect(checkSlot('2026-06-01 12:01', now)).toEqual({ ok: false, reason: 'too_soon' });
    expect(checkSlot('2026-06-09 10:00', now)).toEqual({ ok: false, reason: 'too_far' });
    expect(checkSlot('demain 10h', now)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkSlot('2026-02-31 10:00', now)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('express', () => {
  it('lit le supplément de la zone par devise et l’ajoute aux frais', () => {
    expect(expressSupplement(zone(), 'USD')).toBe(150);
    expect(expressSupplement(zone(), 'CDF')).toBeNull();
    expect(expressSupplement(zone({ expressFees: null }), 'USD')).toBeNull();
    expect(feeFor({ fulfillment: 'delivery', zone: zone() }, 'USD')).toBe(300);
    expect(feeFor({ fulfillment: 'delivery', zone: zone(), speed: 'express' }, 'USD')).toBe(450);
    expect(feeFor({ fulfillment: 'pickup', zone: zone(), speed: 'express' }, 'USD')).toBe(0);
  });
  it('n’est proposé que si chaque boutique a une zone choisie avec supplément', () => {
    const g = [group(ID(9))];
    expect(expressOffered(g, { [ID(9)]: [zone()] }, { [ID(9)]: ID(1) })).toBe(true);
    expect(expressOffered(g, { [ID(9)]: [zone()] }, {})).toBe(false);
    expect(expressOffered(g, { [ID(9)]: [zone({ expressFees: null })] }, { [ID(9)]: ID(1) })).toBe(false);
    expect(expressOffered(g, {}, {})).toBe(false);
    expect(expressOffered([], {}, {})).toBe(false);
  });
  it('le formulaire de zone envoie null sans supplément, et refuse un montant invalide', () => {
    const d = emptyZoneDraft();
    d.name = 'Z';
    d.areas = 'Goma';
    d.fees.USD = '3';
    expect(validateZone(d)).toEqual({});
    expect(toZoneRequest(d).expressFees).toBeNull();
    d.expressFees.USD = '1.5';
    expect(toZoneRequest(d).expressFees).toEqual({ USD: 150 });
    d.expressFees.USD = 'abc';
    expect(validateZone(d).expressFees).toBe('invalid');
    expect(zoneToDraft(zone()).expressFees.USD).toBe('1.50');
  });
});

describe('coursier à la demande', () => {
  it('actions par statut et rôle', () => {
    expect(courierActions('requested', 'requester', false)).toEqual(['cancel']);
    expect(courierActions('picked_up', 'requester', false)).toEqual(['resetCode']);
    expect(courierActions('delivered', 'requester', false)).toEqual(['rate']);
    expect(courierActions('delivered', 'requester', true)).toEqual([]);
    expect(courierActions('accepted', 'courier', false)).toEqual(['pickedUp', 'shareLocation']);
    expect(courierActions('picked_up', 'courier', false)).toEqual(['delivered', 'shareLocation']);
    expect(courierActions('expired', 'courier', false)).toEqual([]);
  });
  it('code à 6 chiffres', () => {
    expect(isCompleteCourierCode('482913')).toBe(true);
    expect(isCompleteCourierCode('4829')).toBe(false);
    expect(formatCourierCode('482913')).toBe('482 913');
  });
  it('demande prête : deux points, et une taille pour un colis seulement', () => {
    const p = { lat: 0, lng: 0, label: 'x' };
    expect(isRequestReady({ kind: 'parcel', size: 'small', pickup: p, dropoff: p })).toBe(true);
    expect(isRequestReady({ kind: 'parcel', size: null, pickup: p, dropoff: p })).toBe(false);
    expect(isRequestReady({ kind: 'document', size: null, pickup: p, dropoff: null })).toBe(false);
    expect(isRequestReady({ kind: 'document', size: null, pickup: p, dropoff: p })).toBe(true);
  });
  it('éléments de tournée : demandes en cours puis livraisons, 20 au plus', () => {
    expect(planIds([{ id: 'a', status: 'accepted' }, { id: 'b', status: 'delivered' }, { id: 'c', status: 'picked_up' }], ['d'])).toEqual(['a', 'c', 'd']);
    expect(planIds([], Array.from({ length: 30 }, (_, i) => String(i)))).toHaveLength(20);
  });
  it('reconnaît une demande prise par un autre coursier', () => {
    expect(isCourierRequestTaken(new ApiRequestError(409, 'conflict', 'x', { reason: 'request_unavailable' }))).toBe(true);
    expect(isCourierRequestTaken(new ApiRequestError(409, 'conflict', 'x', { reason: 'courier_busy' }))).toBe(false);
  });
});

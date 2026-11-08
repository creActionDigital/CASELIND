import { describe, expect, it } from 'vitest';
import {
  bookingTarget,
  canReview,
  clientActions,
  clientCancel,
  emptyOfferDraft,
  formatOffset,
  groupSlotsByDay,
  hasAvailabilityErrors,
  hasOfferErrors,
  localDay,
  parseSkills,
  providerActions,
  slotsWindow,
  toAvailabilityBody,
  toOfferBody,
  validateAvailability,
  validateOffer,
  type BookingLike,
  type OfferDraft,
} from './logic';

const slot = (iso: string) => ({ startsAt: iso, endsAt: iso });

describe('groupSlotsByDay', () => {
  it('groups by the provider local day, not the UTC day', () => {
    // 22:30Z + 2 h = 00:30 le lendemain chez le prestataire (Goma).
    const days = groupSlotsByDay([slot('2026-11-10T22:30:00.000Z'), slot('2026-11-10T08:00:00.000Z'), slot('2026-11-11T07:00:00.000Z')], 120);
    expect(days.map((d) => d.day)).toEqual(['2026-11-10', '2026-11-11']);
    expect(days[0].slots.map((s) => s.time)).toEqual(['10:00']);
    expect(days[1].slots.map((s) => s.time)).toEqual(['00:30', '09:00']);
  });
  it('handles negative offsets and sorts unordered input', () => {
    const days = groupSlotsByDay([slot('2026-11-11T01:00:00.000Z'), slot('2026-11-10T20:00:00.000Z')], -180);
    expect(days.map((d) => d.day)).toEqual(['2026-11-10', '2026-11-10'].slice(0, 1));
    expect(days[0].slots.map((s) => s.time)).toEqual(['17:00', '22:00']);
  });
  it('drops duplicates and invalid dates, and returns [] for no slots', () => {
    expect(groupSlotsByDay([], 0)).toEqual([]);
    const s = slot('2026-11-10T08:00:00.000Z');
    expect(groupSlotsByDay([s, s, slot('nope')], 0)[0].slots).toHaveLength(1);
  });
  it('computes local day across the date line of a fixed offset', () => {
    expect(localDay('2026-12-31T23:30:00.000Z', 120)).toBe('2027-01-01');
    expect(localDay('2026-01-01T00:30:00.000Z', -60)).toBe('2025-12-31');
  });
});

describe('slotsWindow and formatOffset', () => {
  it('never exceeds 14 days', () => {
    const now = new Date('2026-11-10T10:00:00.000Z');
    const { from, to } = slotsWindow(now, 30);
    expect(Date.parse(to) - Date.parse(from)).toBeLessThanOrEqual(14 * 24 * 3_600_000);
    expect(from).toBe(now.toISOString());
  });
  it('formats offsets', () => {
    expect(formatOffset(120)).toBe('+2');
    expect(formatOffset(-210)).toBe('-3:30');
    expect(formatOffset(0)).toBe('+0');
  });
});

const booking = (over: Partial<BookingLike> = {}): BookingLike => ({
  status: 'confirmed',
  startsAt: '2026-11-10T10:00:00.000Z',
  cancelNoticeHours: 24,
  priceKind: 'fixed',
  quoteStatus: 'none',
  ...over,
});

describe('cancellation rule', () => {
  it('allows the client up to the notice deadline, inclusive', () => {
    expect(clientCancel(booking(), new Date('2026-11-09T09:59:00.000Z')).ok).toBe(true);
    expect(clientCancel(booking(), new Date('2026-11-09T10:00:00.000Z')).ok).toBe(true);
  });
  it('refuses after the deadline with a window reason', () => {
    const r = clientCancel(booking(), new Date('2026-11-09T10:00:01.000Z'));
    expect(r).toMatchObject({ ok: false, reason: 'window' });
  });
  it('refuses a finished booking regardless of time', () => {
    for (const status of ['completed', 'cancelled', 'declined', 'no_show'] as const) {
      expect(clientCancel(booking({ status }), new Date('2026-01-01T00:00:00.000Z'))).toMatchObject({ ok: false, reason: 'status' });
    }
  });
  it('a zero notice allows cancelling until the start', () => {
    const b = booking({ cancelNoticeHours: 0, status: 'requested' });
    expect(clientCancel(b, new Date('2026-11-10T09:59:00.000Z')).ok).toBe(true);
    expect(clientCancel(b, new Date('2026-11-10T10:01:00.000Z')).ok).toBe(false);
  });
});

describe('client and provider actions', () => {
  const now = new Date('2026-11-09T00:00:00.000Z');
  it('lets the client answer a proposed quote only while requested', () => {
    const q = booking({ status: 'requested', priceKind: 'quote', quoteStatus: 'proposed' });
    expect(clientActions(q, now)).toMatchObject({ acceptQuote: true, declineQuote: true });
    expect(clientActions(booking({ status: 'confirmed', priceKind: 'quote', quoteStatus: 'accepted' }), now).acceptQuote).toBe(false);
    expect(clientActions(booking({ status: 'requested', priceKind: 'quote', quoteStatus: 'none' }), now).acceptQuote).toBe(false);
  });
  it('only offers a review once, after completion', () => {
    expect(canReview({ ...booking({ status: 'completed' }), reviewId: null })).toBe(true);
    expect(canReview({ ...booking({ status: 'completed' }), reviewId: 'r' })).toBe(false);
    expect(canReview({ ...booking({ status: 'confirmed' }), reviewId: null })).toBe(false);
  });
  it('a fixed-price request can be confirmed at once', () => {
    expect(providerActions(booking({ status: 'requested' }), now)).toMatchObject({ confirm: true, decline: true, proposeQuote: false, complete: false });
  });
  it('a quote request needs an accepted quote before confirming', () => {
    const base = booking({ status: 'requested', priceKind: 'quote' });
    expect(providerActions({ ...base, quoteStatus: 'none' }, now)).toMatchObject({ confirm: false, proposeQuote: true, needsQuote: true });
    expect(providerActions({ ...base, quoteStatus: 'proposed' }, now)).toMatchObject({ confirm: false, waitingQuote: true });
    expect(providerActions({ ...base, quoteStatus: 'accepted' }, now)).toMatchObject({ confirm: true, proposeQuote: false });
  });
  it('complete and no-show only after the start', () => {
    expect(providerActions(booking(), new Date('2026-11-10T09:00:00.000Z'))).toMatchObject({ complete: false, noShow: false, waitingStart: true, cancel: true });
    expect(providerActions(booking(), new Date('2026-11-10T10:00:00.000Z'))).toMatchObject({ complete: true, noShow: true, waitingStart: false });
    expect(providerActions(booking({ status: 'cancelled' }), now)).toMatchObject({ cancel: false, confirm: false });
  });
});

const valid = (over: Partial<OfferDraft> = {}): OfferDraft => ({
  ...emptyOfferDraft(120),
  title: 'Plomberie à domicile',
  categoryId: 'c1',
  price: '25',
  lat: '-1,6585',
  lng: '29.2205',
  ...over,
});

describe('offer editor validation', () => {
  it('accepts a complete fixed-price offer and builds the body', () => {
    expect(hasOfferErrors(validateOffer(valid(), { needsPosition: true }))).toBe(false);
    const body = toOfferBody(valid(), 'published', { needsPosition: true });
    expect(body).toMatchObject({ priceKind: 'fixed', priceMinor: 2500, currency: 'USD', durationMin: 60, lat: -1.6585, lng: 29.2205, status: 'published', utcOffsetMinutes: 120 });
  });
  it('requires price for fixed but not for quote', () => {
    expect(validateOffer(valid({ price: '' }), { needsPosition: true }).price).toBeDefined();
    expect(validateOffer(valid({ price: '0' }), { needsPosition: true }).price).toBeDefined();
    const quote = valid({ priceKind: 'quote', price: '' });
    expect(hasOfferErrors(validateOffer(quote, { needsPosition: true }))).toBe(false);
    const body = toOfferBody(quote, 'draft', { needsPosition: true })!;
    expect(body).not.toHaveProperty('priceMinor');
    expect(toOfferBody(quote, undefined, { needsPosition: true, update: true })).toMatchObject({ priceMinor: null, currency: null });
  });
  it('enforces numeric ranges', () => {
    const e = validateOffer(valid({ duration: '10', cancelNoticeHours: '721', radiusKm: '0' }), { needsPosition: true });
    expect(Object.keys(e).sort()).toEqual(['cancelNoticeHours', 'duration', 'radiusKm']);
    expect(validateOffer(valid({ duration: '720', cancelNoticeHours: '0', radiusKm: '100' }), { needsPosition: true })).toEqual({});
  });
  it('needs a position for individuals, optional for organisations, never half-filled', () => {
    expect(validateOffer(valid({ lat: '', lng: '' }), { needsPosition: true }).position).toBeDefined();
    const org = validateOffer(valid({ lat: '', lng: '' }), { needsPosition: false });
    expect(org.position).toBeUndefined();
    expect(toOfferBody(valid({ lat: '', lng: '' }), 'draft', { needsPosition: false })).not.toHaveProperty('lat');
    expect(validateOffer(valid({ lng: '' }), { needsPosition: false }).position).toBeDefined();
    expect(validateOffer(valid({ lat: '91' }), { needsPosition: true }).position).toBeDefined();
  });
  it('rejects urgent / garanti wording without the matching option', () => {
    expect(validateOffer(valid({ title: 'Dépannage urgent' }), { needsPosition: true }).title).toBe('services.pro.offer.err.urgentWord');
    expect(validateOffer(valid({ title: 'Dépannage urgent', urgentAvailable: true }), { needsPosition: true }).title).toBeUndefined();
    expect(validateOffer(valid({ description: 'Travail garanti' }), { needsPosition: true }).title).toBeDefined();
    expect(validateOffer(valid({ description: 'Travail garanti', guaranteeNote: '6 mois' }), { needsPosition: true }).title).toBeUndefined();
  });
  it('limits text lengths and requires a category', () => {
    const e = validateOffer(valid({ title: 'x'.repeat(141), categoryId: null, guaranteeNote: 'y'.repeat(201), description: 'z'.repeat(2001) }), { needsPosition: true });
    expect(Object.keys(e).sort()).toEqual(['categoryId', 'description', 'guaranteeNote', 'title']);
  });
  it('refuses to build a body from an invalid draft', () => {
    expect(toOfferBody(valid({ title: ' ' }), 'draft', { needsPosition: true })).toBeNull();
  });
});

describe('availability validation', () => {
  const r = (key: string, weekday: number, start: string, end: string) => ({ key, weekday, start, end });
  const x = (key: string, date: string, closed: boolean, start = '', end = '') => ({ key, date, closed, start, end });
  it('accepts a normal week and sorts the body', () => {
    const rules = [r('b', 3, '14:00', '18:00'), r('a', 1, '08:00', '12:00'), r('c', 1, '13:00', '17:00')];
    expect(hasAvailabilityErrors(validateAvailability(rules, []))).toBe(false);
    expect(toAvailabilityBody(rules, []).rules.map((v) => `${v.weekday}${v.start}`)).toEqual(['108:00', '113:00', '314:00']);
  });
  it('flags bad times, reversed windows and overlaps on the same weekday', () => {
    const e = validateAvailability([r('a', 1, '25:00', '26:00'), r('b', 1, '12:00', '10:00'), r('c', 2, '08:00', '12:00'), r('d', 2, '11:00', '14:00')], []);
    expect(e.rules.a).toBeDefined();
    expect(e.rules.b).toBeDefined();
    expect(e.rules.c).toBe('services.pro.avail.err.overlap');
    expect(e.rules.d).toBe('services.pro.avail.err.overlap');
  });
  it('touching windows do not overlap', () => {
    expect(hasAvailabilityErrors(validateAvailability([r('a', 1, '08:00', '12:00'), r('b', 1, '12:00', '16:00')], []))).toBe(false);
  });
  it('validates exceptions: real dates, duplicates, open windows', () => {
    const e = validateAvailability([], [x('a', '2026-02-30', true), x('b', '2026-12-25', true), x('c', '2026-12-25', true), x('d', '2026-12-31', false, '09:00', '08:00')]);
    expect(e.exceptions.a).toBe('services.pro.avail.err.date');
    expect(e.exceptions.b).toBeUndefined();
    expect(e.exceptions.c).toBe('services.pro.avail.err.duplicate');
    expect(e.exceptions.d).toBe('services.pro.avail.err.time');
    const body = toAvailabilityBody([], [x('b', '2026-12-25', true), x('e', '2026-12-31', false, '09:00', '12:00')]);
    expect(body.exceptions).toEqual([{ date: '2026-12-25', closed: true }, { date: '2026-12-31', closed: false, start: '09:00', end: '12:00' }]);
  });
});

describe('small helpers', () => {
  it('parses skills', () => {
    expect(parseSkills(' Plomberie, électricité ,plomberie;;')).toEqual(['Plomberie', 'électricité']);
    expect(parseSkills('a,'.repeat(30)).length).toBe(1);
  });
  it('extracts a booking notification target', () => {
    expect(bookingTarget({ bookingId: 'abc' })).toEqual({ pathname: '/bookings/[id]', params: { id: 'abc' } });
    expect(bookingTarget({})).toBeNull();
    expect(bookingTarget(null)).toBeNull();
    expect(bookingTarget({ bookingId: 5 })).toBeNull();
  });
});

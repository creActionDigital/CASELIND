import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
  handle: string;
}
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}
let n = 0;
const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;

const GOMA = { lat: -1.6585, lng: 29.2205 };
const BUKAVU = { lat: -2.3, lng: 29.0 }; // about 75 km away

let categoryId: string;
let otherCategoryId: string;
beforeAll(async () => {
  const u = await user();
  const res = await ctx.http.get('/v1/service-categories').set(bearer(u.token)).expect(200);
  categoryId = res.body.items.find((c: { slug: string }) => c.slug === 'plomberie').id;
  otherCategoryId = res.body.items.find((c: { slug: string }) => c.slug === 'tutorat').id;
});

/** Every day 00:00-23:59 local (UTC): one-hour slots, always some in the next hours. */
const ALL_DAY = { rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '23:59' })), exceptions: [] };

async function individual(
  extra: Record<string, unknown> = {},
  opts: { availability?: boolean; point?: { lat: number; lng: number } } = {},
): Promise<{ provider: TU; offerId: string }> {
  const provider = await user();
  await ctx.http.put('/v1/me/service-profile').set(bearer(provider.token)).send({ displayName: 'Jean Plombier', skills: ['fuites'] }).expect(200);
  const res = await ctx.http
    .post('/v1/me/services')
    .set(bearer(provider.token))
    .send({
      title: uniq('Plomberie'),
      categoryId,
      priceKind: 'fixed',
      priceMinor: 2500,
      currency: 'USD',
      durationMin: 60,
      city: 'Goma',
      ...(opts.point ?? GOMA),
      status: 'published',
      ...extra,
    })
    .expect(201);
  if (opts.availability !== false) {
    await ctx.http.put(`/v1/me/services/${res.body.id}/availability`).set(bearer(provider.token)).send(ALL_DAY).expect(200);
  }
  return { provider, offerId: res.body.id };
}

const slotsOf = async (u: TU, offerId: string, fromMs: number, toMs: number): Promise<{ startsAt: string; endsAt: string }[]> =>
  (await ctx.http.get(`/v1/services/${offerId}/slots?from=${new Date(fromMs).toISOString()}&to=${new Date(toMs).toISOString()}`).set(bearer(u.token)).expect(200)).body.items;

const HOUR = 3_600_000;
const book = (u: TU, offerId: string, startsAt: string, note?: string) =>
  ctx.http.post(`/v1/services/${offerId}/bookings`).set(bearer(u.token)).send({ startsAt, ...(note ? { note } : {}) });
const act = (u: TU, id: string, action: string, body: object = {}) => ctx.http.post(`/v1/bookings/${id}/${action}`).set(bearer(u.token)).send(body);

describe('rights and content rules', () => {
  it('lists the 15 categories and refuses anonymous callers', async () => {
    const u = await user();
    const res = await ctx.http.get('/v1/service-categories').set(bearer(u.token)).expect(200);
    expect(res.body.items).toHaveLength(15);
    await ctx.http.get('/v1/service-categories').expect(401);
  });

  it('needs a provider profile; the owner alone edits an individual offer; "urgent"/"garanti" need their explicit field', async () => {
    const lone = await user();
    const base = { title: 'Réparation', categoryId, priceKind: 'fixed', priceMinor: 1000, currency: 'USD', durationMin: 30, city: 'Goma', ...GOMA };
    const noProfile = await ctx.http.post('/v1/me/services').set(bearer(lone.token)).send(base).expect(409);
    expect(noProfile.body.error.details.reason).toBe('profile_required');
    await ctx.http.get('/v1/me/service-profile').set(bearer(lone.token)).expect(404);

    const { provider, offerId } = await individual();
    const profile = await ctx.http.get('/v1/me/service-profile').set(bearer(provider.token)).expect(200);
    expect(profile.body).toMatchObject({ verified: false, verificationLabel: 'non vérifié' });
    const detail = await ctx.http.get(`/v1/services/${offerId}`).set(bearer(lone.token)).expect(200);
    expect(detail.body.provider).toMatchObject({ kind: 'individual', verified: false, verificationLabel: 'non vérifié' });
    expect(detail.body.paymentMode).toBe('on_site');
    expect(detail.body.urgentAvailable).toBe(false);

    await ctx.http.patch(`/v1/me/services/${offerId}`).set(bearer(lone.token)).send({ title: 'Piraté' }).expect(404);
    await ctx.http.get(`/v1/me/services/${offerId}`).set(bearer(lone.token)).expect(404);
    await ctx.http.patch(`/v1/me/services/${offerId}`).set(bearer(provider.token)).send({ title: 'Plombier urgent 24h' }).expect(400);
    await ctx.http.patch(`/v1/me/services/${offerId}`).set(bearer(provider.token)).send({ description: 'Travail garanti à vie' }).expect(400);
    const ok = await ctx.http
      .patch(`/v1/me/services/${offerId}`)
      .set(bearer(provider.token))
      .send({ title: 'Plombier urgent', urgentAvailable: true })
      .expect(200);
    expect(ok.body.urgentAvailable).toBe(true);
    const ok2 = await ctx.http
      .patch(`/v1/me/services/${offerId}`)
      .set(bearer(provider.token))
      .send({ description: 'Travail garanti 3 mois', guaranteeNote: '3 mois sur la main-d’oeuvre' })
      .expect(200);
    expect(ok2.body.guaranteeNote).toContain('3 mois');
    // price consistency
    await ctx.http.post('/v1/me/services').set(bearer(provider.token)).send({ ...base, priceMinor: undefined }).expect(400);
  });

  it('organisation offers: kind "services" and catalog.manage only', async () => {
    const owner = await user();
    const employee = await user();
    const stranger = await user();
    const shop = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: uniq('boutique'), name: 'Boutique', kind: 'shop' }).expect(201)).body;
    const org = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: uniq('depannage'), name: 'Dépannage Express', kind: 'services' }).expect(201)).body;
    await ctx.http.post(`/v1/orgs/${org.id}/invitations`).set(bearer(owner.token)).send({ handle: employee.handle, role: 'employee' }).expect(201);
    await ctx.http.post(`/v1/me/org-invitations/${org.id}/accept`).set(bearer(employee.token)).expect(200);
    const body = { title: 'Dépannage', categoryId, priceKind: 'quote', durationMin: 90, city: 'Goma', ...GOMA };

    const wrongKind = await ctx.http.post(`/v1/orgs/${shop.id}/services`).set(bearer(owner.token)).send(body).expect(409);
    expect(wrongKind.body.error.details.reason).toBe('org_not_services');
    await ctx.http.post(`/v1/orgs/${org.id}/services`).set(bearer(employee.token)).send(body).expect(403);
    await ctx.http.post(`/v1/orgs/${org.id}/services`).set(bearer(stranger.token)).send(body).expect(404);
    await ctx.http.post(`/v1/orgs/${org.id}/services`).send(body).expect(401);
    const created = await ctx.http.post(`/v1/orgs/${org.id}/services`).set(bearer(owner.token)).send({ ...body, status: 'published' }).expect(201);
    expect(created.body.provider).toMatchObject({ kind: 'org', orgId: org.id, verificationLabel: 'non vérifié' });
    await ctx.http.patch(`/v1/orgs/${org.id}/services/${created.body.id}`).set(bearer(employee.token)).send({ city: 'Bukavu' }).expect(403);
    await ctx.http.get(`/v1/orgs/${org.id}/services`).set(bearer(stranger.token)).expect(404);
    const patched = await ctx.http.patch(`/v1/orgs/${org.id}/services/${created.body.id}`).set(bearer(owner.token)).send({ city: 'Bukavu' }).expect(200);
    expect(patched.body.city).toBe('Bukavu');
    // an org offer is not editable through another org's route
    const other = (await ctx.http.post('/v1/orgs').set(bearer(stranger.token)).send({ slug: uniq('autre'), name: 'Autre', kind: 'services' }).expect(201)).body;
    await ctx.http.patch(`/v1/orgs/${other.id}/services/${created.body.id}`).set(bearer(stranger.token)).send({ city: 'X' }).expect(404);
    // bookings of the org: employee without catalog.manage can not act or list
    await ctx.http.get(`/v1/orgs/${org.id}/service-bookings`).set(bearer(employee.token)).expect(403);
    await ctx.http.get(`/v1/orgs/${org.id}/service-bookings`).set(bearer(owner.token)).expect(200);
  });
});

describe('slots and concurrent booking', () => {
  it('computes slots from weekly windows and exceptions', async () => {
    const { provider, offerId } = await individual({}, { availability: false });
    const client = await user();
    const now = Date.now();
    expect(await slotsOf(client, offerId, now, now + 3 * 24 * HOUR)).toEqual([]);

    // Weekly window 09:00-12:00 on every day: three one-hour slots per day.
    const rules = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '09:00', end: '12:00' }));
    const tomorrow = new Date(now + 24 * HOUR).toISOString().slice(0, 10);
    await ctx.http.put(`/v1/me/services/${offerId}/availability`).set(bearer(provider.token)).send({ rules, exceptions: [{ date: tomorrow, closed: true }] }).expect(200);
    const from = Date.parse(`${tomorrow}T00:00:00Z`);
    expect(await slotsOf(client, offerId, from, from + 24 * HOUR)).toEqual([]);
    const next = new Date(from + 24 * HOUR).toISOString().slice(0, 10);
    const day2 = await slotsOf(client, offerId, from + 24 * HOUR, from + 48 * HOUR);
    expect(day2.map((s) => s.startsAt)).toEqual([`${next}T09:00:00.000Z`, `${next}T10:00:00.000Z`, `${next}T11:00:00.000Z`]);

    // Exception with its own windows replaces the weekly ones.
    await ctx.http
      .put(`/v1/me/services/${offerId}/availability`)
      .set(bearer(provider.token))
      .send({ rules, exceptions: [{ date: next, closed: false, start: '14:00', end: '16:00' }] })
      .expect(200);
    const replaced = await slotsOf(client, offerId, from + 24 * HOUR, from + 48 * HOUR);
    expect(replaced.map((s) => s.startsAt)).toEqual([`${next}T14:00:00.000Z`, `${next}T15:00:00.000Z`]);

    await ctx.http.get(`/v1/services/${offerId}/slots?from=${new Date(now).toISOString()}&to=${new Date(now + 20 * 24 * HOUR).toISOString()}`).set(bearer(client.token)).expect(400);
    await ctx.http.put(`/v1/me/services/${offerId}/availability`).set(bearer(client.token)).send(ALL_DAY).expect(404);
    await ctx.http.put(`/v1/me/services/${offerId}/availability`).set(bearer(provider.token)).send({ rules: [{ weekday: 1, start: '10:00', end: '09:00' }] }).expect(400);
  });

  it('lets exactly one of two concurrent requests take the same slot', async () => {
    const { provider, offerId } = await individual();
    const a = await user();
    const b = await user();
    const now = Date.now();
    const slots = await slotsOf(a, offerId, now + 3 * HOUR, now + 2 * 24 * HOUR);
    const slot = slots[0]!;
    const results = await Promise.all([book(a, offerId, slot.startsAt, 'Fuite sous évier'), book(b, offerId, slot.startsAt)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.details.reason).toBe('slot_taken');
    const winner = results.find((r) => r.status === 201)!;
    expect(winner.body).toMatchObject({ status: 'requested', paymentMode: 'on_site', amountMinor: 2500, currency: 'USD', quoteStatus: 'none' });
    expect(winner.body.events).toHaveLength(1);

    // The slot disappears; a half-overlapping start is not a slot; the booked slot stays taken.
    const after = await slotsOf(a, offerId, now + 3 * HOUR, now + 2 * 24 * HOUR);
    expect(after.map((s) => s.startsAt)).not.toContain(slot.startsAt);
    const half = new Date(Date.parse(slot.startsAt) + 30 * 60_000).toISOString();
    expect((await book(b, offerId, half).expect(409)).body.error.details.reason).toBe('slot_taken');
    const past = new Date(now - 2 * HOUR).toISOString();
    await book(b, offerId, past).expect(400);
    // The provider can not book their own offer.
    expect((await book(provider, offerId, after[0]!.startsAt).expect(403)).body.error.details.reason).toBe('own_service');
    // A cancelled booking frees the slot again.
    await act(provider, winner.body.id, 'cancel').expect(200);
    const freed = await slotsOf(a, offerId, now + 3 * HOUR, now + 2 * 24 * HOUR);
    expect(freed.map((s) => s.startsAt)).toContain(slot.startsAt);
    await book(b, offerId, slot.startsAt).expect(201);
  });

  it('notifies the provider with a text free of personal details, and keeps parties apart', async () => {
    const { provider, offerId } = await individual();
    const client = await user();
    const stranger = await user();
    const slot = (await slotsOf(client, offerId, Date.now() + 3 * HOUR, Date.now() + 2 * 24 * HOUR))[0]!;
    const created = await book(client, offerId, slot.startsAt, 'Mon numéro est 0990000000').expect(201);
    const notes = await ctx.http.get('/v1/notifications').set(bearer(provider.token)).expect(200);
    const note = notes.body.items.find((x: { category: string }) => x.category === 'booking');
    expect(note).toBeDefined();
    expect(JSON.stringify(note)).not.toMatch(/0990000000|Fuite|2500/);
    expect(note.data.bookingId).toBe(created.body.id);

    await ctx.http.get(`/v1/bookings/${created.body.id}`).set(bearer(stranger.token)).expect(404);
    await act(stranger, created.body.id, 'confirm').expect(404);
    await act(client, created.body.id, 'confirm').expect(403); // the client can not confirm
    await act(provider, created.body.id, 'quote/accept').expect(403);
    const confirmed = await act(provider, created.body.id, 'confirm').expect(200);
    expect(confirmed.body.status).toBe('confirmed');
    expect(confirmed.body.events.map((e: { status: string; actorKind: string }) => `${e.status}:${e.actorKind}`)).toEqual(['requested:client', 'confirmed:provider']);
    const mine = await ctx.http.get('/v1/me/bookings').set(bearer(client.token)).expect(200);
    expect(mine.body.items.map((b: { id: string }) => b.id)).toContain(created.body.id);
    const received = await ctx.http.get('/v1/me/service-bookings?status=confirmed').set(bearer(provider.token)).expect(200);
    expect(received.body.items).toHaveLength(1);
    await act(provider, created.body.id, 'confirm').expect(409); // already confirmed
    const clientNotes = await ctx.http.get('/v1/notifications').set(bearer(client.token)).expect(200);
    expect(clientNotes.body.items.some((x: { category: string }) => x.category === 'booking')).toBe(true);
  });
});

describe('quotes', () => {
  it('proposes, accepts and confirms; a declined quote cancels the booking', async () => {
    const { provider, offerId } = await individual({ priceKind: 'quote', priceMinor: undefined, currency: undefined });
    const client = await user();
    const slots = await slotsOf(client, offerId, Date.now() + 3 * HOUR, Date.now() + 2 * 24 * HOUR);
    const b1 = (await book(client, offerId, slots[0]!.startsAt).expect(201)).body;
    expect(b1).toMatchObject({ priceKind: 'quote', amountMinor: null, quoteStatus: 'none' });

    expect((await act(provider, b1.id, 'confirm').expect(409)).body.error.details.reason).toBe('quote_not_accepted');
    await act(client, b1.id, 'quote/accept').expect(409); // nothing proposed yet
    await act(client, b1.id, 'quote', { amountMinor: 100, currency: 'USD' }).expect(403); // only the provider
    await act(provider, b1.id, 'quote', { amountMinor: 0, currency: 'USD' }).expect(400);
    const proposed = await act(provider, b1.id, 'quote', { amountMinor: 8000, currency: 'USD' }).expect(200);
    expect(proposed.body).toMatchObject({ quoteStatus: 'proposed', amountMinor: 8000, status: 'requested' });
    await act(provider, b1.id, 'quote', { amountMinor: 7000, currency: 'USD' }).expect(200); // replaced
    await act(provider, b1.id, 'quote/accept').expect(403); // only the client
    const accepted = await act(client, b1.id, 'quote/accept').expect(200);
    expect(accepted.body).toMatchObject({ quoteStatus: 'accepted', amountMinor: 7000 });
    await act(provider, b1.id, 'quote', { amountMinor: 9000, currency: 'USD' }).expect(409); // frozen once accepted
    expect((await act(provider, b1.id, 'confirm').expect(200)).body.status).toBe('confirmed');

    const b2 = (await book(client, offerId, slots[1]!.startsAt).expect(201)).body;
    await act(provider, b2.id, 'quote', { amountMinor: 50000, currency: 'USD' }).expect(200);
    const declined = await act(client, b2.id, 'quote/decline').expect(200);
    expect(declined.body).toMatchObject({ quoteStatus: 'declined', status: 'cancelled' });

    // A fixed-price offer takes no quote.
    const fixed = await individual();
    const fslot = (await slotsOf(client, fixed.offerId, Date.now() + 3 * HOUR, Date.now() + 2 * 24 * HOUR))[0]!;
    const fb = (await book(client, fixed.offerId, fslot.startsAt).expect(201)).body;
    expect((await act(fixed.provider, fb.id, 'quote', { amountMinor: 100, currency: 'USD' }).expect(409)).body.error.details.reason).toBe('not_a_quote_service');
  });
});

describe('cancellation', () => {
  it('lets the client cancel until cancelNoticeHours before the start, not after', async () => {
    const { provider, offerId } = await individual({ cancelNoticeHours: 24 });
    const client = await user();
    const now = Date.now();
    const far = (await slotsOf(client, offerId, now + 3 * 24 * HOUR, now + 4 * 24 * HOUR))[0]!;
    const near = (await slotsOf(client, offerId, now + 2 * HOUR, now + 8 * HOUR))[0]!;

    const farBooking = (await book(client, offerId, far.startsAt).expect(201)).body;
    const cancelled = await act(client, farBooking.id, 'cancel', { reason: 'Empêchement' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', statusChangedBy: 'client' });
    expect(cancelled.body.events.at(-1)).toMatchObject({ status: 'cancelled', actorKind: 'client', note: 'Empêchement' });
    await act(client, farBooking.id, 'cancel').expect(409); // already cancelled

    const nearBooking = (await book(client, offerId, near.startsAt).expect(201)).body;
    const refused = await act(client, nearBooking.id, 'cancel').expect(409);
    expect(refused.body.error.details).toMatchObject({ reason: 'cancellation_window_closed', noticeHours: 24 });
    const stillThere = await ctx.http.get(`/v1/bookings/${nearBooking.id}`).set(bearer(client.token)).expect(200);
    expect(stillThere.body.status).toBe('requested');
    // The provider can always cancel, and decline a request.
    const byProvider = await act(provider, nearBooking.id, 'cancel').expect(200);
    expect(byProvider.body).toMatchObject({ status: 'cancelled', statusChangedBy: 'provider' });
    const third = (await book(client, offerId, near.startsAt).expect(201)).body;
    expect((await act(provider, third.id, 'decline', { reason: 'Indisponible' }).expect(200)).body.status).toBe('declined');
  });
});

describe('reviews', () => {
  it('only after completion, once, with a provider reply and moderation by report', async () => {
    const { provider, offerId } = await individual();
    const client = await user();
    const stranger = await user();
    const slot = (await slotsOf(client, offerId, Date.now() + 3 * HOUR, Date.now() + 2 * 24 * HOUR))[0]!;
    const booking = (await book(client, offerId, slot.startsAt).expect(201)).body;
    const review = (u: TU, body: object = { rating: 5, body: 'Très bien' }) => ctx.http.post(`/v1/bookings/${booking.id}/review`).set(bearer(u.token)).send(body);

    expect((await review(client).expect(409)).body.error.details.reason).toBe('booking_not_completed');
    await act(provider, booking.id, 'confirm').expect(200);
    expect((await review(client).expect(409)).body.error.details.reason).toBe('booking_not_completed');
    expect((await act(provider, booking.id, 'complete').expect(409)).body.error.details.reason).toBe('not_started');
    // The appointment takes place.
    await ctx.sql.query(`UPDATE service_bookings SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = $1`, [booking.id]);
    expect((await act(provider, booking.id, 'complete').expect(200)).body.status).toBe('completed');

    await review(stranger).expect(404);
    await review(provider).expect(403);
    await review(client, { rating: 6 }).expect(400);
    const created = await review(client).expect(201);
    expect(created.body).toMatchObject({ rating: 5, verifiedBooking: true, reply: null });
    expect((await review(client).expect(409)).body.error.details.reason).toBe('already_reviewed');

    await ctx.http.post(`/v1/service-reviews/${created.body.id}/reply`).set(bearer(client.token)).send({ body: 'Merci' }).expect(404);
    await ctx.http.post(`/v1/service-reviews/${created.body.id}/reply`).set(bearer(stranger.token)).send({ body: 'Merci' }).expect(404);
    const replied = await ctx.http.post(`/v1/service-reviews/${created.body.id}/reply`).set(bearer(provider.token)).send({ body: 'Merci à vous' }).expect(200);
    expect(replied.body.reply.body).toBe('Merci à vous');

    const list = await ctx.http.get(`/v1/services/${offerId}/reviews`).set(bearer(stranger.token)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.summary).toMatchObject({ ratingCount: 1, averageRating: 5 });
    const detail = await ctx.http.get(`/v1/services/${offerId}`).set(bearer(stranger.token)).expect(200);
    expect(detail.body).toMatchObject({ ratingCount: 1, averageRating: 5 });
    expect((await ctx.http.get(`/v1/bookings/${booking.id}`).set(bearer(client.token)).expect(200)).body.reviewId).toBe(created.body.id);

    // Reports: offers and reviews are moderation targets ("service", "service_review").
    await ctx.http.post('/v1/reports').set(bearer(stranger.token)).send({ targetType: 'service', targetId: offerId, reason: 'spam' }).expect(201);
    await ctx.http.post('/v1/reports').set(bearer(stranger.token)).send({ targetType: 'service_review', targetId: created.body.id, reason: 'spam' }).expect(201);
  });

  it('does not review a no-show booking', async () => {
    const { provider, offerId } = await individual();
    const client = await user();
    const slot = (await slotsOf(client, offerId, Date.now() + 3 * HOUR, Date.now() + 2 * 24 * HOUR))[0]!;
    const booking = (await book(client, offerId, slot.startsAt).expect(201)).body;
    await act(provider, booking.id, 'confirm').expect(200);
    await ctx.sql.query(`UPDATE service_bookings SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = $1`, [booking.id]);
    expect((await act(provider, booking.id, 'no-show').expect(200)).body.status).toBe('no_show');
    await ctx.http.post(`/v1/bookings/${booking.id}/review`).set(bearer(client.token)).send({ rating: 1 }).expect(409);
  });
});

describe('discovery', () => {
  it('filters by category and text, and sorts by distance within the radius', async () => {
    const near = await individual({ title: 'Distance-test près' }, { point: GOMA });
    const mid = await individual({ title: 'Distance-test moyen', categoryId: otherCategoryId }, { point: { lat: GOMA.lat - 0.05, lng: GOMA.lng } });
    const far = await individual({ title: 'Distance-test loin' }, { point: BUKAVU });
    const draft = await individual({ title: 'Distance-test brouillon', status: 'draft' }, { point: GOMA });
    const viewer = await user();
    const get = (qs: string) => ctx.http.get(`/v1/services?${qs}`).set(bearer(viewer.token)).expect(200);
    const around = `lat=${GOMA.lat}&lng=${GOMA.lng}&q=Distance-test`;

    const res = await get(`${around}&radiusKm=20`);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([near.offerId, mid.offerId]);
    expect(res.body.items[0].distanceKm).toBeLessThan(1);
    expect(res.body.items[1].distanceKm).toBeGreaterThan(5);
    expect(res.body.items[0].inServiceZone).toBe(true);
    const wide = await get(`${around}&radiusKm=100`);
    expect(wide.body.items.map((i: { id: string }) => i.id)).toEqual([near.offerId, mid.offerId, far.offerId]);
    expect(wide.body.items[2].inServiceZone).toBe(false); // outside the 10 km zone of the offer
    expect(wide.body.items.map((i: { id: string }) => i.id)).not.toContain(draft.offerId);

    const paged1 = await get(`${around}&radiusKm=100&limit=2`);
    expect(paged1.body.items).toHaveLength(2);
    const paged2 = await get(`${around}&radiusKm=100&limit=2&cursor=${paged1.body.nextCursor}`);
    expect(paged2.body.items.map((i: { id: string }) => i.id)).toEqual([far.offerId]);
    expect(paged2.body.nextCursor).toBeNull();

    const byCategory = await get(`q=Distance-test&categoryId=${otherCategoryId}`);
    expect(byCategory.body.items.map((i: { id: string }) => i.id)).toEqual([mid.offerId]);
    expect(byCategory.body.items[0].distanceKm).toBeNull();
    await ctx.http.get('/v1/services?lat=1').set(bearer(viewer.token)).expect(400);
    await ctx.http.get('/v1/services').expect(401);

    // Archived and moderation-hidden offers disappear.
    await ctx.http.delete(`/v1/me/services/${mid.offerId}`).set(bearer(mid.provider.token)).expect(204);
    await ctx.sql.query('UPDATE service_offers SET hidden = true WHERE id = $1', [far.offerId]);
    const after = await get(`${around}&radiusKm=100`);
    expect(after.body.items.map((i: { id: string }) => i.id)).toEqual([near.offerId]);
    await ctx.http.get(`/v1/services/${far.offerId}`).set(bearer(viewer.token)).expect(404);
    await ctx.http.get(`/v1/services/${draft.offerId}`).set(bearer(viewer.token)).expect(404);
  });

  it('hides offers of private or suspended organisations', async () => {
    const owner = await user();
    const viewer = await user();
    const org = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: uniq('prive'), name: 'Privé', kind: 'services', visibility: 'private' }).expect(201)).body;
    const offer = (
      await ctx.http
        .post(`/v1/orgs/${org.id}/services`)
        .set(bearer(owner.token))
        .send({ title: 'Org-cachée', categoryId, priceKind: 'quote', durationMin: 60, city: 'Goma', ...GOMA, status: 'published' })
        .expect(201)
    ).body;
    await ctx.http.get(`/v1/services/${offer.id}`).set(bearer(viewer.token)).expect(404);
    const res = await ctx.http.get('/v1/services?q=Org-cach').set(bearer(viewer.token)).expect(200);
    expect(res.body.items).toEqual([]);
    await ctx.http.patch(`/v1/orgs/${org.id}`).set(bearer(owner.token)).send({ visibility: 'public' }).expect(200);
    await ctx.http.get(`/v1/services/${offer.id}`).set(bearer(viewer.token)).expect(200);
  });
});

describe('blocks', () => {
  it('hides the offer both ways and refuses booking once blocked', async () => {
    const { provider, offerId } = await individual({ title: 'Bloc-test' });
    const client = await user();
    const slot = (await slotsOf(client, offerId, Date.now() + 3 * HOUR, Date.now() + 2 * 24 * HOUR))[0]!;
    await ctx.http.get('/v1/services?q=Bloc-test').set(bearer(client.token)).expect(200).then((r) => expect(r.body.items).toHaveLength(1));

    await ctx.http.put(`/v1/blocks/${provider.id}`).set(bearer(client.token)).expect(204);
    expect((await ctx.http.get('/v1/services?q=Bloc-test').set(bearer(client.token)).expect(200)).body.items).toEqual([]);
    await ctx.http.get(`/v1/services/${offerId}`).set(bearer(client.token)).expect(404);
    await ctx.http.get(`/v1/services/${offerId}/slots`).set(bearer(client.token)).expect(404);
    await book(client, offerId, slot.startsAt).expect(404);
    await ctx.http.get(`/v1/services/${offerId}/reviews`).set(bearer(client.token)).expect(404);

    // The block also works the other way round.
    await ctx.http.delete(`/v1/blocks/${provider.id}`).set(bearer(client.token)).expect(204);
    await ctx.http.put(`/v1/blocks/${client.id}`).set(bearer(provider.token)).expect(204);
    expect((await ctx.http.get('/v1/services?q=Bloc-test').set(bearer(client.token)).expect(200)).body.items).toEqual([]);
    await book(client, offerId, slot.startsAt).expect(404);
  });
});

describe('export and purge', () => {
  it('exports the own profile, offers, bookings and reviews', async () => {
    const { provider, offerId } = await individual({ title: 'Export-test' });
    const client = await user();
    const slot = (await slotsOf(client, offerId, Date.now() + 3 * HOUR, Date.now() + 2 * 24 * HOUR))[0]!;
    await book(client, offerId, slot.startsAt, 'Note perso').expect(201);
    const mine = await ctx.http.get('/v1/me/export').set(bearer(client.token)).expect(200);
    expect(mine.body.services.bookings).toHaveLength(1);
    expect(mine.body.services.bookings[0]).toMatchObject({ offerTitle: 'Export-test', note: 'Note perso' });
    expect(mine.body.services.profile).toBeNull();
    const theirs = await ctx.http.get('/v1/me/export').set(bearer(provider.token)).expect(200);
    expect(theirs.body.services.profile.displayName).toBe('Jean Plombier');
    expect(theirs.body.services.offers).toHaveLength(1);
    expect(theirs.body.services.bookings).toEqual([]);
  });
});

describe('flag services', () => {
  it('answers 403 feature_disabled on every route when the flag is off', async () => {
    const u = await user();
    const { offerId } = await individual();
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'services'`);
    try {
      for (const res of [
        await ctx.http.get('/v1/services').set(bearer(u.token)),
        await ctx.http.get(`/v1/services/${offerId}`).set(bearer(u.token)),
        await ctx.http.get('/v1/service-categories').set(bearer(u.token)),
        await ctx.http.get('/v1/me/bookings').set(bearer(u.token)),
        await ctx.http.put('/v1/me/service-profile').set(bearer(u.token)).send({ displayName: 'X' }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('feature_disabled');
      }
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'services'`);
    }
    await ctx.http.get('/v1/services').set(bearer(u.token)).expect(200);
  });
});

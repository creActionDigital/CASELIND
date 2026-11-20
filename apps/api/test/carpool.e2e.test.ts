import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TU;

interface TU {
  token: string;
  id: string;
  handle: string;
}

beforeAll(async () => {
  ctx = await createTestContext();
  const a = await signUp(ctx);
  await ctx.sql.query(`UPDATE users SET roles = ARRAY['user','admin'] WHERE email = $1`, [a.identifier]);
  admin = await toUser(a.tokens.accessToken);
});
afterAll(async () => {
  await ctx.close();
});

async function toUser(token: string): Promise<TU> {
  const me = await ctx.http.get('/v1/me').set(bearer(token)).expect(200);
  return { token, id: me.body.id, handle: me.body.handle };
}
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  return toUser(tokens.accessToken);
}
const post = (u: TU, path: string, body?: object) => ctx.http.post(path).set(bearer(u.token)).send(body ?? {});
const get = (u: TU, path: string) => ctx.http.get(path).set(bearer(u.token));

/** Approved mobility driver with KYC level 1. */
async function driver(): Promise<TU> {
  const d = await user();
  await ctx.http
    .put('/v1/mobility/driver')
    .set(bearer(d.token))
    .send({ vehicleKind: 'car', comfort: false, make: 'Toyota', plate: `GOM-${Math.floor(Math.random() * 9000 + 1000)}`, color: 'gris', zone: 'Goma' })
    .expect(200);
  await ctx.sql.query(`INSERT INTO kyc_profiles (user_id, level) VALUES ($1, 1) ON CONFLICT (user_id) DO UPDATE SET level = 1`, [d.id]);
  await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'approve' }).expect(200);
  return d;
}

// Goma to Sake, about 20 km.
const ORIGIN = { lat: -1.65849, lng: 29.2205, label: 'Gare routière de Goma' };
const DEST = { lat: -1.5833, lng: 29.0333, label: 'Centre de Sake' };
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const tripBody = (extra: Record<string, unknown> = {}) => ({ origin: ORIGIN, destination: DEST, departsAt: inHours(3), seatsTotal: 3, pricePerSeatMinor: 500, ...extra });
const makeTrip = async (d: TU, extra: Record<string, unknown> = {}) => (await post(d, '/v1/carpool/trips', tripBody(extra)).expect(201)).body as { id: string; seatsFree: number; status: string };
const book = (p: TU, tripId: string, seats = 1) => post(p, `/v1/carpool/trips/${tripId}/bookings`, { seats });
const search = (u: TU, qs: string) => get(u, `/v1/carpool/trips?${qs}`);
const NEAR = 'originLat=-1.66&originLng=29.22&radiusKm=5';
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe('creation rules', () => {
  it('requires an approved driver with KYC and caps the price at twice the estimate', async () => {
    const plain = await user();
    expect((await post(plain, '/v1/carpool/trips', tripBody())).status).toBe(403);
    const d = await driver();
    const q = await post(d, '/v1/carpool/quote', { origin: ORIGIN, destination: DEST }).expect(200);
    expect(q.body).toMatchObject({ estimated: true, currency: 'USD', paymentMode: 'cash' });
    expect(q.body.maxPricePerSeatMinor).toBe(q.body.estimatedFareMinor * 2);
    const ok = await post(d, '/v1/carpool/trips', tripBody({ pricePerSeatMinor: q.body.maxPricePerSeatMinor })).expect(201);
    expect(ok.body).toMatchObject({ role: 'driver', exact: true, status: 'open', seatsFree: 3, paymentMode: 'cash' });
    const high = await post(d, '/v1/carpool/trips', tripBody({ pricePerSeatMinor: q.body.maxPricePerSeatMinor + 1 }));
    expect(high.status).toBe(400);
    expect(JSON.stringify(high.body)).toContain('price_too_high');
    await post(d, '/v1/carpool/trips', tripBody({ pricePerSeatMinor: 0 })).expect(201);
  });

  it('validates the departure, the seats, the places and the currency', async () => {
    const d = await driver();
    await post(d, '/v1/carpool/trips', tripBody({ departsAt: inHours(0.2) })).expect(400);
    await post(d, '/v1/carpool/trips', tripBody({ departsAt: inHours(61 * 24) })).expect(400);
    await post(d, '/v1/carpool/trips', tripBody({ seatsTotal: 9 })).expect(400);
    await post(d, '/v1/carpool/trips', tripBody({ seatsTotal: 0 })).expect(400);
    await post(d, '/v1/carpool/trips', tripBody({ destination: ORIGIN })).expect(400);
    await post(d, '/v1/carpool/trips', tripBody({ currency: 'EUR' })).expect(400);
    await post(d, '/v1/carpool/trips', tripBody({ note: 'x'.repeat(201) })).expect(400);
    await ctx.http.post('/v1/carpool/trips').send(tripBody()).expect(401);
  });

  it('allows five open trips per driver', async () => {
    const d = await driver();
    for (let i = 0; i < 5; i++) await makeTrip(d);
    const sixth = await post(d, '/v1/carpool/trips', tripBody());
    expect(sixth.status).toBe(409);
    expect(JSON.stringify(sixth.body)).toContain('open_limit');
  });
});

describe('full cycle', () => {
  it('books, accepts, departs, completes and rates both ways', async () => {
    const d = await driver();
    const p = await user();
    const other = await user();
    const trip = await makeTrip(d, { note: 'Une valise maximum' });

    const b = await book(p, trip.id, 2).expect(201);
    expect(b.body).toMatchObject({ status: 'requested', seats: 2, tripId: trip.id });
    expect((await get(d, `/v1/carpool/trips/${trip.id}`)).body.seatsFree).toBe(3);
    await book(p, trip.id).expect(409);

    // Only the driver of the trip decides.
    await post(other, `/v1/carpool/bookings/${b.body.id}/accept`).expect(404);
    await post(p, `/v1/carpool/bookings/${b.body.id}/accept`).expect(404);
    const acc = await post(d, `/v1/carpool/bookings/${b.body.id}/accept`).expect(200);
    expect(acc.body.status).toBe('accepted');
    const after = (await get(d, `/v1/carpool/trips/${trip.id}`)).body;
    expect(after).toMatchObject({ seatsFree: 1, status: 'open', role: 'driver' });
    expect(after.bookings).toHaveLength(1);
    // A second acceptance is an invalid transition.
    await post(d, `/v1/carpool/bookings/${b.body.id}/accept`).expect(409);

    const mine = (await get(p, `/v1/carpool/trips/${trip.id}`)).body;
    expect(mine).toMatchObject({ role: 'passenger', exact: true });
    expect(mine.myBooking.status).toBe('accepted');
    expect(mine.bookings).toEqual([]);
    expect((await get(p, '/v1/carpool/mine?role=passenger')).body.items.map((i: { id: string }) => i.id)).toContain(trip.id);

    // Too early to depart (3 hours ahead), then the time comes.
    await post(d, `/v1/carpool/trips/${trip.id}/depart`).expect(409);
    await post(p, `/v1/carpool/trips/${trip.id}/depart`).expect(404);
    await ctx.sql.query(`UPDATE carpool_trips SET departs_at = now() + interval '10 minutes' WHERE id = $1`, [trip.id]);
    await post(d, `/v1/carpool/trips/${trip.id}/complete`).expect(409);
    expect((await post(d, `/v1/carpool/trips/${trip.id}/depart`).expect(200)).body.status).toBe('departed');
    // Cancelling after departure is refused for the passenger and for the driver.
    await post(p, `/v1/carpool/bookings/${b.body.id}/cancel`).expect(409);
    await post(d, `/v1/carpool/trips/${trip.id}/cancel`).expect(409);
    await post(p, `/v1/carpool/trips/${trip.id}/ratings`, { userId: d.id, rating: 5 }).expect(409);

    const done = (await post(d, `/v1/carpool/trips/${trip.id}/complete`).expect(200)).body;
    expect(done.status).toBe('completed');
    expect(done.bookings[0].status).toBe('completed');
    expect(done.toRate.map((x: { id: string }) => x.id)).toEqual([p.id]);

    await post(p, `/v1/carpool/trips/${trip.id}/ratings`, { userId: d.id, rating: 4 }).expect(201);
    await post(p, `/v1/carpool/trips/${trip.id}/ratings`, { userId: d.id, rating: 5 }).expect(409);
    await post(d, `/v1/carpool/trips/${trip.id}/ratings`, { userId: p.id, rating: 5 }).expect(201);
    await post(d, `/v1/carpool/trips/${trip.id}/ratings`, { userId: other.id, rating: 5 }).expect(400);
    await post(other, `/v1/carpool/trips/${trip.id}/ratings`, { userId: d.id, rating: 5 }).expect(404);
    await post(p, `/v1/carpool/trips/${trip.id}/ratings`, { userId: other.id, rating: 5 }).expect(400);
    const rated = (await get(p, `/v1/carpool/trips/${trip.id}`)).body;
    expect(rated.toRate).toEqual([]);
    expect(rated.driver.ratingAvg).toBe(4);
    expect(rated.driver.ratingCount).toBe(1);
    // The audit trail carries ids and statuses, never a note or a place.
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action LIKE 'carpool.%'`);
    expect(audit.rows.length).toBeGreaterThan(3);
    expect(JSON.stringify(audit.rows)).not.toContain('Une valise');
    expect(JSON.stringify(audit.rows)).not.toContain('Gare routière');
  });

  it('declines requests and refuses your own trip', async () => {
    const d = await driver();
    const p = await user();
    const trip = await makeTrip(d);
    await book(d, trip.id).expect(403);
    const b = (await book(p, trip.id).expect(201)).body;
    await post(d, `/v1/carpool/bookings/${b.id}/decline`).expect(200);
    await post(d, `/v1/carpool/bookings/${b.id}/accept`).expect(409);
    // After a refusal the passenger may ask again.
    await book(p, trip.id).expect(201);
    // Notifications are generic.
    const n = await get(d, '/v1/notifications');
    expect(JSON.stringify(n.body)).toContain('Covoiturage');
  });
});

describe('seats', () => {
  it('never sells a seat twice, even when the driver accepts concurrently', async () => {
    const d = await driver();
    const trip = await makeTrip(d, { seatsTotal: 1 });
    const ps = await Promise.all([user(), user(), user()]);
    const bookings = await Promise.all(ps.map((p) => book(p, trip.id).expect(201).then((r) => r.body.id as string)));
    const results = await Promise.all(bookings.map((id) => post(d, `/v1/carpool/bookings/${id}/accept`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const t = (await get(d, `/v1/carpool/trips/${trip.id}`)).body;
    expect(t).toMatchObject({ seatsFree: 0, status: 'full' });
    expect(t.bookings.filter((b: { status: string }) => b.status === 'accepted')).toHaveLength(1);
    const row = await ctx.sql.query(`SELECT seats_free FROM carpool_trips WHERE id = $1`, [trip.id]);
    expect(row.rows[0].seats_free).toBe(0);
    // A full trip takes no new request and leaves the search.
    expect((await book(await user(), trip.id)).status).toBe(409);
    expect(ids(await search(await user(), NEAR))).not.toContain(trip.id);
  });

  it('refuses a request for more seats than are free and releases seats on cancellation', async () => {
    const d = await driver();
    const [p1, p2] = [await user(), await user()];
    const trip = await makeTrip(d, { seatsTotal: 2 });
    await book(p1, trip.id, 3).expect(409);
    const b1 = (await book(p1, trip.id, 2).expect(201)).body;
    const b2 = (await book(p2, trip.id, 1).expect(201)).body;
    await post(d, `/v1/carpool/bookings/${b1.id}/accept`).expect(200);
    expect((await get(d, `/v1/carpool/trips/${trip.id}`)).body).toMatchObject({ seatsFree: 0, status: 'full' });
    // Not enough seats left for the second request.
    expect((await post(d, `/v1/carpool/bookings/${b2.id}/accept`)).status).toBe(409);
    // The passenger cancels: seats are back, the trip reopens and the other request can be accepted.
    await post(p1, `/v1/carpool/bookings/${b1.id}/cancel`).expect(200);
    expect((await get(d, `/v1/carpool/trips/${trip.id}`)).body).toMatchObject({ seatsFree: 2, status: 'open' });
    await post(d, `/v1/carpool/bookings/${b2.id}/accept`).expect(200);
    // The driver cancels an accepted booking: seats are given back as well.
    await post(d, `/v1/carpool/bookings/${b2.id}/cancel`).expect(200);
    expect((await get(d, `/v1/carpool/trips/${trip.id}`)).body.seatsFree).toBe(2);
    await post(p2, `/v1/carpool/bookings/${b2.id}/cancel`).expect(409);
    const outsider = await user();
    await post(outsider, `/v1/carpool/bookings/${b2.id}/cancel`).expect(404);
  });

  it('cancels the whole trip: live bookings are cancelled', async () => {
    const d = await driver();
    const p = await user();
    const trip = await makeTrip(d);
    const b = (await book(p, trip.id).expect(201)).body;
    await post(d, `/v1/carpool/bookings/${b.id}/accept`).expect(200);
    await post(p, `/v1/carpool/trips/${trip.id}/cancel`).expect(404);
    expect((await post(d, `/v1/carpool/trips/${trip.id}/cancel`).expect(200)).body.status).toBe('cancelled');
    expect((await get(p, `/v1/carpool/trips/${trip.id}`)).body.myBooking.status).toBe('cancelled');
    await book(await user(), trip.id).expect(409);
  });
});

describe('search', () => {
  it('finds open trips near the origin and the destination, rounds the points, and paginates', async () => {
    const d = await driver();
    const viewer = await user();
    const t1 = await makeTrip(d, { departsAt: inHours(5) });
    const t2 = await makeTrip(d, { departsAt: inHours(72) });
    const far = await makeTrip(d, { origin: { lat: -1.9441, lng: 29.8739, label: 'Loin' }, destination: { lat: -2.5, lng: 28.86, label: 'Bukavu' }, departsAt: inHours(6) });

    const found = await search(viewer, `${NEAR}&destLat=-1.58&destLng=29.03`);
    expect(found.status).toBe(200);
    expect(ids(found)).toEqual(expect.arrayContaining([t1.id, t2.id]));
    expect(ids(found)).not.toContain(far.id);
    const item = found.body.items.find((i: { id: string }) => i.id === t1.id);
    // Rounded to 3 decimals for a non-participant.
    expect(item).toMatchObject({ exact: false, role: 'viewer', origin: { lat: -1.658, lng: 29.221 } });
    expect(item.bookings).toEqual([]);
    // The driver sees the exact point in their own view.
    expect((await get(d, `/v1/carpool/trips/${t1.id}`)).body.origin.lat).toBe(-1.65849);
    // A far-away origin, or a destination far from the trip, finds nothing of ours.
    expect(ids(await search(viewer, 'originLat=-1.9441&originLng=29.8739&radiusKm=5'))).toEqual(expect.arrayContaining([far.id]));
    expect(ids(await search(viewer, 'originLat=-1.9441&originLng=29.8739&radiusKm=5'))).not.toContain(t1.id);
    expect(ids(await search(viewer, `originLat=-1.66&originLng=29.22&destLat=-2.5&destLng=28.86&radiusKm=5`))).not.toContain(t1.id);
    // Your own trips are not offered to you.
    expect(ids(await search(d, NEAR))).not.toContain(t1.id);

    // Day filter (UTC day of t2).
    const day = (await get(d, `/v1/carpool/trips/${t2.id}`)).body.departsAt.slice(0, 10);
    const byDay = await search(viewer, `${NEAR}&date=${day}`);
    expect(ids(byDay)).toContain(t2.id);
    expect(ids(byDay)).not.toContain(t1.id);
    expect((await search(viewer, `${NEAR}&date=2026-02-31`)).status).toBe(400);
    expect((await search(viewer, `${NEAR}&destLat=1`)).status).toBe(400);
    expect((await search(viewer, 'originLat=200&originLng=0')).status).toBe(400);

    // Cursor pagination, soonest first, without repetition.
    const p1 = await search(viewer, `${NEAR}&limit=1`);
    expect(p1.body.items).toHaveLength(1);
    expect(p1.body.nextCursor).toBeTruthy();
    const seen = [p1.body.items[0].id];
    let cursor: string | null = p1.body.nextCursor;
    for (let i = 0; cursor && i < 50; i++) {
      const page = await search(viewer, `${NEAR}&limit=1&cursor=${encodeURIComponent(cursor)}`);
      seen.push(...ids(page));
      cursor = page.body.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(expect.arrayContaining([t1.id, t2.id]));
    expect(seen.indexOf(t1.id)).toBeLessThan(seen.indexOf(t2.id));
    expect((await search(viewer, `${NEAR}&cursor=garbage`)).status).toBe(400);
  });

  it('hides trips of blocked users in both directions, and from the detail', async () => {
    const d = await driver();
    const blocker = await user();
    const blocked = await user();
    const trip = await makeTrip(d);
    await ctx.http.put(`/v1/blocks/${d.id}`).set(bearer(blocker.token)).expect(204);
    expect(ids(await search(blocker, NEAR))).not.toContain(trip.id);
    await get(blocker, `/v1/carpool/trips/${trip.id}`).expect(404);
    await book(blocker, trip.id).expect(404);
    await ctx.http.put(`/v1/blocks/${blocked.id}`).set(bearer(d.token)).expect(204);
    expect(ids(await search(blocked, NEAR))).not.toContain(trip.id);
    await book(blocked, trip.id).expect(404);
  });

  it('ignores a trip whose time has passed even before maintenance runs', async () => {
    const d = await driver();
    const trip = await makeTrip(d);
    await ctx.sql.query(`UPDATE carpool_trips SET departs_at = now() - interval '1 hour' WHERE id = $1`, [trip.id]);
    expect(ids(await search(await user(), NEAR))).not.toContain(trip.id);
    await book(await user(), trip.id).expect(409);
  });
});

describe('expiry and reports', () => {
  it('closes past trips in maintenance and cancels their live bookings', async () => {
    const d = await driver();
    const p = await user();
    const trip = await makeTrip(d);
    const b = (await book(p, trip.id).expect(201)).body;
    await post(d, `/v1/carpool/bookings/${b.id}/accept`).expect(200);
    const late = await makeTrip(d);
    await ctx.sql.query(`UPDATE carpool_trips SET departs_at = now() - interval '4 hours' WHERE id = $1`, [trip.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect((await get(d, `/v1/carpool/trips/${trip.id}`)).body.status).toBe('cancelled');
    expect((await get(p, `/v1/carpool/trips/${trip.id}`)).body.myBooking.status).toBe('cancelled');
    expect((await get(d, `/v1/carpool/trips/${late.id}`)).body.status).toBe('open');
    // A departed trip nobody completed is completed a day later.
    const dep = await makeTrip(d);
    await ctx.sql.query(`UPDATE carpool_trips SET status = 'departed', departs_at = now() - interval '25 hours' WHERE id = $1`, [dep.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect((await get(d, `/v1/carpool/trips/${dep.id}`)).body.status).toBe('completed');
  });

  it('can be reported by a viewer (not by the driver), hidden by a moderator, and is erased by the account purge', async () => {
    const d = await driver();
    const viewer = await user();
    const trip = await makeTrip(d, { note: 'Contenu douteux' });
    const rep = (u: TU) => ctx.http.post('/v1/reports').set(bearer(u.token)).send({ targetType: 'carpool_trip', targetId: trip.id, reason: 'spam' });
    expect((await rep(viewer)).status).toBe(201);
    expect((await rep(viewer)).status).toBe(409);
    expect((await rep(d)).status).toBe(404);
    const hide = await ctx.http.post('/v1/admin/moderation/actions').set(bearer(admin.token)).send({ targetType: 'carpool_trip', targetId: trip.id, action: 'hide' });
    expect(hide.status).toBe(200);
    expect(ids(await search(await user(), NEAR))).not.toContain(trip.id);
    await get(viewer, `/v1/carpool/trips/${trip.id}`).expect(404);
    // The driver still sees their own trip.
    await get(d, `/v1/carpool/trips/${trip.id}`).expect(200);
  });

  it('is part of the data export', async () => {
    const d = await driver();
    const p = await user();
    const trip = await makeTrip(d, { note: 'Pour l’export' });
    await book(p, trip.id).expect(201);
    const exp = await get(d, '/v1/me/export').expect(200);
    expect(exp.body.mobilityExtra.carpoolTrips.map((t: { id: string }) => t.id)).toContain(trip.id);
    expect(JSON.stringify(exp.body.mobilityExtra)).not.toMatch(/lat|lng/i);
    const exp2 = await get(p, '/v1/me/export').expect(200);
    expect(exp2.body.mobilityExtra.carpoolBookings).toHaveLength(1);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MobilityService } from '../src/mobility/mobility.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TU;
let mobility: MobilityService;

interface TU {
  token: string;
  id: string;
  handle: string;
}

beforeAll(async () => {
  ctx = await createTestContext();
  mobility = ctx.app.get(MobilityService);
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

const PICKUP = { lat: -1.6585, lng: 29.2205, label: 'Place du 3 Août' };
const STOP = { lat: -1.67, lng: 29.23, label: 'Marché de Birere' };
const DROPOFF = { lat: -1.68, lng: 29.24, label: 'Aéroport de Goma' };
const NEAR = { lat: -1.659, lng: 29.221 };

const rideBody = (extra: Record<string, unknown> = {}) => ({ pickup: PICKUP, dropoff: DROPOFF, vehicle: 'moto', ...extra });
const post = (u: TU, path: string, body?: object) => ctx.http.post(path).set(bearer(u.token)).send(body ?? {});
const get = (u: TU, path: string) => ctx.http.get(path).set(bearer(u.token));

/** Approved, KYC level 1, online driver with a fresh position next to the pick-up point. */
async function driver(kind: 'moto' | 'car' = 'moto', comfort = false): Promise<TU> {
  const d = await user();
  await ctx.http
    .put('/v1/mobility/driver')
    .set(bearer(d.token))
    .send({ vehicleKind: kind, comfort, make: 'Bajaj', plate: `GOM-${Math.floor(Math.random() * 9000 + 1000)}`, color: 'rouge', zone: 'Goma' })
    .expect(200);
  await ctx.sql.query(`INSERT INTO kyc_profiles (user_id, level) VALUES ($1, 1) ON CONFLICT (user_id) DO UPDATE SET level = 1`, [d.id]);
  await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'approve' }).expect(200);
  await post(d, '/v1/mobility/driver/online', { online: true }).expect(200);
  await post(d, '/v1/mobility/driver/location', NEAR).expect(204);
  return d;
}

async function request(rider: TU, extra: Record<string, unknown> = {}) {
  const res = await post(rider, '/v1/rides', rideBody(extra)).expect(201);
  return res.body as { id: string; status: string; startCode: string | null };
}

/** accepted -> driver_arriving -> in_progress, returns the ride id. */
async function startedRide(rider: TU, d: TU): Promise<string> {
  const r = await request(rider);
  await post(d, `/v1/rides/${r.id}/accept`).expect(200);
  await post(d, `/v1/rides/${r.id}/arriving`).expect(200);
  const code = (await get(rider, `/v1/rides/${r.id}`).expect(200)).body.startCode as string;
  await post(d, `/v1/rides/${r.id}/start`, { code }).expect(200);
  return r.id;
}

describe('estimate', () => {
  it('is always flagged as estimated, with a range, a stop and the three ride types', async () => {
    const rider = await user();
    const direct = await post(rider, '/v1/rides/estimate', { pickup: PICKUP, dropoff: DROPOFF, vehicle: 'standard' }).expect(200);
    expect(direct.body.estimated).toBe(true);
    expect(direct.body.currency).toBe('USD');
    expect(direct.body.paymentMode).toBe('cash');
    expect(direct.body.fareMin).toBeLessThanOrEqual(direct.body.fareMinor);
    expect(direct.body.fareMax).toBeGreaterThanOrEqual(direct.body.fareMinor);
    expect(direct.body.options.map((o: { vehicle: string }) => o.vehicle)).toEqual(['moto', 'standard', 'confort']);
    const [moto, std, comfort] = direct.body.options;
    expect(moto.fareMinor).toBeLessThan(std.fareMinor);
    expect(std.fareMinor).toBeLessThan(comfort.fareMinor);

    const withStop = await post(rider, '/v1/rides/estimate', { pickup: PICKUP, stop: STOP, dropoff: DROPOFF, vehicle: 'standard' }).expect(200);
    expect(withStop.body.distanceKm).toBeGreaterThanOrEqual(direct.body.distanceKm);
    expect(withStop.body.durationMin).toBeGreaterThan(direct.body.durationMin);
    expect(withStop.body.fareMinor).toBeGreaterThanOrEqual(direct.body.fareMinor);

    const cdf = await post(rider, '/v1/rides/estimate', { pickup: PICKUP, dropoff: DROPOFF, vehicle: 'moto', currency: 'CDF' }).expect(200);
    expect(cdf.body.fareMinor).toBeGreaterThan(direct.body.options[0].fareMinor);
    await post(rider, '/v1/rides/estimate', { pickup: PICKUP, dropoff: DROPOFF, vehicle: 'moto', currency: 'EUR' }).expect(400);
    await post(rider, '/v1/rides/estimate', { pickup: PICKUP, dropoff: DROPOFF, vehicle: 'tuk' }).expect(400);
  });
});

describe('drivers', () => {
  it('refuses a driver who is not approved or has no KYC', async () => {
    const d = await user();
    await get(d, '/v1/mobility/driver').expect(404);
    await ctx.http
      .put('/v1/mobility/driver')
      .set(bearer(d.token))
      .send({ vehicleKind: 'car', make: 'Toyota', plate: 'GOM-1234', color: 'blanc', zone: 'Goma' })
      .expect(200);
    await post(d, '/v1/mobility/driver/online', { online: true }).expect(403);
    await post(d, '/v1/mobility/driver/location', NEAR).expect(403);
    // Only admins decide, and approval needs KYC level 1.
    await post(d, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'approve' }).expect(403);
    const noKyc = await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'approve' }).expect(409);
    expect(noKyc.body.error.details.reason).toBe('kyc_required');
    await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'reject' }).expect(400);
    await ctx.sql.query(`INSERT INTO kyc_profiles (user_id, level) VALUES ($1, 1) ON CONFLICT (user_id) DO UPDATE SET level = 1`, [d.id]);
    const ok = await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'approve' }).expect(200);
    expect(ok.body.status).toBe('approved');
    await post(d, '/v1/mobility/driver/online', { online: true }).expect(200);
    // An approved driver whose KYC drops can no longer work.
    await ctx.sql.query(`UPDATE kyc_profiles SET level = 0 WHERE user_id = $1`, [d.id]);
    await post(d, '/v1/mobility/driver/online', { online: true }).expect(403);
    // Going offline erases the position.
    await ctx.sql.query(`UPDATE kyc_profiles SET level = 1 WHERE user_id = $1`, [d.id]);
    await post(d, '/v1/mobility/driver/location', NEAR).expect(204);
    await post(d, '/v1/mobility/driver/online', { online: false }).expect(200);
    const row = await ctx.sql.query(`SELECT last_lat, online FROM mobility_drivers WHERE user_id = $1`, [d.id]);
    expect(row.rows[0]).toEqual({ last_lat: null, online: false });
  });

  it('a rejected or suspended driver cannot be online, and the admin list filters by status', async () => {
    const d = await user();
    await ctx.http.put('/v1/mobility/driver').set(bearer(d.token)).send({ vehicleKind: 'moto', make: 'TVS', plate: 'GOM-9', color: 'noir', zone: 'Goma' }).expect(200);
    await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'reject', reason: 'Photo manquante' }).expect(200);
    await post(d, '/v1/mobility/driver/online', { online: true }).expect(403);
    const list = await get(admin, '/v1/admin/mobility/drivers?status=rejected').expect(200);
    expect(list.body.items.some((i: { userId: string }) => i.userId === d.id)).toBe(true);
    await get(d, '/v1/admin/mobility/drivers').expect(403);
  });
});

describe('matching', () => {
  it('lets only one of two simultaneous drivers win, and shows the rider the driver and vehicle', async () => {
    const d1 = await driver('moto');
    const d2 = await driver('moto');
    const rider = await user();
    const r = await request(rider);
    expect(r.status).toBe('requested');
    // Offers: nearest requests first, only for drivers whose vehicle can serve them.
    const offers = await get(d1, '/v1/mobility/driver/offers').expect(200);
    expect(offers.body.items.map((o: { id: string }) => o.id)).toContain(r.id);
    const car = await driver('car');
    const none = await get(car, '/v1/mobility/driver/offers').expect(200);
    expect(none.body.items.map((o: { id: string }) => o.id)).not.toContain(r.id);
    await post(car, `/v1/rides/${r.id}/accept`).expect(403);
    // A foreign ride is invisible.
    await get(d1, `/v1/rides/${r.id}`).expect(404);

    const [a, b] = await Promise.all([post(d1, `/v1/rides/${r.id}/accept`), post(d2, `/v1/rides/${r.id}/accept`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? d1 : d2;
    const loser = a.status === 200 ? d2 : d1;
    expect((a.status === 409 ? a : b).body.error.details.reason).toBe('ride_unavailable');

    const view = await get(rider, `/v1/rides/${r.id}`).expect(200);
    expect(view.body.status).toBe('accepted');
    expect(view.body.driver.userId).toBe(winner.id);
    expect(view.body.driver.vehicle.plate).toMatch(/^GOM-/);
    expect(view.body.driverLocation).toMatchObject(NEAR);
    expect(view.body.startCode).toMatch(/^\d{4}$/);
    await get(loser, `/v1/rides/${r.id}`).expect(404);
    // The winner is busy now, and the rider cannot request twice.
    const other = await request(await user());
    await post(winner, `/v1/rides/${other.id}/accept`).expect(409);
    await post(rider, '/v1/rides', rideBody()).expect(409);
    // The driver never sees the code.
    const dv = await get(winner, `/v1/rides/${r.id}`).expect(200);
    expect(dv.body.startCode).toBeNull();
    expect(dv.body.driverLocation).toBeNull();
    // Cleanup so other tests find these drivers free.
    await post(winner, `/v1/rides/${r.id}/cancel`, { reason: 'other' }).expect(200);
    await post(loser, '/v1/mobility/driver/online', { online: false }).expect(200);
  });

  it('expires a request nobody accepted after 3 minutes', async () => {
    const rider = await user();
    const r = await request(rider);
    expect(await mobility.runOnce(new Date(Date.now() + 2 * 60_000))).toMatchObject({ expired: 0 });
    const res = await mobility.runOnce(new Date(Date.now() + 4 * 60_000));
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect((await get(rider, `/v1/rides/${r.id}`).expect(200)).body.status).toBe('expired');
    const d = await driver('moto');
    await post(d, `/v1/rides/${r.id}/accept`).expect(409);
    await post(d, '/v1/mobility/driver/online', { online: false }).expect(200);
  });
});

describe('ride life', () => {
  it('needs the right start code, shows the position only during the ride and ends the share link', async () => {
    const d = await driver('moto');
    const rider = await user();
    const r = await request(rider);
    const before = (await get(rider, `/v1/rides/${r.id}`).expect(200)).body;
    expect(before.driver).toBeNull();
    expect(before.driverLocation).toBeNull();
    await post(d, `/v1/rides/${r.id}/accept`).expect(200);
    await post(d, `/v1/rides/${r.id}/start`, { code: '0000' }).expect(409); // not arriving yet
    await post(d, `/v1/rides/${r.id}/arriving`).expect(200);
    const code = (await get(rider, `/v1/rides/${r.id}`).expect(200)).body.startCode as string;
    const wrong = code === '1234' ? '4321' : '1234';
    const bad = await post(d, `/v1/rides/${r.id}/start`, { code: wrong }).expect(403);
    expect(bad.body.error.details).toMatchObject({ reason: 'invalid_start_code', remainingAttempts: 4 });
    await post(d, `/v1/rides/${r.id}/start`, { code: 'abcd' }).expect(400);
    await post(rider, `/v1/rides/${r.id}/start`, { code }).expect(404);
    await post(d, `/v1/rides/${r.id}/start`, { code }).expect(200);

    // Share link: read-only, no sign-in, while the ride is live.
    const share = await post(rider, `/v1/rides/${r.id}/share`).expect(200);
    await post(d, `/v1/rides/${r.id}/share`).expect(404);
    const shared = await ctx.http.get(`/v1/rides/shared/${share.body.token}`).expect(200);
    expect(shared.body.status).toBe('in_progress');
    expect(shared.body.dropoffLabel).toBe(DROPOFF.label);
    expect(shared.body.startCode).toBeUndefined();
    await ctx.http.get('/v1/rides/shared/not-a-token').expect(404);

    // Positions during the ride: the rider sees the last one, only the distance is kept.
    await post(d, '/v1/mobility/driver/location', { lat: -1.665, lng: 29.225 }).expect(204);
    await post(d, '/v1/mobility/driver/location', { lat: -1.675, lng: 29.235 }).expect(204);
    const live = (await get(rider, `/v1/rides/${r.id}`).expect(200)).body;
    expect(live.status).toBe('in_progress');
    expect(live.driverLocation).toMatchObject({ lat: -1.675, lng: 29.235 });
    expect(live.startCode).toBeNull();
    const meas = await ctx.sql.query(`SELECT actual_distance_km FROM mobility_rides WHERE id = $1`, [r.id]);
    expect(meas.rows[0].actual_distance_km).toBeGreaterThan(1);
    await post(rider, `/v1/rides/${r.id}/cancel`, { reason: 'changed_mind' }).expect(409); // in progress

    const done = await post(d, `/v1/rides/${r.id}/complete`).expect(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.finalFareMinor).toBeGreaterThan(0);
    // After the ride: no position, no share link, no history of positions.
    const after = (await get(rider, `/v1/rides/${r.id}`).expect(200)).body;
    expect(after.driverLocation).toBeNull();
    await ctx.http.get(`/v1/rides/shared/${share.body.token}`).expect(404);
    const track = await ctx.sql.query(`SELECT track_lat, share_hash FROM mobility_rides WHERE id = $1`, [r.id]);
    expect(track.rows[0]).toEqual({ track_lat: null, share_hash: null });

    // Receipt and history.
    const receipt = await get(rider, `/v1/rides/${r.id}/receipt`).expect(200);
    expect(receipt.body).toMatchObject({ rideId: r.id, paymentMode: 'cash', fareEstimated: true, currency: 'USD', fareMinor: done.body.finalFareMinor });
    expect(receipt.body.pickup.label).toBe(PICKUP.label);
    expect(receipt.body.distanceKm).toBeGreaterThan(1);
    expect(receipt.body.durationMin).toBeGreaterThanOrEqual(1);
    const hist = await get(rider, '/v1/me/rides?scope=done').expect(200);
    expect(hist.body.items[0].id).toBe(r.id);
    await get(await user(), `/v1/rides/${r.id}/receipt`).expect(404);

    // Mutual ratings, once each.
    await post(rider, `/v1/rides/${r.id}/rating`, { rating: 5, comment: 'Parfait' }).expect(200);
    await post(rider, `/v1/rides/${r.id}/rating`, { rating: 4 }).expect(409);
    await post(d, `/v1/rides/${r.id}/rating`, { rating: 3 }).expect(200);
    await post(d, `/v1/rides/${r.id}/rating`, { rating: 0 }).expect(400);
    const prof = await get(d, '/v1/mobility/driver').expect(200);
    expect(prof.body.ratingAverage).toBe(5);
    expect(prof.body.ratingCount).toBe(1);
    await post(await user(), `/v1/rides/${r.id}/rating`, { rating: 3 }).expect(404);
    await post(d, '/v1/mobility/driver/online', { online: false }).expect(200);
  });

  it('locks the code after 5 wrong attempts', async () => {
    const d = await driver('moto');
    const rider = await user();
    const r = await request(rider);
    await post(d, `/v1/rides/${r.id}/accept`).expect(200);
    await post(d, `/v1/rides/${r.id}/arriving`).expect(200);
    const code = (await get(rider, `/v1/rides/${r.id}`)).body.startCode as string;
    const wrong = code === '1111' ? '2222' : '1111';
    for (let i = 0; i < 4; i += 1) await post(d, `/v1/rides/${r.id}/start`, { code: wrong }).expect(403);
    await post(d, `/v1/rides/${r.id}/start`, { code: wrong }).expect(429);
    await post(d, `/v1/rides/${r.id}/start`, { code }).expect(429);
    await post(rider, `/v1/rides/${r.id}/cancel`, { reason: 'wait_too_long' }).expect(200);
    await post(d, '/v1/mobility/driver/online', { online: false }).expect(200);
  });

  it('cancels with a closed list of reasons per side, without fee', async () => {
    const d = await driver('moto');
    const rider = await user();
    const r = await request(rider);
    await post(rider, `/v1/rides/${r.id}/cancel`, { reason: 'because' }).expect(400);
    await post(rider, `/v1/rides/${r.id}/cancel`, { reason: 'vehicle_issue' }).expect(400); // driver-side reason
    await post(d, `/v1/rides/${r.id}/accept`).expect(200);
    await post(d, `/v1/rides/${r.id}/cancel`, { reason: 'changed_mind' }).expect(400);
    const c = await post(d, `/v1/rides/${r.id}/cancel`, { reason: 'rider_unreachable' }).expect(200);
    expect(c.body).toMatchObject({ status: 'cancelled_by_driver', cancelReason: 'rider_unreachable' });
    await post(rider, `/v1/rides/${r.id}/cancel`, { reason: 'other' }).expect(409);
    const prof = await get(d, '/v1/mobility/driver').expect(200);
    expect(prof.body.cancellations).toBeGreaterThanOrEqual(1);
    const r2 = await request(rider);
    const c2 = await post(rider, `/v1/rides/${r2.id}/cancel`, { reason: 'found_other' }).expect(200);
    expect(c2.body.status).toBe('cancelled_by_rider');
    await post(d, '/v1/mobility/driver/online', { online: false }).expect(200);
  });

  it('recalculates the final price with the measured distance', async () => {
    const d = await driver('moto');
    const rider = await user();
    const id = await startedRide(rider, d);
    const est = (await get(rider, `/v1/rides/${id}`)).body.fare.fareMinor as number;
    // ~11 km of positions, much more than the straight line estimate.
    await post(d, '/v1/mobility/driver/location', { lat: -1.7, lng: 29.3 }).expect(204);
    await post(d, '/v1/mobility/driver/location', { lat: -1.6, lng: 29.2 }).expect(204);
    const done = (await post(d, `/v1/rides/${id}/complete`).expect(200)).body;
    expect(done.finalFareMinor).toBeGreaterThan(est);
    // No position at all: the estimate stands.
    const d2 = await driver('moto');
    const id2 = await startedRide(await user(), d2);
    const est2 = (await get(d2, `/v1/rides/${id2}`)).body.fare.fareMinor as number;
    const done2 = (await post(d2, `/v1/rides/${id2}/complete`).expect(200)).body;
    expect(done2.finalFareMinor).toBe(est2);
    await post(d, '/v1/mobility/driver/online', { online: false }).expect(200);
    await post(d2, '/v1/mobility/driver/online', { online: false }).expect(200);
  });
});

describe('scheduled rides', () => {
  it('accepts 30 minutes to 7 days ahead, dispatches 10 minutes before, and cancels for free', async () => {
    const rider = await user();
    const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
    await post(rider, '/v1/rides', rideBody({ scheduledAt: at(10) })).expect(400);
    await post(rider, '/v1/rides', rideBody({ scheduledAt: at(8 * 24 * 60) })).expect(400);
    const r = await post(rider, '/v1/rides', rideBody({ scheduledAt: at(45) })).expect(201);
    expect(r.body.status).toBe('scheduled');
    expect(r.body.scheduledAt).not.toBeNull();
    // Drivers do not see it yet, and a scheduled ride does not block an immediate one.
    const d = await driver('moto');
    expect((await get(d, '/v1/mobility/driver/offers')).body.items.map((o: { id: string }) => o.id)).not.toContain(r.body.id);
    await mobility.runOnce(new Date(Date.now() + 20 * 60_000));
    expect((await get(rider, `/v1/rides/${r.body.id}`)).body.status).toBe('scheduled');
    const res = await mobility.runOnce(new Date(Date.now() + 36 * 60_000));
    expect(res.dispatched).toBeGreaterThanOrEqual(1);
    expect((await get(rider, `/v1/rides/${r.body.id}`)).body.status).toBe('requested');
    expect((await get(d, '/v1/mobility/driver/offers')).body.items.map((o: { id: string }) => o.id)).toContain(r.body.id);
    await post(d, '/v1/mobility/driver/online', { online: false }).expect(200);

    const r2 = await post(rider, '/v1/rides', rideBody({ scheduledAt: at(90) })).expect(201);
    const c = await post(rider, `/v1/rides/${r2.body.id}/cancel`, { reason: 'changed_mind' }).expect(200);
    expect(c.body.status).toBe('cancelled_by_rider');
  });

  it('adds a stop to the ride and the price', async () => {
    const rider = await user();
    const direct = await request(rider);
    await post(rider, `/v1/rides/${direct.id}/cancel`, { reason: 'other' }).expect(200);
    const withStop = (await post(rider, '/v1/rides', rideBody({ stop: STOP })).expect(201)).body;
    expect(withStop.stop.label).toBe(STOP.label);
    const base = (await get(rider, `/v1/rides/${direct.id}`)).body;
    expect(withStop.durationMin).toBeGreaterThan(base.durationMin);
    expect(withStop.fare.fareMinor).toBeGreaterThanOrEqual(base.fare.fareMinor);
    await post(rider, `/v1/rides/${withStop.id}/cancel`, { reason: 'other' }).expect(200);
  });
});

describe('safety and messages', () => {
  it('notifies trusted contacts on alert, limits them to 3, and exchanges quick messages during the ride only', async () => {
    const d = await driver('moto');
    const rider = await user();
    const [c1, c2, c3, c4] = [await user(), await user(), await user(), await user()];
    await ctx.http.put('/v1/me/trusted-contacts').set(bearer(rider.token)).send({ handles: [c1.handle, c2.handle, c3.handle, c4.handle] }).expect(400);
    await ctx.http.put('/v1/me/trusted-contacts').set(bearer(rider.token)).send({ handles: [rider.handle] }).expect(400);
    const set = await ctx.http.put('/v1/me/trusted-contacts').set(bearer(rider.token)).send({ handles: [c1.handle, c2.handle] }).expect(200);
    expect(set.body.items).toHaveLength(2);

    const r = await request(rider);
    await post(rider, `/v1/rides/${r.id}/alert`).expect(409); // nobody is driving yet
    await post(rider, `/v1/rides/${r.id}/messages`, { code: 'here' }).expect(409);
    await post(d, `/v1/rides/${r.id}/accept`).expect(200);

    const alert = await post(rider, `/v1/rides/${r.id}/alert`).expect(200);
    expect(alert.body.notified).toBe(2);
    const n = await ctx.sql.query(`SELECT user_id, body, data FROM notifications WHERE category = 'security' AND user_id = ANY($1)`, [[c1.id, c2.id, c3.id]]);
    expect(n.rows.map((x: { user_id: string }) => x.user_id).sort()).toEqual([c1.id, c2.id].sort());
    expect(JSON.stringify(n.rows)).not.toContain(r.id);
    await post(await user(), `/v1/rides/${r.id}/alert`).expect(404);

    // Quick messages: predefined only.
    await post(d, `/v1/rides/${r.id}/messages`, { code: 'free text' }).expect(400);
    await post(d, `/v1/rides/${r.id}/messages`, { code: 'arriving' }).expect(200);
    const list = await post(rider, `/v1/rides/${r.id}/messages`, { code: 'thanks' }).expect(200);
    expect(list.body.items.map((m: { fromRole: string; mine: boolean }) => [m.fromRole, m.mine])).toEqual([['driver', false], ['rider', true]]);
    expect(list.body.items[0].text).toBe("J'arrive");
    await get(await user(), `/v1/rides/${r.id}/messages`).expect(404);

    await post(rider, `/v1/rides/${r.id}/cancel`, { reason: 'changed_mind' }).expect(200);
    // Ephemeral: gone with the ride, and no new message once it is over.
    expect((await get(rider, `/v1/rides/${r.id}/messages`)).body.items).toHaveLength(0);
    await post(rider, `/v1/rides/${r.id}/messages`, { code: 'here' }).expect(409);
    await post(rider, `/v1/rides/${r.id}/alert`).expect(409);
    await post(d, '/v1/mobility/driver/online', { online: false }).expect(200);
  });

  it('lets a participant report a ride, and nobody else', async () => {
    const d = await driver('moto');
    const rider = await user();
    const r = await request(rider);
    await post(d, `/v1/rides/${r.id}/accept`).expect(200);
    await post(rider, '/v1/reports', { targetType: 'ride', targetId: r.id, reason: 'harassment' }).expect(201);
    await post(await user(), '/v1/reports', { targetType: 'ride', targetId: r.id, reason: 'harassment' }).expect(404);
    await post(rider, `/v1/rides/${r.id}/cancel`, { reason: 'other' }).expect(200);
    await post(d, '/v1/mobility/driver/online', { online: false }).expect(200);
  });
});

describe('favourite places and account', () => {
  it('stores Maison, Travail and up to 5 places, exports them and erases them on purge', async () => {
    const u = await user();
    const place = (kind: string, n: number) => ({ kind, label: kind === 'home' ? 'Maison' : kind === 'work' ? 'Travail' : `Lieu ${n}`, address: `Avenue ${n}`, lat: -1.66, lng: 29.22 });
    const add = (body: object) => post(u, '/v1/me/favorite-places', body);
    await add(place('home', 1)).expect(201);
    await add(place('home', 2)).expect(409);
    await add(place('work', 3)).expect(201);
    await add(place('other', 4)).expect(201);
    await add(place('other', 5)).expect(201);
    const last = await add(place('other', 6)).expect(201);
    const over = await add(place('other', 7)).expect(409);
    expect(over.body.error.details.reason).toBe('favorites_limit');
    expect((await get(u, '/v1/me/favorite-places')).body.items).toHaveLength(5);
    await get(await user(), '/v1/me/favorite-places').then((r) => expect(r.body.items).toHaveLength(0));
    const stranger = await user();
    await ctx.http.delete(`/v1/me/favorite-places/${last.body.id}`).set(bearer(stranger.token)).expect(404);
    await ctx.http.delete(`/v1/me/favorite-places/${last.body.id}`).set(bearer(u.token)).expect(204);

    const exp = await get(u, '/v1/me/export').expect(200);
    expect(exp.body.mobility.favoritePlaces).toHaveLength(4);
    expect(exp.body.mobility.favoritePlaces[0]).toMatchObject({ kind: 'home', label: 'Maison' });
    expect(exp.body.mobility.rides).toEqual([]);
    expect(exp.body.mobility.driver).toBeNull();
  });
});

describe('feature flag', () => {
  it('refuses everything when the mobility flag is off', async () => {
    const u = await user();
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'mobility'`);
    try {
      await post(u, '/v1/rides/estimate', { pickup: PICKUP, dropoff: DROPOFF, vehicle: 'moto' }).expect(403);
      await post(u, '/v1/rides', rideBody()).expect(403);
      await get(u, '/v1/mobility/driver').expect(403);
      await get(u, '/v1/me/favorite-places').expect(403);
      await ctx.http.get('/v1/rides/shared/abc').expect(403);
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'mobility'`);
    }
    await post(u, '/v1/rides/estimate', { pickup: PICKUP, dropoff: DROPOFF, vehicle: 'moto' }).expect(200);
  });
});

describe('driver profile photo', () => {
  it('keeps the photo and the approval when a profile save omits it, and removes it on explicit null', async () => {
    const d = await driver();
    const mediaId = randomUUID();
    await ctx.sql.query(
      `INSERT INTO media_assets (id, owner_user_id, purpose, declared_mime, mime, size_bytes, status, storage_key, sha256, uploaded_at)
       VALUES ($1, $2, 'avatar', 'image/png', 'image/png', 10, 'ready', $3, repeat('0', 64), now())`,
      [mediaId, d.id, `test/${mediaId}`],
    );
    const base = { vehicleKind: 'moto', comfort: false, make: 'Bajaj', color: 'rouge', zone: 'Goma' };
    const current = ((await get(d, '/v1/mobility/driver').expect(200)).body as { vehicle: { plate: string } }).vehicle;
    const withPhoto = { ...base, plate: current.plate, photoMediaId: mediaId };
    // Adding a photo is a change: back to review, then approved again.
    const added = await ctx.http.put('/v1/mobility/driver').set(bearer(d.token)).send(withPhoto);
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'approve' }).expect(200);

    // Same profile saved without the photo field: nothing changes.
    const kept = await ctx.http.put('/v1/mobility/driver').set(bearer(d.token)).send({ ...base, plate: current.plate }).expect(200);
    expect(kept.body.status).toBe('approved');
    expect(kept.body.vehicle.photoUrl).toContain(mediaId);

    // Explicit null removes it (a change, so the driver goes back to review).
    const removed = await ctx.http.put('/v1/mobility/driver').set(bearer(d.token)).send({ ...base, plate: current.plate, photoMediaId: null }).expect(200);
    expect(removed.body.vehicle.photoUrl).toBeNull();
    expect(removed.body.status).toBe('pending');
  });

  it('refuses a photo whose purpose is not an image purpose (delivery, cv, lesson)', async () => {
    const d = await driver();
    const base = { vehicleKind: 'moto', comfort: false, make: 'Bajaj', color: 'rouge', zone: 'Goma' };
    const current = ((await get(d, '/v1/mobility/driver').expect(200)).body as { vehicle: { plate: string } }).vehicle;
    for (const purpose of ['delivery', 'cv', 'lesson']) {
      const mediaId = randomUUID();
      await ctx.sql.query(
        `INSERT INTO media_assets (id, owner_user_id, purpose, declared_mime, mime, size_bytes, status, storage_key, sha256, uploaded_at)
         VALUES ($1, $2, $3, 'image/png', 'image/png', 10, 'ready', $4, repeat('0', 64), now())`,
        [mediaId, d.id, purpose, `test/${mediaId}`],
      );
      await ctx.http.put('/v1/mobility/driver').set(bearer(d.token)).send({ ...base, plate: current.plate, photoMediaId: mediaId }).expect(400);
    }
  });
});

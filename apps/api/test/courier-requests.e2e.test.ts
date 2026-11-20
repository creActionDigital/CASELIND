import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

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

const PICKUP = { lat: -1.6585, lng: 29.2205, label: 'Rue Secrète 12, Himbi' };
const DROPOFF = { lat: -1.68, lng: 29.24, label: 'Avenue Privée 7, Katindo' };
const NEAR = { lat: -1.659, lng: 29.221 };
const FAR = { lat: -1.9, lng: 29.5 };
const NOTE = 'Sonner deux fois, code du portail 4821';

const body = (extra: Record<string, unknown> = {}) => ({ kind: 'parcel', size: 'small', pickup: PICKUP, dropoff: DROPOFF, note: NOTE, ...extra });
const create = (u: TU, extra: Record<string, unknown> = {}) => post(u, '/v1/courier-requests', body(extra));
const make = async (u: TU, extra: Record<string, unknown> = {}) => (await create(u, extra).expect(201)).body as { id: string; proofCode: string; feeMinor: number; status: string };

/** Approved mobility driver with KYC level 1: the profile that can carry a request. */
async function courier(): Promise<TU> {
  const d = await user();
  await ctx.http
    .put('/v1/mobility/driver')
    .set(bearer(d.token))
    .send({ vehicleKind: 'moto', comfort: false, make: 'Bajaj', plate: `GOM-${Math.floor(Math.random() * 9000 + 1000)}`, color: 'rouge', zone: 'Goma' })
    .expect(200);
  await ctx.sql.query(`INSERT INTO kyc_profiles (user_id, level) VALUES ($1, 1) ON CONFLICT (user_id) DO UPDATE SET level = 1`, [d.id]);
  await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'approve' }).expect(200);
  return d;
}

const offers = (c: TU, pos = NEAR, extra = '') => get(c, `/v1/courier/requests?lat=${pos.lat}&lng=${pos.lng}${extra}`);
const idsOf = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe('estimate and creation', () => {
  it('estimates on the server from the mobility tariff, with size and currency rules', async () => {
    const u = await user();
    const doc = await post(u, '/v1/courier-requests/estimate', { kind: 'document', pickup: PICKUP, dropoff: DROPOFF }).expect(200);
    expect(doc.body).toMatchObject({ estimated: true, currency: 'USD', paymentMode: 'cash' });
    expect(doc.body.feeMinor).toBeGreaterThanOrEqual(100);
    const small = await post(u, '/v1/courier-requests/estimate', { kind: 'parcel', size: 'small', pickup: PICKUP, dropoff: DROPOFF }).expect(200);
    const large = await post(u, '/v1/courier-requests/estimate', { kind: 'parcel', size: 'large', pickup: PICKUP, dropoff: DROPOFF }).expect(200);
    expect(large.body.feeMinor).toBeGreaterThan(small.body.feeMinor);
    const cdf = await post(u, '/v1/courier-requests/estimate', { kind: 'document', pickup: PICKUP, dropoff: DROPOFF, currency: 'CDF' }).expect(200);
    expect(cdf.body.feeMinor).toBeGreaterThan(doc.body.feeMinor);

    await post(u, '/v1/courier-requests/estimate', { kind: 'parcel', pickup: PICKUP, dropoff: DROPOFF }).expect(400);
    await post(u, '/v1/courier-requests/estimate', { kind: 'document', size: 'small', pickup: PICKUP, dropoff: DROPOFF }).expect(400);
    await post(u, '/v1/courier-requests/estimate', { kind: 'document', pickup: PICKUP, dropoff: { ...FAR, label: 'Loin' } }).expect(400);
    await post(u, '/v1/courier-requests/estimate', { kind: 'document', pickup: PICKUP, dropoff: PICKUP }).expect(400);
    await post(u, '/v1/courier-requests/estimate', { kind: 'document', pickup: PICKUP, dropoff: DROPOFF, currency: 'EUR' }).expect(400);
    await ctx.http.post('/v1/courier-requests/estimate').send({}).expect(401);
  });

  it('creates with a server fee and a 6-digit code, hides it from other users and lists own requests', async () => {
    const u = await user();
    const other = await user();
    const r = await create(u, { feeMinor: 1, status: 'delivered', courierId: u.id }).expect(201);
    expect(r.body).toMatchObject({ role: 'requester', status: 'requested', kind: 'parcel', size: 'small', currency: 'USD', note: NOTE, counterpart: null });
    expect(r.body.proofCode).toMatch(/^\d{6}$/);
    const est = await post(u, '/v1/courier-requests/estimate', { kind: 'parcel', size: 'small', pickup: PICKUP, dropoff: DROPOFF }).expect(200);
    expect(r.body.feeMinor).toBe(est.body.feeMinor);
    const expires = new Date(r.body.expiresAt).getTime() - new Date(r.body.createdAt).getTime();
    expect(expires).toBeGreaterThan(29 * 60_000);
    expect(expires).toBeLessThanOrEqual(30 * 60_000 + 1000);

    expect((await get(u, `/v1/courier-requests/${r.body.id}`).expect(200)).body.proofCode).toBe(r.body.proofCode);
    await get(other, `/v1/courier-requests/${r.body.id}`).expect(404);
    await post(other, `/v1/courier-requests/${r.body.id}/cancel`).expect(404);
    await get(u, '/v1/courier-requests/not-a-uuid').expect(404);
    const list = await get(u, '/v1/courier-requests').expect(200);
    expect(idsOf(list)).toEqual([r.body.id]);
    expect(await get(other, '/v1/courier-requests').then((x) => x.body.items)).toEqual([]);

    // Document: no size. Scheduled slot between 2 hours and 7 days.
    await create(u, { kind: 'document', size: undefined, note: undefined }).expect(201);
    const soon = await create(u, { scheduledFor: new Date(Date.now() + 3_600_000).toISOString() });
    expect(soon.status).toBe(400);
    expect(soon.body.error.details[0].reason).toBe('schedule_out_of_range');
    await create(u, { scheduledFor: new Date(Date.now() + 8 * 86_400_000).toISOString() }).expect(400);
  });

  it('caps the open requests at 5 per account; a cancellation frees a slot', async () => {
    const u = await user();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await make(u)).id);
    const sixth = await create(u);
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.details.reason).toBe('open_limit');
    const cancelled = await post(u, `/v1/courier-requests/${ids[0]}/cancel`).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    await post(u, `/v1/courier-requests/${ids[0]}/cancel`).expect(200);
    await create(u).expect(201);
    expect(idsOf(await get(u, '/v1/courier-requests?scope=done').expect(200))).toEqual([ids[0]]);
    expect(idsOf(await get(u, '/v1/courier-requests?scope=active&limit=2').expect(200))).toHaveLength(2);
  });
});

describe('requests nearby', () => {
  it('are reserved to approved couriers, rounded, without label, note nor requester, and filtered by radius', async () => {
    const u = await user();
    const c = await courier();
    const plain = await user();
    const r = await make(u);

    expect((await offers(plain)).status).toBe(403);
    const noKyc = await courier();
    await ctx.sql.query(`UPDATE kyc_profiles SET level = 0 WHERE user_id = $1`, [noKyc.id]);
    expect((await offers(noKyc)).body.error.details.reason).toBe('kyc_required');

    const res = await offers(c).expect(200);
    const offer = res.body.items.find((i: { id: string }) => i.id === r.id);
    expect(offer).toMatchObject({ kind: 'parcel', size: 'small', pickup: { lat: -1.659, lng: 29.221 }, dropoff: { lat: -1.68, lng: 29.24 }, currency: 'USD', feeMinor: r.feeMinor });
    expect(offer.pickupDistanceKm).toBeLessThan(0.5);
    const raw = JSON.stringify(res.body);
    for (const secret of ['Secrète', 'Privée', '4821', u.id, u.handle, String(PICKUP.lat), String(PICKUP.lng)]) expect(raw).not.toContain(secret);

    // Far away, or a tiny radius: nothing. The requester never sees their own request among the offers.
    expect(idsOf(await offers(c, FAR).expect(200))).not.toContain(r.id);
    expect(idsOf(await offers(c, NEAR, '&radiusKm=0.5').expect(200))).toContain(r.id);
    expect(idsOf(await offers(c, { lat: -1.7, lng: 29.2205 }, '&radiusKm=0.5').expect(200))).not.toContain(r.id);
    await offers(c, NEAR, '&radiusKm=500').expect(400);
    await get(c, '/v1/courier/requests').expect(400);
    const asCourierToo = await courier();
    const own = await make(asCourierToo);
    expect(idsOf(await offers(asCourierToo).expect(200))).not.toContain(own.id);
  });

  it('hide a scheduled request until 60 minutes before its slot, a blocked requester and an expired request', async () => {
    const u = await user();
    const c = await courier();
    const sched = await make(u, { scheduledFor: new Date(Date.now() + 5 * 3_600_000).toISOString() });
    expect(idsOf(await offers(c).expect(200))).not.toContain(sched.id);
    const early = await post(c, `/v1/courier/requests/${sched.id}/accept`);
    expect(early.status).toBe(409);
    expect(early.body.error.details.reason).toBe('not_open_yet');
    await ctx.sql.query(`UPDATE courier_requests SET scheduled_for = now() + interval '45 minutes' WHERE id = $1`, [sched.id]);
    expect(idsOf(await offers(c).expect(200))).toContain(sched.id);

    const blocker = await user();
    const hidden = await make(blocker);
    await ctx.http.put(`/v1/blocks/${c.id}`).set(bearer(blocker.token)).expect(204);
    expect(idsOf(await offers(c).expect(200))).not.toContain(hidden.id);
    await post(c, `/v1/courier/requests/${hidden.id}/accept`).expect(404);

    const old = await make(u);
    await ctx.sql.query(`UPDATE courier_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [old.id]);
    expect(idsOf(await offers(c).expect(200))).not.toContain(old.id);
  });
});

describe('acceptance and steps', () => {
  it('lets exactly one of two simultaneous couriers win', async () => {
    const u = await user();
    const a = await courier();
    const b = await courier();
    const r = await make(u);
    const results = await Promise.all([post(a, `/v1/courier/requests/${r.id}/accept`), post(b, `/v1/courier/requests/${r.id}/accept`)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const loser = results.find((x) => x.status === 409)!;
    expect(loser.body.error.details.reason).toBe('request_unavailable');
    const winner = results.find((x) => x.status === 200)!.body;
    const row = (await ctx.sql.query(`SELECT courier_id, status FROM courier_requests WHERE id = $1`, [r.id])).rows[0];
    expect(row.status).toBe('accepted');
    expect(winner.role).toBe('courier');
    expect([a.id, b.id]).toContain(row.courier_id);
  });

  it('runs accepted -> picked up -> delivered with the code, locks after 5 wrong codes, and rates both ways', async () => {
    const u = await user();
    const c = await courier();
    const c2 = await courier();
    const r = await make(u);

    // Nothing to do before acceptance, nothing for someone else.
    await post(c, `/v1/courier/requests/${r.id}/picked-up`).expect(404);
    await get(c, `/v1/courier-requests/${r.id}`).expect(404);
    await post(u, `/v1/courier/requests/${r.id}/accept`).expect(403);
    const accepted = await post(c, `/v1/courier/requests/${r.id}/accept`).expect(200);
    expect(accepted.body).toMatchObject({ role: 'courier', status: 'accepted', note: NOTE, proofCode: null });
    expect(accepted.body.pickup.label).toBe(PICKUP.label);
    expect(accepted.body.counterpart.userId).toBe(u.id);
    await post(c2, `/v1/courier/requests/${r.id}/accept`).expect(409);
    await post(c2, `/v1/courier/requests/${r.id}/picked-up`).expect(404);
    await get(c2, `/v1/courier-requests/${r.id}`).expect(404);

    const asRequester = (await get(u, `/v1/courier-requests/${r.id}`).expect(200)).body;
    expect(asRequester).toMatchObject({ status: 'accepted', proofCode: r.proofCode });
    expect(asRequester.counterpart.userId).toBe(c.id);
    expect(idsOf(await get(c, '/v1/courier/requests/mine').expect(200))).toEqual([r.id]);

    await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: r.proofCode }).expect(409);
    await post(c, `/v1/courier/requests/${r.id}/picked-up`).expect(200);
    await post(c, `/v1/courier/requests/${r.id}/picked-up`).expect(409);
    await post(u, `/v1/courier-requests/${r.id}/cancel`).expect(409);

    const wrong = r.proofCode === '000000' ? '111111' : '000000';
    await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: '12' }).expect(400);
    for (let i = 1; i <= 4; i += 1) {
      const bad = await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: wrong });
      expect(bad.status).toBe(403);
      expect(bad.body.error.details.remainingAttempts).toBe(5 - i);
    }
    const locked = await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: wrong });
    expect(locked.status).toBe(429);
    expect((await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: r.proofCode })).status).toBe(429);
    await ctx.sql.query(`UPDATE courier_requests SET proof_locked_until = NULL WHERE id = $1`, [r.id]);

    await post(u, `/v1/courier-requests/${r.id}/rating`, { rating: 5 }).expect(409);
    const done = await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: r.proofCode }).expect(200);
    expect(done.body.status).toBe('delivered');
    expect((await get(u, `/v1/courier-requests/${r.id}`).expect(200)).body.proofCode).toBeNull();

    await post(u, `/v1/courier-requests/${r.id}/rating`, { rating: 5 }).expect(200);
    await post(u, `/v1/courier-requests/${r.id}/rating`, { rating: 4 }).expect(409);
    await post(u, `/v1/courier-requests/${r.id}/rating`, { rating: 6 }).expect(400);
    await post(c2, `/v1/courier-requests/${r.id}/rating`, { rating: 5 }).expect(404);
    const back = await post(c, `/v1/courier-requests/${r.id}/rating`, { rating: 3 }).expect(200);
    expect(back.body).toMatchObject({ ratingGiven: 3, ratingReceived: 5 });
    expect((await get(c, '/v1/courier/requests/mine?scope=done').expect(200)).body.items).toHaveLength(1);

    const events = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE metadata->>'requestId' = $1`, [r.id]);
    expect(events.rows.map((e) => e.action)).toContain('courier_request.status_changed');
    const dump = JSON.stringify(events.rows);
    for (const secret of ['Secrète', 'Privée', '4821', r.proofCode]) expect(dump).not.toContain(secret);
  });

  it('locks the code for good after 3 series of wrong codes until the requester resets it, and hides exact points', async () => {
    const u = await user();
    const c = await courier();
    const r = await make(u);
    const accepted = (await post(c, `/v1/courier/requests/${r.id}/accept`).expect(200)).body;
    // The exact drop-off is not given before the pick-up (rounded point, no label); the pick-up is.
    expect(accepted.dropoff).toMatchObject({ label: '', lat: -1.68, lng: 29.24 });
    expect(accepted.pickup.label).toBe(PICKUP.label);
    const picked = (await post(c, `/v1/courier/requests/${r.id}/picked-up`).expect(200)).body;
    expect(picked.dropoff.label).toBe(DROPOFF.label);

    const wrong = r.proofCode === '000000' ? '111111' : '000000';
    for (let round = 1; round <= 3; round += 1) {
      for (let i = 0; i < 5; i += 1) await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: wrong });
      const q = await ctx.sql.query(`SELECT proof_lock_rounds, proof_locked_until FROM courier_requests WHERE id = $1`, [r.id]);
      expect(q.rows[0].proof_lock_rounds).toBe(round);
      if (round < 3) await ctx.sql.query(`UPDATE courier_requests SET proof_locked_until = NULL WHERE id = $1`, [r.id]);
    }
    // Series 3: no expiry any more, even the right code is refused.
    expect((await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: r.proofCode })).status).toBe(429);
    await post(c, `/v1/courier-requests/${r.id}/reset-proof`).expect(404);
    const reset = (await post(u, `/v1/courier-requests/${r.id}/reset-proof`).expect(200)).body;
    expect(reset.proofLockedUntil).toBeNull();
    await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: r.proofCode }).expect(403);
    await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: reset.proofCode }).expect(200);

    // Done: the courier re-reads the request without exact addresses nor note; the requester keeps everything.
    const seen = (await get(c, `/v1/courier-requests/${r.id}`).expect(200)).body;
    expect(seen).toMatchObject({ status: 'delivered', note: null, pickup: { label: '' }, dropoff: { label: '' } });
    const jobs = (await get(c, '/v1/courier/requests/mine?scope=done').expect(200)).body.items[0];
    expect(JSON.stringify(jobs)).not.toContain('Secrète');
    expect(JSON.stringify(jobs)).not.toContain('4821');
    expect((await get(u, `/v1/courier-requests/${r.id}`).expect(200)).body).toMatchObject({ note: NOTE, pickup: { label: PICKUP.label } });
  });

  it('brakes acceptances at 5 per minute per courier', async () => {
    const u = await user();
    const c = await courier();
    const ids = await Promise.all([1, 2, 3, 4, 5].map(async () => (await make(u)).id));
    // Unknown ids still count as attempts: the brake applies before any row is read.
    for (const id of ids) expect((await post(c, `/v1/courier/requests/${id}/accept`)).status).not.toBe(429);
    expect((await post(c, `/v1/courier/requests/${ids[0]}/accept`)).status).toBe(429);
  });

  it('refuses a courier who already carries 3 requests', async () => {
    const u = await user();
    const c = await courier();
    for (let i = 0; i < 3; i += 1) await post(c, `/v1/courier/requests/${(await make(u)).id}/accept`).expect(200);
    const fourth = await post(c, `/v1/courier/requests/${(await make(u)).id}/accept`);
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.details.reason).toBe('courier_busy');
  });

  it('cancelled by the requester after acceptance, then gone from the courier list', async () => {
    const u = await user();
    const c = await courier();
    const r = await make(u);
    await post(c, `/v1/courier/requests/${r.id}/accept`).expect(200);
    await post(u, `/v1/courier-requests/${r.id}/cancel`).expect(200);
    expect((await get(c, '/v1/courier/requests/mine').expect(200)).body.items).toEqual([]);
    await post(c, `/v1/courier/requests/${r.id}/picked-up`).expect(409);
    const notes = (await get(c, '/v1/notifications').expect(200)).body.items as { body: string }[];
    expect(notes.some((n) => n.body.includes('annulée'))).toBe(true);
    // Notifications are generic: never an address, a note or a code.
    expect(JSON.stringify(notes)).not.toContain('Secrète');
  });
});

describe('location sharing', () => {
  it('needs consent, reaches the requester while picked up only, and is erased on delivery', async () => {
    const u = await user();
    const c = await courier();
    const r = await make(u);
    await post(c, `/v1/courier/requests/${r.id}/accept`).expect(200);
    await post(c, `/v1/courier/requests/${r.id}/location`, NEAR).expect(409);
    await post(c, `/v1/courier/requests/${r.id}/picked-up`).expect(200);
    expect((await post(c, `/v1/courier/requests/${r.id}/location`, NEAR)).body.error.details.reason).toBe('location_consent_required');
    await post(u, `/v1/courier/requests/${r.id}/location`, NEAR).expect(404);

    await ctx.http.put(`/v1/courier/requests/${r.id}/location-consent`).set(bearer(c.token)).send({ granted: true }).expect(200);
    await post(c, `/v1/courier/requests/${r.id}/location`, NEAR).expect(204);
    expect((await get(u, `/v1/courier-requests/${r.id}`).expect(200)).body.location).toMatchObject({ lat: NEAR.lat, lng: NEAR.lng });
    expect((await get(c, `/v1/courier-requests/${r.id}`).expect(200)).body.location).toBeNull();

    await ctx.http.put(`/v1/courier/requests/${r.id}/location-consent`).set(bearer(c.token)).send({ granted: false }).expect(200);
    expect((await get(u, `/v1/courier-requests/${r.id}`).expect(200)).body.location).toBeNull();
    await ctx.http.put(`/v1/courier/requests/${r.id}/location-consent`).set(bearer(c.token)).send({ granted: true }).expect(200);
    await post(c, `/v1/courier/requests/${r.id}/location`, NEAR).expect(204);
    await post(c, `/v1/courier/requests/${r.id}/delivered`, { code: r.proofCode }).expect(200);
    const row = (await ctx.sql.query(`SELECT last_lat, last_lng, location_consent FROM courier_requests WHERE id = $1`, [r.id])).rows[0];
    expect(row).toEqual({ last_lat: null, last_lng: null, location_consent: false });
  });
});

describe('expiration', () => {
  it('reads as expired as soon as the deadline passes, cannot be accepted, and the maintenance writes it', async () => {
    const u = await user();
    const c = await courier();
    const r = await make(u);
    await ctx.sql.query(`UPDATE courier_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [r.id]);
    expect((await get(u, `/v1/courier-requests/${r.id}`).expect(200)).body.status).toBe('expired');
    expect((await get(u, '/v1/courier-requests?scope=done').expect(200)).body.items.map((i: { id: string }) => i.id)).toContain(r.id);
    const late = await post(c, `/v1/courier/requests/${r.id}/accept`);
    expect(late.status).toBe(409);
    expect(late.body.error.details.reason).toBe('request_unavailable');
    expect((await ctx.sql.query(`SELECT status FROM courier_requests WHERE id = $1`, [r.id])).rows[0].status).toBe('requested');

    await ctx.app.get(MaintenanceService).runOnce();
    expect((await ctx.sql.query(`SELECT status FROM courier_requests WHERE id = $1`, [r.id])).rows[0].status).toBe('expired');
    // An expired request no longer counts as open.
    const fresh = await user();
    for (let i = 0; i < 5; i += 1) await make(fresh);
    await ctx.sql.query(`UPDATE courier_requests SET expires_at = now() - interval '1 minute' WHERE requester_id = $1 AND id = (SELECT id FROM courier_requests WHERE requester_id = $1 LIMIT 1)`, [fresh.id]);
    await create(fresh).expect(201);
  });
});

describe('route plan', () => {
  it('orders the courier own accepted requests nearest first, pick-up before drop-off, and refuses foreign ids', async () => {
    const u = await user();
    const c = await courier();
    const stranger = await courier();
    const near = await make(u, { pickup: { lat: -1.659, lng: 29.221, label: 'A' }, dropoff: { lat: -1.7, lng: 29.26, label: 'B' } });
    const far = await make(u, { pickup: { lat: -1.665, lng: 29.23, label: 'C' }, dropoff: { lat: -1.662, lng: 29.225, label: 'D' } });
    await post(c, `/v1/courier/requests/${near.id}/accept`).expect(200);
    await post(c, `/v1/courier/requests/${far.id}/accept`).expect(200);

    const plan = await get(c, `/v1/courier/route-plan?ids=${near.id},${far.id}&lat=${NEAR.lat}&lng=${NEAR.lng}`).expect(200);
    const order = plan.body.stops.map((s: { id: string; step: string }) => `${s.id === near.id ? 'near' : 'far'}:${s.step}`);
    expect(order).toEqual(['near:pickup', 'far:pickup', 'far:dropoff', 'near:dropoff']);
    expect(plan.body.totalKm).toBeGreaterThan(0);
    expect(plan.body.unlocated).toBe(0);
    expect(plan.body.stops[0]).toMatchObject({ type: 'courier_request', label: 'A', express: false });

    // Once picked up, only the drop-off remains.
    await post(c, `/v1/courier/requests/${near.id}/picked-up`).expect(200);
    const after = await get(c, `/v1/courier/route-plan?ids=${near.id}&lat=${NEAR.lat}&lng=${NEAR.lng}`).expect(200);
    expect(after.body.stops.map((s: { step: string }) => s.step)).toEqual(['dropoff']);

    await get(stranger, `/v1/courier/route-plan?ids=${near.id}&lat=${NEAR.lat}&lng=${NEAR.lng}`).expect(404);
    await get(c, `/v1/courier/route-plan?ids=${near.id},${crypto.randomUUID()}&lat=${NEAR.lat}&lng=${NEAR.lng}`).expect(404);
    await get(c, `/v1/courier/route-plan?ids=nope&lat=${NEAR.lat}&lng=${NEAR.lng}`).expect(400);
    await get(c, `/v1/courier/route-plan?lat=${NEAR.lat}&lng=${NEAR.lng}`).expect(400);
  });
});

describe('account export and purge', () => {
  it('exports both roles (the note only to the requester) and purges addresses, notes and live requests', async () => {
    const u = await user();
    const c = await courier();
    const r = await make(u);
    await post(c, `/v1/courier/requests/${r.id}/accept`).expect(200);

    const mine = (await get(u, '/v1/me/export').expect(200)).body.courierRequests;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: r.id, role: 'requester', status: 'accepted', note: NOTE, pickupLabel: PICKUP.label, feeMinor: r.feeMinor });
    const theirs = (await get(c, '/v1/me/export').expect(200)).body.courierRequests;
    expect(theirs[0]).toMatchObject({ id: r.id, role: 'courier', note: null });
    expect(JSON.stringify(mine)).not.toContain(r.proofCode);
    expect(JSON.stringify(mine)).not.toContain('"lat"');

    // The courier leaves: the accepted request goes back to the open list, without courier nor position.
    await post(c, '/v1/me/deletion-request', { password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [c.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    let row = (await ctx.sql.query(`SELECT status, courier_id, pickup_label, note FROM courier_requests WHERE id = $1`, [r.id])).rows[0];
    expect(row).toMatchObject({ status: 'requested', courier_id: null, pickup_label: PICKUP.label, note: NOTE });

    // The requester leaves: the live request is cancelled and its addresses and note are erased.
    await post(u, '/v1/me/deletion-request', { password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [u.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    row = (await ctx.sql.query(`SELECT status, pickup_label, dropoff_label, note, pickup_lat FROM courier_requests WHERE id = $1`, [r.id])).rows[0];
    expect(row).toEqual({ status: 'cancelled', pickup_label: '', dropoff_label: '', note: null, pickup_lat: 0 });
  });
});

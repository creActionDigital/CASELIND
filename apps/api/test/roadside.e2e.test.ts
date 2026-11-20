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

/** Approved mobility driver with KYC level 1: a roadside provider. */
async function provider(): Promise<TU> {
  const d = await user();
  await ctx.http
    .put('/v1/mobility/driver')
    .set(bearer(d.token))
    .send({ vehicleKind: 'car', comfort: false, make: 'Toyota', plate: `GOM-${Math.floor(Math.random() * 9000 + 1000)}`, color: 'blanc', zone: 'Goma' })
    .expect(200);
  await ctx.sql.query(`INSERT INTO kyc_profiles (user_id, level) VALUES ($1, 1) ON CONFLICT (user_id) DO UPDATE SET level = 1`, [d.id]);
  await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'approve' }).expect(200);
  return d;
}

const POS = { lat: -1.65849, lng: 29.22049, label: 'RN2, devant la station Engen' };
const NOTE = 'Clés à l’intérieur, véhicule bleu';
const body = (extra: Record<string, unknown> = {}) => ({ kind: 'battery', position: POS, vehicleLabel: 'Toyota Corolla bleue', note: NOTE, ...extra });
const make = async (u: TU, extra: Record<string, unknown> = {}) => (await post(u, '/v1/roadside/requests', body(extra)).expect(201)).body as { id: string; status: string };
const offers = (p: TU, qs = 'lat=-1.66&lng=29.22') => get(p, `/v1/roadside/requests?${qs}`);
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe('requesting help', () => {
  it('creates a request with the safety reminder and no invented emergency number', async () => {
    const u = await user();
    const r = await post(u, '/v1/roadside/requests', body({ status: 'done', providerId: u.id })).expect(201);
    expect(r.body).toMatchObject({ role: 'requester', status: 'requested', kind: 'battery', note: NOTE, counterpart: null, etaMinutes: null });
    expect(r.body.safetyNote).toContain('secours locaux');
    expect(r.body.safetyNote).not.toMatch(/\d{3}/);
    expect(r.body.paymentNote).toContain('espèces');
    const ttl = new Date(r.body.expiresAt).getTime() - new Date(r.body.createdAt).getTime();
    expect(ttl).toBe(30 * 60_000);
    await post(u, '/v1/roadside/requests', body({ kind: 'plane' })).expect(400);
    await post(u, '/v1/roadside/requests', body({ note: 'x'.repeat(201) })).expect(400);
    await post(u, '/v1/roadside/requests', body({ vehicleLabel: 'x'.repeat(61) })).expect(400);
    await ctx.http.post('/v1/roadside/requests').send(body()).expect(401);
  });

  it('allows three open requests and frees a slot on cancellation', async () => {
    const u = await user();
    const a = await make(u);
    await make(u, { kind: 'tire' });
    await make(u, { kind: 'fuel' });
    const fourth = await post(u, '/v1/roadside/requests', body());
    expect(fourth.status).toBe(409);
    expect(JSON.stringify(fourth.body)).toContain('open_limit');
    expect((await post(u, `/v1/roadside/requests/${a.id}/cancel`)).body.status).toBe('cancelled');
    await post(u, `/v1/roadside/requests/${a.id}/cancel`).expect(409);
    await make(u);
    expect((await get(u, '/v1/roadside/requests/mine')).body.items).toHaveLength(4);
  });
});

describe('provider side', () => {
  it('shows nearby open requests to approved drivers only, rounded and without any detail', async () => {
    const u = await user();
    const p = await provider();
    const req = await make(u);
    expect((await offers(u)).status).toBe(403);
    expect((await offers(await user())).status).toBe(403);
    const found = await offers(p);
    expect(ids(found)).toContain(req.id);
    const item = found.body.items.find((i: { id: string }) => i.id === req.id);
    expect(item.position).toEqual({ lat: -1.658, lng: 29.22 });
    expect(JSON.stringify(item)).not.toContain('Engen');
    expect(JSON.stringify(item)).not.toContain(NOTE);
    expect(JSON.stringify(item)).not.toContain(u.id);
    // Far away: nothing; your own request is never offered to you.
    expect(ids(await offers(p, 'lat=-3&lng=28'))).not.toContain(req.id);
    expect(ids(await offers(p, 'lat=-1.66&lng=29.22&radiusKm=1'))).toContain(req.id);
    // The requester cannot read the offers (not a driver) but a provider cannot read the details before accepting.
    await get(p, `/v1/roadside/requests/${req.id}`).expect(404);
  });

  it('lets exactly one provider accept, even concurrently', async () => {
    const u = await user();
    const req = await make(u);
    const ps = await Promise.all([provider(), provider(), provider()]);
    const results = await Promise.all(ps.map((p) => post(p, `/v1/roadside/requests/${req.id}/accept`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const winner = ps[results.findIndex((r) => r.status === 200)]!;
    const view = (await get(u, `/v1/roadside/requests/${req.id}`)).body;
    expect(view).toMatchObject({ status: 'accepted', counterpart: { id: winner.id } });
    // Taken requests leave the offers of the others.
    for (const p of ps) expect(ids(await offers(p))).not.toContain(req.id);
  });

  it('walks accepted, on the way, done, with the details visible to the provider only after acceptance', async () => {
    const u = await user();
    const p = await provider();
    const outsider = await user();
    const otherProvider = await provider();
    const req = await make(u);
    await post(u, `/v1/roadside/requests/${req.id}/accept`).expect(403);
    await post(p, `/v1/roadside/requests/${req.id}/on-the-way`, { etaMinutes: 10 }).expect(404);
    await post(p, `/v1/roadside/requests/${req.id}/done`).expect(404);

    const acc = (await post(p, `/v1/roadside/requests/${req.id}/accept`).expect(200)).body;
    expect(acc).toMatchObject({ role: 'provider', status: 'accepted', note: NOTE, counterpart: { id: u.id }, position: { lat: -1.65849, lng: 29.22049, label: POS.label } });
    // Isolation: neither an outsider nor another provider can read or step.
    for (const x of [outsider, otherProvider]) {
      await get(x, `/v1/roadside/requests/${req.id}`).expect(404);
      await post(x, `/v1/roadside/requests/${req.id}/on-the-way`, { etaMinutes: 5 }).expect(404);
      await post(x, `/v1/roadside/requests/${req.id}/done`).expect(404);
      await post(x, `/v1/roadside/requests/${req.id}/cancel`).expect(404);
    }
    await post(p, `/v1/roadside/requests/${req.id}/cancel`).expect(404);
    await post(p, `/v1/roadside/requests/${req.id}/accept`).expect(409);

    await post(p, `/v1/roadside/requests/${req.id}/on-the-way`, { etaMinutes: 0 }).expect(400);
    await post(p, `/v1/roadside/requests/${req.id}/on-the-way`, { etaMinutes: 481 }).expect(400);
    const way = (await post(p, `/v1/roadside/requests/${req.id}/on-the-way`, { etaMinutes: 12 }).expect(200)).body;
    expect(way).toMatchObject({ status: 'on_the_way', etaMinutes: 12 });
    expect((await get(u, `/v1/roadside/requests/${req.id}`)).body).toMatchObject({ status: 'on_the_way', etaMinutes: 12 });
    expect((await get(p, '/v1/roadside/requests/mine?role=provider')).body.items.map((i: { id: string }) => i.id)).toEqual([req.id]);
    expect((await post(p, `/v1/roadside/requests/${req.id}/on-the-way`, { etaMinutes: 8 }).expect(200)).body.etaMinutes).toBe(8);

    expect((await post(p, `/v1/roadside/requests/${req.id}/done`).expect(200)).body.status).toBe('done');
    await post(p, `/v1/roadside/requests/${req.id}/done`).expect(409);
    await post(p, `/v1/roadside/requests/${req.id}/on-the-way`, { etaMinutes: 5 }).expect(409);
    await post(u, `/v1/roadside/requests/${req.id}/cancel`).expect(409);

    // Generic notifications for the requester; audits without any note or place.
    const notes = JSON.stringify((await get(u, '/v1/notifications')).body);
    expect(notes).toContain('Dépannage');
    expect(notes).not.toContain('Engen');
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action LIKE 'roadside.%'`);
    expect(audit.rows.length).toBeGreaterThan(3);
    expect(JSON.stringify(audit.rows)).not.toContain(NOTE);
    expect(JSON.stringify(audit.rows)).not.toContain('Engen');
  });

  it('refuses your own request, blocked users, a third live job, and lets a provider release', async () => {
    const u = await user();
    const p = await provider();
    // Own request: the driver cannot accept what he asked for.
    const own = await make(p);
    expect((await post(p, `/v1/roadside/requests/${own.id}/accept`)).status).toBe(403);
    expect(ids(await offers(p))).not.toContain(own.id);

    const blocked = await provider();
    const blockedReq = await make(u);
    await ctx.http.put(`/v1/blocks/${blocked.id}`).set(bearer(u.token)).expect(204);
    expect(ids(await offers(blocked))).not.toContain(blockedReq.id);
    expect((await post(blocked, `/v1/roadside/requests/${blockedReq.id}/accept`)).status).toBe(404);

    const busy = await provider();
    const reqs = [await make(await user()), await make(await user()), await make(await user())];
    await post(busy, `/v1/roadside/requests/${reqs[0]!.id}/accept`).expect(200);
    await post(busy, `/v1/roadside/requests/${reqs[1]!.id}/accept`).expect(200);
    const third = await post(busy, `/v1/roadside/requests/${reqs[2]!.id}/accept`);
    expect(third.status).toBe(409);
    expect(JSON.stringify(third.body)).toContain('provider_busy');
    // Releasing hands the request back to the open list.
    expect((await post(busy, `/v1/roadside/requests/${reqs[0]!.id}/release`).expect(200)).body.status).toBe('requested');
    expect(ids(await offers(p))).toContain(reqs[0]!.id);
    await post(busy, `/v1/roadside/requests/${reqs[0]!.id}/release`).expect(404);
  });
});

describe('shared position', () => {
  it('is shared only with the provider consent, and erased when withdrawn or when the job ends', async () => {
    const u = await user();
    const p = await provider();
    const req = await make(u);
    await post(p, `/v1/roadside/requests/${req.id}/location`, { lat: -1.7, lng: 29.2 }).expect(404);
    await post(p, `/v1/roadside/requests/${req.id}/accept`).expect(200);
    // No consent yet: refused, nothing stored.
    const refused = await post(p, `/v1/roadside/requests/${req.id}/location`, { lat: -1.7, lng: 29.2 });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain('location_consent_required');
    expect((await get(u, `/v1/roadside/requests/${req.id}`)).body.providerLocation).toBeNull();
    // Only the provider consents (not the requester).
    await ctx.http.put(`/v1/roadside/requests/${req.id}/location-consent`).set(bearer(u.token)).send({ granted: true }).expect(404);
    const on = await ctx.http.put(`/v1/roadside/requests/${req.id}/location-consent`).set(bearer(p.token)).send({ granted: true }).expect(200);
    expect(on.body.locationSharing).toBe(true);
    await post(p, `/v1/roadside/requests/${req.id}/location`, { lat: -1.7, lng: 29.2 }).expect(204);
    await post(p, `/v1/roadside/requests/${req.id}/location`, { lat: 95, lng: 29.2 }).expect(400);
    const seen = (await get(u, `/v1/roadside/requests/${req.id}`)).body;
    expect(seen.providerLocation).toMatchObject({ lat: -1.7, lng: 29.2 });
    // The provider never sees a position field for the requester position other than the one of the request.
    expect((await get(p, `/v1/roadside/requests/${req.id}`)).body.providerLocation).toBeNull();
    // Withdrawing erases the last point.
    await ctx.http.put(`/v1/roadside/requests/${req.id}/location-consent`).set(bearer(p.token)).send({ granted: false }).expect(200);
    expect((await get(u, `/v1/roadside/requests/${req.id}`)).body.providerLocation).toBeNull();
    const row = await ctx.sql.query(`SELECT last_lat, last_lng FROM roadside_requests WHERE id = $1`, [req.id]);
    expect(row.rows[0]).toEqual({ last_lat: null, last_lng: null });
    // Consent again, then the job ends: erased.
    await ctx.http.put(`/v1/roadside/requests/${req.id}/location-consent`).set(bearer(p.token)).send({ granted: true }).expect(200);
    await post(p, `/v1/roadside/requests/${req.id}/location`, { lat: -1.71, lng: 29.21 }).expect(204);
    await post(p, `/v1/roadside/requests/${req.id}/done`).expect(200);
    const after = await ctx.sql.query(`SELECT last_lat, location_consent FROM roadside_requests WHERE id = $1`, [req.id]);
    expect(after.rows[0]).toEqual({ last_lat: null, location_consent: false });
    await post(p, `/v1/roadside/requests/${req.id}/location`, { lat: -1.7, lng: 29.2 }).expect(409);
  });
});

describe('expiry and export', () => {
  it('reads as expired right away and is closed by maintenance; an accepted request does not expire', async () => {
    const u = await user();
    const p = await provider();
    const stale = await make(u);
    const kept = await make(u, { kind: 'tow' });
    await post(p, `/v1/roadside/requests/${kept.id}/accept`).expect(200);
    await ctx.sql.query(`UPDATE roadside_requests SET expires_at = now() - interval '1 minute' WHERE id = ANY($1::uuid[])`, [[stale.id, kept.id]]);
    expect((await get(u, `/v1/roadside/requests/${stale.id}`)).body.status).toBe('expired');
    expect(ids(await offers(p))).not.toContain(stale.id);
    await post(p, `/v1/roadside/requests/${stale.id}/accept`).expect(409);
    await post(u, `/v1/roadside/requests/${stale.id}/cancel`).expect(409);
    await ctx.app.get(MaintenanceService).runOnce();
    const rows = await ctx.sql.query(`SELECT id, status FROM roadside_requests WHERE id = ANY($1::uuid[])`, [[stale.id, kept.id]]);
    const by = Object.fromEntries(rows.rows.map((r: { id: string; status: string }) => [r.id, r.status]));
    expect(by[stale.id]).toBe('expired');
    expect(by[kept.id]).toBe('accepted');
    // An expired request frees the slot of the open limit.
    const v = await user();
    const one = await make(v);
    await make(v);
    await make(v);
    await ctx.sql.query(`UPDATE roadside_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [one.id]);
    await make(v);
  });

  it('is part of the data export, without any coordinate', async () => {
    const u = await user();
    const p = await provider();
    const req = await make(u);
    await post(p, `/v1/roadside/requests/${req.id}/accept`).expect(200);
    const exp = await get(u, '/v1/me/export').expect(200);
    expect(exp.body.mobilityExtra.roadsideRequests).toMatchObject([{ id: req.id, role: 'requester', kind: 'battery', status: 'accepted', label: POS.label }]);
    expect(JSON.stringify(exp.body.mobilityExtra)).not.toMatch(/"lat"|"lng"/);
    const exp2 = await get(p, '/v1/me/export').expect(200);
    expect(exp2.body.mobilityExtra.roadsideRequests[0]).toMatchObject({ role: 'provider' });
  });
});

describe('provider privacy', () => {
  it('hides the requester position, label and note from the provider once the job is no longer under way', async () => {
    const u = await user();
    const p = await provider();
    const req = await make(u);
    await post(p, `/v1/roadside/requests/${req.id}/accept`).expect(200);
    const done = (await post(p, `/v1/roadside/requests/${req.id}/done`).expect(200)).body;
    expect(done.note).toBeNull();
    expect(done.position).toEqual({ lat: 0, lng: 0, label: '' });
    expect((await get(u, `/v1/roadside/requests/${req.id}`)).body).toMatchObject({ note: NOTE, position: { label: POS.label } });
  });
});

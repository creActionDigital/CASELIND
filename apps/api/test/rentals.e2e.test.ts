import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

interface TU {
  token: string;
  id: string;
  handle: string;
}

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}
const post = (u: TU, path: string, body?: object) => ctx.http.post(path).set(bearer(u.token)).send(body ?? {});
const get = (u: TU, path: string) => ctx.http.get(path).set(bearer(u.token));

let n = 0;
/** An organisation of an arbitrary kind: renting vehicles does not depend on it. */
async function createOrg(owner: TU, extra: Record<string, unknown> = {}): Promise<string> {
  const slug = `loc-${Date.now().toString(36)}-${++n}`;
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: 'Goma Location', kind: 'other', ...extra }).expect(201);
  return res.body.id;
}
async function addMember(orgId: string, owner: TU, m: TU, role: string): Promise<void> {
  await post(owner, `/v1/orgs/${orgId}/invitations`, { handle: m.handle, role }).expect(201);
  await post(m, `/v1/me/org-invitations/${orgId}/accept`).expect(200);
}

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function upload(u: TU, purpose: string): Promise<string> {
  const up = await ctx.http.post('/v1/media/uploads').set(bearer(u.token)).send({ purpose, mime: 'image/png', sizeBytes: TINY_PNG.length }).expect(201);
  await ctx.http.put(up.body.uploadUrl).set(bearer(u.token)).set('X-Upload-Token', up.body.uploadToken).set('Content-Type', 'application/octet-stream').send(TINY_PNG).expect(200);
  return up.body.assetId;
}

const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const vehicle = (extra: Record<string, unknown> = {}) => ({
  title: 'Toyota RAV4 2019',
  kind: 'car',
  make: 'Toyota',
  model: 'RAV4',
  year: 2019,
  seats: 5,
  transmission: 'auto',
  fuel: 'petrol',
  dailyRateMinor: 5000,
  depositMinor: 20000,
  city: 'Goma',
  description: 'Climatisée, kilométrage illimité en ville.',
  ...extra,
});
const makeVehicle = async (owner: TU, orgId: string, extra: Record<string, unknown> = {}) =>
  (await post(owner, `/v1/orgs/${orgId}/rentals`, vehicle(extra)).expect(201)).body as { id: string };
const rent = (u: TU, vehicleId: string, from: number, to: number, extra: Record<string, unknown> = {}) =>
  post(u, `/v1/rentals/${vehicleId}/bookings`, { startsOn: day(from), endsOn: day(to), ...extra });
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe('organisation side', () => {
  it('manages vehicles with catalog.manage, whatever the kind of organisation', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const media = await upload(owner, 'listing');
    const v = await post(owner, `/v1/orgs/${org}/rentals`, vehicle({ mediaIds: [media] })).expect(201);
    expect(v.body).toMatchObject({ title: 'Toyota RAV4 2019', kind: 'car', dailyRateMinor: 5000, currency: 'USD', depositMinor: 20000, active: true, mediaIds: [media] });
    expect(v.body.photoUrls).toHaveLength(1);
    expect(v.body.paymentNote).toContain('sur place');

    // Someone else's upload, a wrong purpose, bad numbers: refused.
    const other = await user();
    await post(owner, `/v1/orgs/${org}/rentals`, vehicle({ mediaIds: [await upload(other, 'listing')] })).expect(400);
    await post(owner, `/v1/orgs/${org}/rentals`, vehicle({ mediaIds: [await upload(owner, 'avatar')] })).expect(400);
    await post(owner, `/v1/orgs/${org}/rentals`, vehicle({ dailyRateMinor: 0 })).expect(400);
    await post(owner, `/v1/orgs/${org}/rentals`, vehicle({ kind: 'boat' })).expect(400);
    await post(owner, `/v1/orgs/${org}/rentals`, vehicle({ mediaIds: Array.from({ length: 5 }, () => media) })).expect(400);

    // Rights: a sales member manages, an employee does not, an outsider does not even see the organisation.
    const sales = await user();
    const employee = await user();
    await addMember(org, owner, sales, 'sales');
    await addMember(org, owner, employee, 'employee');
    await post(sales, `/v1/orgs/${org}/rentals`, vehicle({ title: 'Moto Yamaha', kind: 'moto', dailyRateMinor: 1500 })).expect(201);
    expect((await post(employee, `/v1/orgs/${org}/rentals`, vehicle())).status).toBe(403);
    expect((await get(employee, `/v1/orgs/${org}/rentals`)).status).toBe(403);
    expect((await get(other, `/v1/orgs/${org}/rentals`)).status).toBe(404);
    expect((await get(owner, `/v1/orgs/${org}/rentals`)).body.items).toHaveLength(2);

    // Update, partial and with null to clear; foreign vehicles cannot be touched through another organisation.
    const up = await ctx.http.patch(`/v1/orgs/${org}/rentals/${v.body.id}`).set(bearer(owner.token)).send({ dailyRateMinor: 6000, depositMinor: null, mediaIds: [] }).expect(200);
    expect(up.body).toMatchObject({ dailyRateMinor: 6000, depositMinor: null, photoUrls: [], title: 'Toyota RAV4 2019' });
    await ctx.http.patch(`/v1/orgs/${org}/rentals/${v.body.id}`).set(bearer(owner.token)).send({}).expect(400);
    const other2 = await user();
    const org2 = await createOrg(other2);
    await ctx.http.patch(`/v1/orgs/${org2}/rentals/${v.body.id}`).set(bearer(other2.token)).send({ title: 'Volé' }).expect(404);
  });
});

describe('search and availability', () => {
  it('filters by city, kind and free period, and computes the total on the server', async () => {
    const owner = await user();
    const org = await createOrg(owner, { kind: 'services' });
    const car = await makeVehicle(owner, org, { city: 'Goma' });
    const bike = await makeVehicle(owner, org, { title: 'Vélo', kind: 'bike', dailyRateMinor: 500, city: 'Bukavu' });
    const hidden = await makeVehicle(owner, org, { title: 'Hors service', active: false });
    const renter = await user();

    const all = await get(renter, '/v1/rentals?limit=50');
    expect(ids(all)).toEqual(expect.arrayContaining([car.id, bike.id]));
    expect(ids(all)).not.toContain(hidden.id);
    expect(ids(await get(renter, '/v1/rentals?city=bukav'))).toEqual([bike.id]);
    expect(ids(await get(renter, '/v1/rentals?kind=bike'))).toEqual([bike.id]);
    const period = await get(renter, `/v1/rentals?city=goma&from=${day(10)}&to=${day(12)}`);
    expect(period.body.items[0]).toMatchObject({ id: car.id, days: 3, totalMinor: 15000, dailyRateMinor: 5000 });
    expect((await get(renter, `/v1/rentals?from=${day(10)}`)).status).toBe(400);
    expect((await get(renter, `/v1/rentals?from=${day(12)}&to=${day(10)}`)).status).toBe(400);
    await ctx.http.get('/v1/rentals').expect(401);

    // Once confirmed, the period leaves the search and appears as busy on the detail (dates only).
    const b = (await rent(renter, car.id, 10, 12).expect(201)).body;
    expect(ids(await get(renter, `/v1/rentals?city=goma&from=${day(10)}&to=${day(12)}`))).toContain(car.id);
    await post(owner, `/v1/orgs/${org}/rental-bookings/${b.id}/confirm`).expect(200);
    expect(ids(await get(renter, `/v1/rentals?city=goma&from=${day(11)}&to=${day(11)}`))).not.toContain(car.id);
    expect(ids(await get(renter, `/v1/rentals?city=goma&from=${day(13)}&to=${day(14)}`))).toContain(car.id);
    const detail = await get(renter, `/v1/rentals/${car.id}?from=${day(13)}&to=${day(13)}`).expect(200);
    expect(detail.body.busy).toEqual([{ from: day(10), to: day(12) }]);
    expect(detail.body).toMatchObject({ days: 1, totalMinor: 5000 });
    expect(JSON.stringify(detail.body)).not.toContain(renter.handle);
    // A deactivated vehicle is gone from the public detail.
    await get(renter, `/v1/rentals/${hidden.id}`).expect(404);
    await get(renter, '/v1/rentals/not-a-uuid').expect(404);
  });

  it('only shows vehicles of active public organisations', async () => {
    const owner = await user();
    const org = await createOrg(owner, { visibility: 'private' });
    const v = await makeVehicle(owner, org);
    const renter = await user();
    expect(ids(await get(renter, '/v1/rentals?limit=50'))).not.toContain(v.id);
    await get(renter, `/v1/rentals/${v.id}`).expect(404);
    await rent(renter, v.id, 5, 6).expect(404);
  });

  it('paginates with a cursor', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const made = [await makeVehicle(owner, org, { city: 'Pagination' }), await makeVehicle(owner, org, { city: 'Pagination' }), await makeVehicle(owner, org, { city: 'Pagination' })];
    const renter = await user();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const q: string = `/v1/rentals?city=pagination&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page: { body: { nextCursor: string | null; items: { id: string }[] } } = await get(renter, q).expect(200);
      seen.push(...ids(page));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual(made.map((m) => m.id).sort());
  });
});

describe('bookings', () => {
  it('freezes the total on the server and refuses invalid periods', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const v = await makeVehicle(owner, org);
    const renter = await user();
    const ok = await rent(renter, v.id, 3, 5, { note: 'Retrait à l’aéroport', totalMinor: 1, status: 'confirmed' }).expect(201);
    expect(ok.body).toMatchObject({ status: 'requested', days: 3, totalMinor: 15000, dailyRateMinor: 5000, depositMinor: 20000, currency: 'USD', renter: null });
    expect(ok.body.paymentNote).toContain('sur place');
    // A later price change does not touch an existing booking.
    await ctx.http.patch(`/v1/orgs/${org}/rentals/${v.id}`).set(bearer(owner.token)).send({ dailyRateMinor: 9000 }).expect(200);
    expect((await get(renter, '/v1/me/rental-bookings')).body.items[0]).toMatchObject({ id: ok.body.id, totalMinor: 15000 });

    await rent(renter, v.id, 5, 3).expect(400);
    await rent(renter, v.id, -2, 1).expect(400);
    await rent(renter, v.id, 1, 31).expect(400);
    await rent(renter, v.id, 1, 30).expect(201); // 30 days exactly
    await post(renter, `/v1/rentals/${v.id}/bookings`, { startsOn: '2026-02-31', endsOn: '2026-03-01' }).expect(400);
    await post(renter, `/v1/rentals/${v.id}/bookings`, { startsOn: day(2), endsOn: day(3), note: 'x'.repeat(201) }).expect(400);
    await ctx.http.post(`/v1/rentals/${v.id}/bookings`).send({ startsOn: day(2), endsOn: day(3) }).expect(401);
  });

  it('refuses a confirmation over a confirmed period, and a request over one', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const v = await makeVehicle(owner, org);
    const [r1, r2, r3] = [await user(), await user(), await user()];
    const b1 = (await rent(r1, v.id, 10, 14).expect(201)).body;
    const b2 = (await rent(r2, v.id, 14, 16).expect(201)).body; // overlaps b1 on day 14, both only requested
    const b3 = (await rent(r3, v.id, 15, 17).expect(201)).body;
    await post(owner, `/v1/orgs/${org}/rental-bookings/${b1.id}/confirm`).expect(200);
    const clash = await post(owner, `/v1/orgs/${org}/rental-bookings/${b2.id}/confirm`);
    expect(clash.status).toBe(409);
    expect(JSON.stringify(clash.body)).toContain('unavailable');
    // Adjacent days are fine.
    await post(owner, `/v1/orgs/${org}/rental-bookings/${b3.id}/confirm`).expect(200);
    // A request over a confirmed period is refused at once; the day after is open.
    const late = await rent(await user(), v.id, 12, 13);
    expect(late.status).toBe(409);
    await rent(await user(), v.id, 18, 19).expect(201);
    // Concurrent confirmation of two overlapping requests: exactly one wins.
    const v2 = await makeVehicle(owner, org);
    const [a, b] = await Promise.all([rent(await user(), v2.id, 20, 22), rent(await user(), v2.id, 21, 23)]);
    const results = await Promise.all([a, b].map((x) => post(owner, `/v1/orgs/${org}/rental-bookings/${x.body.id}/confirm`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('follows the cycle with the right transitions and rights', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const v = await makeVehicle(owner, org);
    const renter = await user();
    const stranger = await user();
    const employee = await user();
    await addMember(org, owner, employee, 'employee');
    const b = (await rent(renter, v.id, 0, 1).expect(201)).body; // starts today
    const step = (a: string, u: TU = owner) => post(u, `/v1/orgs/${org}/rental-bookings/${b.id}/${a}`);

    // Rights: only catalog.manage on the organisation owning the vehicle.
    expect((await step('confirm', employee)).status).toBe(403);
    expect((await step('confirm', stranger)).status).toBe(404);
    const org2 = await createOrg(await user());
    expect((await post(owner, `/v1/orgs/${org2}/rental-bookings/${b.id}/confirm`)).status).toBe(404);
    expect((await get(owner, `/v1/orgs/${org}/rental-bookings`)).body.items[0].renter.handle).toBe(renter.handle);
    expect((await get(employee, `/v1/orgs/${org}/rental-bookings`)).status).toBe(403);
    expect((await get(owner, `/v1/orgs/${org}/rental-bookings?status=confirmed`)).body.items).toHaveLength(0);
    expect((await post(stranger, `/v1/rental-bookings/${b.id}/cancel`)).status).toBe(404);

    expect((await step('pickup')).status).toBe(409);
    expect((await step('confirm')).body.status).toBe('confirmed');
    expect((await step('confirm')).status).toBe(409);
    expect((await step('return')).status).toBe(409);
    expect((await step('pickup')).body.status).toBe('picked_up');
    // After the pick-up nobody can cancel.
    expect((await post(renter, `/v1/rental-bookings/${b.id}/cancel`)).status).toBe(409);
    expect((await step('cancel')).status).toBe(409);
    expect((await step('return')).body.status).toBe('returned');
    expect((await get(renter, '/v1/me/rental-bookings?status=returned')).body.items.map((i: { id: string }) => i.id)).toEqual([b.id]);

    // Pick-up before the first day is refused.
    const future = (await rent(renter, v.id, 5, 6).expect(201)).body;
    await post(owner, `/v1/orgs/${org}/rental-bookings/${future.id}/confirm`).expect(200);
    expect((await post(owner, `/v1/orgs/${org}/rental-bookings/${future.id}/pickup`)).status).toBe(409);

    // Decline, renter cancellation (frees the dates), organisation cancellation.
    const d = (await rent(renter, v.id, 8, 9).expect(201)).body;
    expect((await post(owner, `/v1/orgs/${org}/rental-bookings/${d.id}/decline`)).body.status).toBe('declined');
    const c = (await rent(renter, v.id, 8, 9).expect(201)).body;
    await post(owner, `/v1/orgs/${org}/rental-bookings/${c.id}/confirm`).expect(200);
    expect((await rent(await user(), v.id, 8, 8)).status).toBe(409);
    expect((await post(renter, `/v1/rental-bookings/${c.id}/cancel`)).body.status).toBe('cancelled');
    await rent(await user(), v.id, 8, 8).expect(201);
    const e = (await rent(renter, v.id, 40, 41).expect(201)).body;
    expect((await post(owner, `/v1/orgs/${org}/rental-bookings/${e.id}/cancel`)).body.status).toBe('cancelled');

    // Generic notifications, and an audit trail without any note.
    const notes = JSON.stringify((await get(owner, '/v1/notifications')).body);
    expect(notes).toContain('Location de véhicule');
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action LIKE 'rental.%'`);
    expect(audit.rows.length).toBeGreaterThan(5);
  });

  it('limits live requests per renter', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const v = await makeVehicle(owner, org);
    const renter = await user();
    for (let i = 0; i < 5; i++) await rent(renter, v.id, 100 + i * 3, 101 + i * 3).expect(201);
    const sixth = await rent(renter, v.id, 200, 201);
    expect(sixth.status).toBe(409);
    expect(JSON.stringify(sixth.body)).toContain('booking_limit');
  });

  it('appears in the data export', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const v = await makeVehicle(owner, org);
    const renter = await user();
    await rent(renter, v.id, 4, 5, { note: 'Pour l’export' }).expect(201);
    const exp = await get(renter, '/v1/me/export').expect(200);
    expect(exp.body.mobilityExtra.rentalBookings).toMatchObject([{ vehicleTitle: 'Toyota RAV4 2019', totalMinor: 10000, status: 'requested' }]);
  });
});

describe('stale requests', () => {
  it('refuses to confirm a request whose first day has passed, and maintenance closes it', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const v = await makeVehicle(owner, org);
    const renter = await user();
    const stale = (await rent(renter, v.id, 1, 2).expect(201)).body;
    const fresh = (await rent(renter, v.id, 10, 11).expect(201)).body;
    await ctx.sql.query(`UPDATE rental_bookings SET starts_on = current_date - 2, ends_on = current_date - 1 WHERE id = $1`, [stale.id]);
    await post(owner, `/v1/orgs/${org}/rental-bookings/${stale.id}/confirm`).expect(409);
    await ctx.app.get(MaintenanceService).runOnce();
    const status = async (id: string) => (await ctx.sql.query(`SELECT status FROM rental_bookings WHERE id = $1`, [id])).rows[0].status;
    expect(await status(stale.id)).toBe('cancelled');
    expect(await status(fresh.id)).toBe('requested');
  });
});

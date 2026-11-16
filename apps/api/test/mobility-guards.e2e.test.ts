import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TU;
interface TU {
  token: string;
  id: string;
}
const toUser = async (token: string): Promise<TU> => {
  const me = await ctx.http.get('/v1/me').set(bearer(token)).expect(200);
  return { token, id: me.body.id };
};
const user = async () => toUser((await signUp(ctx)).tokens.accessToken);
const post = (u: TU, path: string, body?: object) => ctx.http.post(path).set(bearer(u.token)).send(body ?? {});
const get = (u: TU, path: string) => ctx.http.get(path).set(bearer(u.token));

beforeAll(async () => {
  ctx = await createTestContext();
  const a = await signUp(ctx);
  await ctx.sql.query(`UPDATE users SET roles = ARRAY['user','admin'] WHERE email = $1`, [a.identifier]);
  admin = await toUser(a.tokens.accessToken);
});
afterAll(async () => {
  await ctx.close();
});

const PICKUP = { lat: -1.6585, lng: 29.2205, label: 'Place du 3 Août' };
const DROPOFF = { lat: -1.68, lng: 29.24, label: 'Aéroport de Goma' };

async function driver(): Promise<TU> {
  const d = await user();
  await ctx.http.put('/v1/mobility/driver').set(bearer(d.token)).send({ vehicleKind: 'moto', comfort: false, make: 'Bajaj', plate: 'GOM-1234', color: 'rouge', zone: 'Goma' }).expect(200);
  await ctx.sql.query(`INSERT INTO kyc_profiles (user_id, level) VALUES ($1, 1) ON CONFLICT (user_id) DO UPDATE SET level = 1`, [d.id]);
  await post(admin, `/v1/admin/mobility/drivers/${d.id}/decision`, { decision: 'approve' }).expect(200);
  await post(d, '/v1/mobility/driver/online', { online: true }).expect(200);
  await post(d, '/v1/mobility/driver/location', { lat: -1.659, lng: 29.221 }).expect(204);
  return d;
}

describe('ride state machine and roles', () => {
  it('refuses out-of-order steps and the wrong party, leaving the ride untouched', async () => {
    const d = await driver();
    const rider = await user();
    const stranger = await user();
    const r = (await post(rider, '/v1/rides', { pickup: PICKUP, dropoff: DROPOFF, vehicle: 'moto' }).expect(201)).body as { id: string };
    const status = async () => (await get(rider, `/v1/rides/${r.id}`).expect(200)).body.status as string;

    // A rider is not a driver: cannot accept; a user with no driver profile neither.
    expect((await post(rider, `/v1/rides/${r.id}/accept`)).status).toBeGreaterThanOrEqual(403);
    expect((await post(stranger, `/v1/rides/${r.id}/accept`)).status).toBeGreaterThanOrEqual(403);
    // Not accepted yet: the driver is not on the ride (404), nothing to rate, a stranger sees no ride.
    expect((await post(d, `/v1/rides/${r.id}/complete`)).status).toBe(404);
    expect((await post(rider, `/v1/rides/${r.id}/rating`, { rating: 5 })).status).toBe(409);
    await get(stranger, `/v1/rides/${r.id}`).expect(404);
    expect(await status()).toBe('requested');

    await post(d, `/v1/rides/${r.id}/accept`).expect(200);
    // The rider cannot drive the ride; the driver cannot finish a ride never started.
    expect((await post(rider, `/v1/rides/${r.id}/arriving`)).status).toBeGreaterThanOrEqual(403);
    expect((await post(d, `/v1/rides/${r.id}/complete`)).status).toBe(409);
    expect((await post(rider, `/v1/rides/${r.id}/complete`)).status).toBeGreaterThanOrEqual(403);
    // A second driver cannot take a ride already accepted.
    const d2 = await driver();
    expect((await post(d2, `/v1/rides/${r.id}/accept`)).status).toBe(409);
    expect(await status()).toBe('accepted');
  });
});

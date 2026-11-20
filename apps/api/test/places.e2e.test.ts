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
async function createOrg(owner: TU, extra: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const res = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug: uniq('lieu'), name: 'Lieu', kind: 'shop', ...extra })
    .expect(201);
  return { id: res.body.id, slug: res.body.slug };
}

// Goma (RDC), the pilot city.
const GOMA = { lat: -1.6585, lng: 29.2205 };
const places = (u: TU, qs: string) => ctx.http.get(`/v1/places?${qs}`).set(bearer(u.token));
const around = `lat=${GOMA.lat}&lng=${GOMA.lng}`;
const idsOf = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe('organisation location', () => {
  it('is set, moved, relabelled and removed by org.profile.edit holders only', async () => {
    const owner = await user();
    const employee = await user();
    const stranger = await user();
    const org = await createOrg(owner);
    await ctx.http.post(`/v1/orgs/${org.id}/invitations`).set(bearer(owner.token)).send({ handle: employee.handle, role: 'employee' }).expect(201);
    await ctx.http.post(`/v1/me/org-invitations/${org.id}/accept`).set(bearer(employee.token)).expect(200);

    const url = `/v1/orgs/${org.id}/location`;
    await ctx.http.patch(url).set(bearer(owner.token)).send({ label: 'x' }).expect(404); // nothing to patch yet
    const created = await ctx.http.post(url).set(bearer(owner.token)).send({ ...GOMA, label: 'Avenue du Rond-Point' }).expect(201);
    expect(created.body).toEqual({ ...GOMA, label: 'Avenue du Rond-Point' });
    await ctx.http.post(url).set(bearer(owner.token)).send(GOMA).expect(409);
    const moved = await ctx.http.patch(url).set(bearer(owner.token)).send({ lat: -1.67 }).expect(200);
    expect(moved.body).toEqual({ lat: -1.67, lng: GOMA.lng, label: 'Avenue du Rond-Point' });
    const unlabeled = await ctx.http.patch(url).set(bearer(owner.token)).send({ label: null }).expect(200);
    expect(unlabeled.body.label).toBeNull();

    await ctx.http.post(url).set(bearer(employee.token)).send(GOMA).expect(403);
    await ctx.http.patch(url).set(bearer(employee.token)).send({ lat: 0 }).expect(403);
    await ctx.http.delete(url).set(bearer(stranger.token)).expect(404);
    await ctx.http.post(url).send(GOMA).expect(401);
    await ctx.http.patch(url).set(bearer(owner.token)).send({}).expect(400);
    await ctx.http.post(url).set(bearer(owner.token)).send({ lat: 91, lng: 0 }).expect(400);

    const audit = await ctx.sql.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'org.updated' AND metadata->>'orgId' = $1 AND metadata->'fields' ? 'location'`,
      [org.id],
    );
    expect(audit.rows[0].n).toBe(3);

    await ctx.http.delete(url).set(bearer(owner.token)).expect(204);
    await ctx.http.delete(url).set(bearer(owner.token)).expect(204); // idempotent
    const row = await ctx.sql.query('SELECT lat, lng, location_label FROM organizations WHERE id = $1', [org.id]);
    expect(row.rows[0]).toEqual({ lat: null, lng: null, location_label: null });
  });
});

describe('GET /v1/places', () => {
  it('lists public active organisations nearest first, within the radius, never private or suspended ones', async () => {
    const owner = await user();
    const viewer = await user();
    const tag = uniq('zq');
    const mk = async (name: string, lat: number, lng: number, extra: Record<string, unknown> = {}) => {
      const o = await createOrg(owner, { name: `${tag} ${name}`, ...extra });
      await ctx.http.post(`/v1/orgs/${o.id}/location`).set(bearer(owner.token)).send({ lat, lng }).expect(201);
      return o;
    };
    const centre = await mk('Centre', GOMA.lat, GOMA.lng);
    const twoKm = await mk('Deux km', GOMA.lat - 0.018, GOMA.lng); // about 2.0 km south
    await mk('Bukavu', -2.5, 28.85); // about 100 km away
    await mk('Privee', GOMA.lat + 0.001, GOMA.lng, { visibility: 'private' });
    const susp = await mk('Suspendue', GOMA.lat + 0.002, GOMA.lng);
    await ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [susp.id]);
    await createOrg(owner, { name: `${tag} Sans lieu` }); // no location

    const res = await places(viewer, `${around}&radiusKm=10&q=${tag}`).expect(200);
    expect(idsOf(res)).toEqual([centre.id, twoKm.id]);
    expect(res.body.items[0].distanceKm).toBeLessThan(0.01);
    expect(res.body.items[1].distanceKm).toBeGreaterThan(1.9);
    expect(res.body.items[1].distanceKm).toBeLessThan(2.1);
    expect(res.body.items[0]).toMatchObject({ slug: centre.slug, kind: 'shop', lat: GOMA.lat, lng: GOMA.lng });
    expect(res.body.nextCursor).toBeNull();

    // Radius: 1 km keeps only the centre; 50 km still excludes Bukavu.
    expect(idsOf(await places(viewer, `${around}&radiusKm=1&q=${tag}`).expect(200))).toEqual([centre.id]);
    expect((await places(viewer, `${around}&radiusKm=50&q=${tag}`).expect(200)).body.items).toHaveLength(2);
    await places(viewer, `${around}&radiusKm=51`).expect(400);
    await places(viewer, 'lat=95&lng=0').expect(400);

    // Filters.
    const hotel = await mk('Hotel', GOMA.lat + 0.009, GOMA.lng, { kind: 'hotel' });
    expect(idsOf(await places(viewer, `${around}&kind=hotel&q=${tag}`).expect(200))).toEqual([hotel.id]);
    expect(idsOf(await places(viewer, `${around}&q=${tag}%20Deux`).expect(200))).toEqual([twoKm.id]);

    // Pagination by (distance, id).
    const p1 = await places(viewer, `${around}&q=${tag}&limit=2`).expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toEqual(expect.any(String));
    const p2 = await places(viewer, `${around}&q=${tag}&limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    expect([...idsOf(p1), ...idsOf(p2)]).toEqual([centre.id, hotel.id, twoKm.id]); // 0 km, 1 km, 2 km
    await places(viewer, `${around}&cursor=garbage`).expect(400);

    await ctx.http.get(`/v1/places?${around}`).expect(401);
  });

  it('hides the organisations of an owner blocked with the caller and stores no user position', async () => {
    const owner = await user();
    const viewer = await user();
    const tag = uniq('bk');
    const o = await createOrg(owner, { name: tag });
    await ctx.http.post(`/v1/orgs/${o.id}/location`).set(bearer(owner.token)).send(GOMA).expect(201);
    expect((await places(viewer, `${around}&q=${tag}`).expect(200)).body.items).toHaveLength(1);
    await ctx.http.put(`/v1/blocks/${owner.id}`).set(bearer(viewer.token)).expect(204);
    expect((await places(viewer, `${around}&q=${tag}`).expect(200)).body.items).toHaveLength(0);
    // Only places someone chose to publish or save carry `lat`/`lng`: organisations, the service area a
    // provider publishes (lot 9), the favourite addresses a rider saves (lot 11, exported and purged) and the
    // optional place of a classified ad its owner publishes (lot 15).
    // No table tracks where a user is; ride and driver positions use their own bounded columns (lot 11).
    const cols = await ctx.sql.query(
      `SELECT DISTINCT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('lat', 'lng', 'latitude', 'longitude')
       ORDER BY table_name`,
    );
    // roadside_requests: the position the user sends with a breakdown request, shared with the consent given at that moment (lot 11 bis).
    expect(cols.rows.map((r) => r.table_name)).toEqual(['listings', 'mobility_favorite_places', 'organizations', 'roadside_requests', 'service_offers']);
  });
});

describe('reading the organisation location', () => {
  it('returns null then the location to members only, and exposes it on Org but not PublicOrg', async () => {
    const owner = await user();
    const stranger = await user();
    const org = await createOrg(owner);
    const url = `/v1/orgs/${org.id}/location`;
    const empty = await ctx.http.get(url).set(bearer(owner.token)).expect(200);
    expect(empty.body).toBeNull();
    expect((await ctx.http.get(`/v1/orgs/${org.id}`).set(bearer(owner.token)).expect(200)).body.location).toBeNull();
    await ctx.http.post(url).set(bearer(owner.token)).send({ ...GOMA, label: 'Centre' }).expect(201);
    const got = await ctx.http.get(url).set(bearer(owner.token)).expect(200);
    expect(got.body).toEqual({ ...GOMA, label: 'Centre' });
    expect((await ctx.http.get(`/v1/orgs/${org.id}`).set(bearer(owner.token)).expect(200)).body.location).toEqual({ ...GOMA, label: 'Centre' });
    const pub = await ctx.http.get(`/v1/public/orgs/${org.slug}`).expect(200);
    expect(pub.body.location).toBeUndefined();
    await ctx.http.get(url).set(bearer(stranger.token)).expect(404);
    await ctx.http.get(url).expect(401);
  });
});

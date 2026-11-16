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
}
async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id };
}

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function upload(u: TU, purpose: string): Promise<string> {
  const up = await ctx.http.post('/v1/media/uploads').set(bearer(u.token)).send({ purpose, mime: 'image/png', sizeBytes: TINY_PNG.length }).expect(201);
  await ctx.http.put(up.body.uploadUrl).set(bearer(u.token)).set('X-Upload-Token', up.body.uploadToken).set('Content-Type', 'application/octet-stream').send(TINY_PNG).expect(200);
  return up.body.assetId;
}

const ad = (extra: Record<string, unknown> = {}) => ({ kind: 'property_rent', title: 'Studio meublé', description: 'Proche du centre', priceMinor: 25_000, currency: 'USD', city: 'Goma', ...extra });
const create = (u: TU, body: Record<string, unknown>) => ctx.http.post('/v1/listings').set(bearer(u.token)).send(body);
const list = (u: TU, qs = '') => ctx.http.get(`/v1/listings${qs}`).set(bearer(u.token));
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe('classified ads (lot 15)', () => {
  it('needs a session and validates the body', async () => {
    await ctx.http.get('/v1/listings').expect(401);
    const a = await user();
    await create(a, ad({ title: 'ab' })).expect(400);
    await create(a, ad({ kind: 'boat' })).expect(400);
    await create(a, ad({ currency: null })).expect(400); // price without currency
    await create(a, ad({ latitude: 1 })).expect(400); // latitude without longitude
    await create(a, ad({ kind: 'lost' })).expect(400); // lost items carry no price
    await create(a, ad({ mediaIds: [crypto.randomUUID()] })).expect(400); // not an own upload
  });

  it('publishes, lists with filters and keyset pages, and returns photos in order', async () => {
    const [a, b] = [await user(), await user()];
    const m1 = await upload(a, 'listing');
    const m2 = await upload(a, 'listing');
    const rent = await create(a, ad({ title: 'Villa Himbi', city: 'Goma', priceMinor: 90_000, mediaIds: [m2, m1] })).expect(201);
    expect(rent.body).toMatchObject({ kind: 'property_rent', status: 'active', mine: true, priceMinor: 90_000, mediaIds: [m2, m1] });
    const car = await create(a, ad({ kind: 'vehicle', title: 'Toyota Hilux 100%', city: 'Bukavu', priceMinor: 1_200_000 })).expect(201);
    const lost = await create(a, { kind: 'lost', title: 'Clés perdues', city: 'Goma', description: 'Porte-clés bleu' }).expect(201);
    expect(lost.body).toMatchObject({ priceMinor: null, currency: null });

    const seen = await list(b).expect(200);
    expect(ids(seen)).toEqual(expect.arrayContaining([rent.body.id, car.body.id, lost.body.id]));
    expect(seen.body.items.find((i: { id: string }) => i.id === rent.body.id).mine).toBe(false);
    expect(ids(await list(b, '?kind=vehicle'))).toContain(car.body.id);
    expect(ids(await list(b, '?kind=vehicle'))).not.toContain(rent.body.id);
    expect(ids(await list(b, '?city=bukavu'))).toEqual([car.body.id]);
    expect(ids(await list(b, '?q=%25'))).toEqual([car.body.id]); // wildcard is literal: only "100%"
    expect(ids(await list(b, '?currency=USD&minPriceMinor=100000&maxPriceMinor=1500000'))).toEqual([car.body.id]);

    const p1 = await list(b, '?limit=2').expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await list(b, `?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect(ids(p2).filter((id) => ids(p1).includes(id))).toEqual([]);
    await list(b, '?cursor=garbage').expect(400);
  });

  it('only the owner edits or closes; closed ads leave the listing but stay visible to their owner', async () => {
    const [a, b] = [await user(), await user()];
    const l = (await create(a, ad()).expect(201)).body;
    await ctx.http.patch(`/v1/listings/${l.id}`).set(bearer(b.token)).send({ title: 'Pirate' }).expect(404);
    await ctx.http.post(`/v1/listings/${l.id}/close`).set(bearer(b.token)).expect(404);

    const edited = await ctx.http.patch(`/v1/listings/${l.id}`).set(bearer(a.token)).send({ title: 'Studio rénové' }).expect(200);
    expect(edited.body).toMatchObject({ title: 'Studio rénové', description: 'Proche du centre', priceMinor: 25_000 }); // untouched fields stay
    await ctx.http.patch(`/v1/listings/${l.id}`).set(bearer(a.token)).send({ currency: null }).expect(400);
    await ctx.http.patch(`/v1/listings/${l.id}`).set(bearer(a.token)).send({ priceMinor: null, currency: null }).expect(200);

    await ctx.http.post(`/v1/listings/${l.id}/close`).set(bearer(a.token)).expect(200);
    await ctx.http.post(`/v1/listings/${l.id}/close`).set(bearer(a.token)).expect(200);
    expect(ids(await list(b))).not.toContain(l.id);
    await ctx.http.get(`/v1/listings/${l.id}`).set(bearer(b.token)).expect(404);
    expect((await ctx.http.get(`/v1/listings/${l.id}`).set(bearer(a.token)).expect(200)).body.status).toBe('closed');
    expect(ids(await ctx.http.get('/v1/listings/mine').set(bearer(a.token)).expect(200))).toContain(l.id);
    await ctx.http.get('/v1/listings/not-a-uuid').set(bearer(a.token)).expect(404);
  });

  it('hides ads of blocked users in both directions', async () => {
    const [a, b] = [await user(), await user()];
    const l = (await create(a, ad()).expect(201)).body;
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.get(`/v1/listings/${l.id}`).set(bearer(b.token)).expect(404);
    expect(ids(await list(b))).not.toContain(l.id);
    await ctx.http.delete(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.get(`/v1/listings/${l.id}`).set(bearer(b.token)).expect(200);
  });

  it('caps active ads per owner (closing frees a slot) and audits', async () => {
    const a = await user();
    const first = (await create(a, ad({ title: 'Annonce 0' })).expect(201)).body;
    for (let i = 1; i < 20; i += 1) await create(a, ad({ title: `Annonce ${i}` })).expect(201);
    const over = await create(a, ad({ title: 'Une de trop' })).expect(409);
    expect(over.body.error.details).toEqual({ reason: 'listing_limit', max: 20 });
    await ctx.http.post(`/v1/listings/${first.id}/close`).set(bearer(a.token)).expect(200);
    await create(a, ad({ title: 'Place libérée' })).expect(201);
    const n = async (action: string) => Number((await ctx.sql.query('SELECT count(*) AS n FROM audit_events WHERE action = $1 AND subject_user_id = $2', [action, a.id])).rows[0].n);
    expect(await n('listing.created')).toBe(21);
    expect(await n('listing.closed')).toBe(1);
  });

  it('can be reported, hidden by a moderator, and restored', async () => {
    const [a, b, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    const l = (await create(a, ad()).expect(201)).body;
    await ctx.http.post('/v1/reports').set(bearer(b.token)).send({ targetType: 'listing', targetId: l.id, reason: 'spam' }).expect(201);
    const act = (action: string) => ctx.http.post('/v1/admin/moderation/actions').set(bearer(mod.token)).send({ targetType: 'listing', targetId: l.id, action });
    await act('hide').expect(200);
    await ctx.http.get(`/v1/listings/${l.id}`).set(bearer(b.token)).expect(404);
    expect((await ctx.http.get(`/v1/listings/${l.id}`).set(bearer(a.token)).expect(200)).body.id).toBe(l.id);
    await act('restore').expect(200);
    await ctx.http.get(`/v1/listings/${l.id}`).set(bearer(b.token)).expect(200);
  });

  it('is part of the personal data export (with the budget), and only the owner\'s own', async () => {
    const [a, b] = [await user(), await user()];
    await create(a, ad({ title: 'Mon annonce' })).expect(201);
    await create(b, ad({ title: 'Annonce d\'un autre' })).expect(201);
    await ctx.http.put('/v1/finance/budget').set(bearer(a.token)).send({ currency: 'USD', limitMinor: 700 }).expect(200);
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200)).body;
    expect(exp.listings.map((l: { title: string }) => l.title)).toEqual(['Mon annonce']);
    expect(exp.budgets).toEqual([{ currency: 'USD', limitMinor: 700 }]);
  });

  it('keeps up to 5 private alerts and notifies matching people on a new ad (not the author, not blocked ones)', async () => {
    const [author, seeker, other, blocked] = [await user(), await user(), await user(), await user()];
    const alerts = '/v1/me/listing-alerts';
    await ctx.http.post(alerts).set(bearer(seeker.token)).send({}).expect(400);
    const a = (await ctx.http.post(alerts).set(bearer(seeker.token)).send({ q: 'studio', city: 'goma' }).expect(201)).body;
    expect(a).toMatchObject({ q: 'studio', city: 'goma', kind: null });
    await ctx.http.post(alerts).set(bearer(other.token)).send({ kind: 'vehicle' }).expect(201);
    await ctx.http.post(alerts).set(bearer(author.token)).send({ city: 'Goma' }).expect(201);
    await ctx.http.post(alerts).set(bearer(blocked.token)).send({ city: 'Goma' }).expect(201);
    for (let i = 0; i < 4; i++) await ctx.http.post(alerts).set(bearer(seeker.token)).send({ kind: 'lost' }).expect(201);
    await ctx.http.post(alerts).set(bearer(seeker.token)).send({ q: 'x' }).expect(409);
    expect((await ctx.http.get(alerts).set(bearer(other.token)).expect(200)).body.items).toHaveLength(1);
    await ctx.http.put(`/v1/blocks/${blocked.id}`).set(bearer(author.token)).expect(204);

    await create(author, ad({ description: 'Texte confidentiel' })).expect(201);
    const count = async (u: TU) => Number((await ctx.sql.query(`SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND title LIKE 'Nouvelle annonce correspondant%'`, [u.id])).rows[0].n);
    expect([await count(seeker), await count(other), await count(author), await count(blocked)]).toEqual([1, 0, 0, 0]);
    expect(JSON.stringify((await ctx.sql.query('SELECT title, body FROM notifications WHERE user_id = $1', [seeker.id])).rows)).not.toContain('confidentiel');

    const audits = await ctx.sql.query(`SELECT metadata::text AS m FROM audit_events WHERE subject_user_id = $1 AND action = 'listing.alert_created'`, [seeker.id]);
    expect(audits.rows.length).toBe(5);
    expect(JSON.stringify(audits.rows)).not.toContain('studio');
    expect((await ctx.http.get('/v1/me/export').set(bearer(seeker.token)).expect(200)).body.listingAlerts).toHaveLength(5);

    await ctx.http.delete(`${alerts}/${a.id}`).set(bearer(other.token)).expect(204); // not theirs: no effect
    expect((await ctx.http.get(alerts).set(bearer(seeker.token)).expect(200)).body.items).toHaveLength(5);
    await ctx.http.delete(`${alerts}/${a.id}`).set(bearer(seeker.token)).expect(204);
    await ctx.http.delete(`${alerts}/${a.id}`).set(bearer(seeker.token)).expect(204);
    expect((await ctx.http.get(alerts).set(bearer(seeker.token)).expect(200)).body.items).toHaveLength(4);
  });

  it('handles visit appointments: request, limits, confirm with place, decline, cancel, rights, blocks, export', async () => {
    const [owner, v, w, stranger, blocked] = [await user(), await user(), await user(), await user(), await user()];
    const l = (await create(owner, ad()).expect(201)).body;
    const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const ask = (u: TU, listingId: string, body: Record<string, unknown>) => ctx.http.post(`/v1/listings/${listingId}/visits`).set(bearer(u.token)).send(body);
    const act = (u: TU, id: string, a: string, body: Record<string, unknown> = {}) => ctx.http.post(`/v1/visits/${id}/${a}`).set(bearer(u.token)).send(body);

    await ask(v, l.id, { scheduledAt: at(-1) }).expect(400); // past
    await ask(v, l.id, { scheduledAt: at(61 * 24) }).expect(400); // beyond 60 days
    await ask(v, l.id, { scheduledAt: at(48), message: 'x'.repeat(301) }).expect(400);
    await ask(owner, l.id, { scheduledAt: at(48) }).expect(400); // own ad
    await ctx.http.put(`/v1/blocks/${blocked.id}`).set(bearer(owner.token)).expect(204);
    await ask(blocked, l.id, { scheduledAt: at(48) }).expect(404);

    const visit = (await ask(v, l.id, { scheduledAt: at(48), message: 'Secret message' }).expect(201)).body;
    expect(visit).toMatchObject({ status: 'requested', role: 'visitor', place: null, listingTitle: 'Studio meublé' });
    await ask(v, l.id, { scheduledAt: at(72) }).expect(409); // one open request per ad
    const notes = async (u: TU) => (await ctx.sql.query(`SELECT title, body FROM notifications WHERE user_id = $1 AND data::text LIKE '%visitId%'`, [u.id])).rows;
    expect(await notes(owner)).toHaveLength(1);
    expect(JSON.stringify(await notes(owner))).not.toContain('Secret');

    // Only the two parties see it.
    await ctx.http.get(`/v1/visits/${visit.id}`).set(bearer(stranger.token)).expect(404);
    await act(stranger, visit.id, 'cancel').expect(404);
    expect((await ctx.http.get('/v1/me/visits').set(bearer(owner.token)).expect(200)).body.items[0]).toMatchObject({ role: 'owner', other: { id: v.id } });
    expect((await ctx.http.get('/v1/me/visits').set(bearer(stranger.token)).expect(200)).body.items).toHaveLength(0);

    // The visitor cannot confirm; the owner confirms with a place, visible to both.
    await act(v, visit.id, 'confirm', { place: 'Chez moi' }).expect(404);
    const ok = (await act(owner, visit.id, 'confirm', { place: 'Café du Lac, avenue de la Paix' }).expect(200)).body;
    expect(ok).toMatchObject({ status: 'confirmed', place: 'Café du Lac, avenue de la Paix' });
    expect((await ctx.http.get(`/v1/visits/${visit.id}`).set(bearer(v.token)).expect(200)).body.place).toBe('Café du Lac, avenue de la Paix');
    expect(JSON.stringify(await notes(v))).not.toContain('Café');
    await act(owner, visit.id, 'decline').expect(409); // not pending any more
    const audits = JSON.stringify((await ctx.sql.query(`SELECT metadata::text FROM audit_events WHERE action LIKE 'listing.visit_%'`)).rows);
    expect(audits).not.toContain('Café');
    expect(audits).not.toContain('Secret');
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(v.token)).expect(200)).body.listingVisits;
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({ role: 'visitor', status: 'confirmed' });

    // The visitor cannot cancel within the last hour; the owner can; then a new request is possible.
    await ctx.sql.query(`UPDATE listing_visits SET scheduled_at = now() + interval '30 minutes' WHERE id = $1`, [visit.id]);
    await act(v, visit.id, 'cancel').expect(409);
    expect((await act(owner, visit.id, 'cancel').expect(200)).body.status).toBe('cancelled');
    expect(await notes(v)).toHaveLength(2); // confirmed, then cancelled

    // Decline, then visitor cancel.
    const d = (await ask(v, l.id, { scheduledAt: at(48) }).expect(201)).body;
    expect((await act(owner, d.id, 'decline').expect(200)).body.status).toBe('declined');
    const c = (await ask(v, l.id, { scheduledAt: at(48) }).expect(201)).body;
    expect((await act(v, c.id, 'cancel').expect(200)).body.status).toBe('cancelled');
    await act(v, c.id, 'cancel').expect(409);

    // 5 pending requests at most per visitor.
    for (let i = 0; i < 5; i++) {
      const o = await user();
      const li = (await create(o, ad()).expect(201)).body;
      await ask(w, li.id, { scheduledAt: at(48) }).expect(201);
    }
    const last = (await create(owner, ad()).expect(201)).body;
    await ask(w, last.id, { scheduledAt: at(48) }).expect(409);

    // Deleted with the ad.
    await ctx.sql.query('DELETE FROM listings WHERE id = $1', [l.id]);
    expect(Number((await ctx.sql.query('SELECT count(*) AS n FROM listing_visits WHERE listing_id = $1', [l.id])).rows[0].n)).toBe(0);
  });

  it('hides visits once a block exists and refuses confirm/decline on an inactive ad (cancel stays possible)', async () => {
    const [owner, v] = [await user(), await user()];
    const l = (await create(owner, ad()).expect(201)).body;
    const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const ask = (u: TU, listingId: string) => ctx.http.post(`/v1/listings/${listingId}/visits`).set(bearer(u.token)).send({ scheduledAt: at(48) });
    const act = (u: TU, id: string, a: string) => ctx.http.post(`/v1/visits/${id}/${a}`).set(bearer(u.token)).send({});
    const a = (await ask(v, l.id).expect(201)).body;
    await ctx.sql.query(`UPDATE listings SET hidden = true WHERE id = $1`, [l.id]);
    expect((await act(owner, a.id, 'confirm').expect(409)).body.error.details.reason).toBe('listing_inactive');
    await act(owner, a.id, 'decline').expect(409);
    expect((await act(v, a.id, 'cancel').expect(200)).body.status).toBe('cancelled');
    await ctx.sql.query(`UPDATE listings SET hidden = false WHERE id = $1`, [l.id]);
    const b = (await ask(v, l.id).expect(201)).body;
    await ctx.http.put(`/v1/blocks/${v.id}`).set(bearer(owner.token)).expect(204);
    await ctx.http.get(`/v1/visits/${b.id}`).set(bearer(v.token)).expect(404);
    await act(owner, b.id, 'confirm').expect(404);
    await act(v, b.id, 'cancel').expect(404);
    expect((await ctx.http.get('/v1/me/visits').set(bearer(owner.token)).expect(200)).body.items).toHaveLength(0);
  });

  it('is off when the flag is off', async () => {
    const a = await user();
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'listings'`);
    try {
      await list(a).expect(403);
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'listings'`);
    }
  });
});

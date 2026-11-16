import { randomUUID } from 'node:crypto';
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
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id };
}
const auth = (u: TU) => bearer(u.token);

describe('hardening lots 13-16', () => {
  it('finance: needs a session on every route and rejects absurd or missing inputs', async () => {
    const a = await user();
    await ctx.http.put('/v1/finance/budget').send({ currency: 'USD', limitMinor: 100 }).expect(401);
    await ctx.http.delete('/v1/finance/budget?currency=USD').expect(401);
    const put = (body: Record<string, unknown>) => ctx.http.put('/v1/finance/budget').set(auth(a)).send(body);
    await put({ currency: 'USD', limitMinor: 1e18 }).expect(400); // beyond a safe integer
    await put({ currency: 'USD', limitMinor: -5 }).expect(400);
    await put({ currency: 'USD' }).expect(400);
    await ctx.http.delete('/v1/finance/budget').set(auth(a)).expect(400); // currency is required
    await ctx.http.delete('/v1/finance/budget?currency=ZZZ').set(auth(a)).expect(400);
    await ctx.http.get('/v1/finance/summary?month=2026-1').set(auth(a)).expect(400);
  });

  it('communities: session required, direct chats cannot be published, long text refused, page size bounded', async () => {
    const [o, p] = [await user(), await user()];
    await ctx.http.get('/v1/communities').expect(401);
    await ctx.http.post(`/v1/communities/${randomUUID()}/join`).expect(401);
    const dm = await ctx.http.post('/v1/conversations').set(auth(o)).send({ kind: 'direct', userId: p.id });
    expect(dm.status, JSON.stringify(dm.body)).toBe(201);
    const pub = await ctx.http.put(`/v1/conversations/${dm.body.id}/community`).set(auth(o)).send({});
    expect([400, 403, 404, 409]).toContain(pub.status); // never 200 on a direct chat
    const g = (await ctx.http.post('/v1/conversations').set(auth(o)).send({ kind: 'group', title: 'Long', memberIds: [] }).expect(201)).body.id;
    await ctx.http.put(`/v1/conversations/${g}/community`).set(auth(o)).send({ description: 'x'.repeat(2001) }).expect(400);
    await ctx.http.get('/v1/communities?limit=100000').set(auth(p)).expect(400);
  });

  it('listings: bad ids are 404 not 500, absurd prices refused, close is owner-only and repeatable', async () => {
    const [o, s] = [await user(), await user()];
    const body = { kind: 'property_rent', title: 'Studio meublé', description: 'Proche du centre', priceMinor: 25_000, currency: 'USD', city: 'Goma' };
    await ctx.http.post('/v1/listings').set(auth(o)).send({ ...body, priceMinor: 1e18 }).expect(400);
    await ctx.http.post('/v1/listings').set(auth(o)).send({ ...body, priceMinor: -1 }).expect(400);
    await ctx.http.get('/v1/listings/not-a-uuid').set(auth(s)).expect(404);
    const l = (await ctx.http.post('/v1/listings').set(auth(o)).send(body).expect(201)).body;
    await ctx.http.post(`/v1/listings/${l.id}/close`).set(auth(s)).expect(404); // not the owner
    await ctx.http.patch(`/v1/listings/${l.id}`).set(auth(s)).send({ title: 'Volé par un autre' }).expect(404);
    expect((await ctx.http.get(`/v1/listings/${l.id}`).set(auth(o)).expect(200)).body.title).toBe('Studio meublé');
    await ctx.http.post(`/v1/listings/${l.id}/close`).set(auth(o)).expect(200);
    const again = await ctx.http.post(`/v1/listings/${l.id}/close`).set(auth(o));
    expect([200, 409]).toContain(again.status);
  });

  it('listings: a buyer cannot accept their own offer, and an agreed offer is final', async () => {
    const [o, b] = [await user(), await user()];
    const l = (await ctx.http.post('/v1/listings').set(auth(o)).send({ kind: 'property_rent', title: 'Villa', description: 'Belle villa', priceMinor: 25_000, currency: 'USD', city: 'Goma' }).expect(201)).body;
    const off = (await ctx.http.post(`/v1/listings/${l.id}/offers`).set(auth(b)).send({ amountMinor: 20_000 }).expect(201)).body;
    const act = (u: TU, a: string) => ctx.http.post(`/v1/offers/${off.id}/${a}`).set(auth(u)).send({});
    expect([403, 404, 409]).toContain((await act(b, 'accept')).status);
    await act(o, 'accept').expect(200);
    await act(o, 'accept').expect(409);
    await act(o, 'decline').expect(409);
  });

  it('jobs: another organisation cannot read or move our applications, offers or interviews (cross-org)', async () => {
    const [ownerA, ownerB, cand] = [await user(), await user(), await user()];
    const mk = async (o: TU, n: string) => (await ctx.http.post('/v1/orgs').set(auth(o)).send({ slug: `x-${n}-${Date.now().toString(36)}`, name: 'Entreprise', kind: 'other' }).expect(201)).body.id as string;
    const [orgA, orgB] = [await mk(ownerA, 'a'), await mk(ownerB, 'b')];
    const j = (await ctx.http.post(`/v1/orgs/${orgA}/jobs`).set(auth(ownerA)).send({ title: 'Comptable', description: 'Compta', city: 'Goma', contractType: 'full_time' }).expect(201)).body;
    await ctx.http.put('/v1/me/job-profile').set(auth(cand)).send({ headline: 'Comptable', summary: 's', skills: ['Excel'], city: 'Goma', experience: 'x', education: 'y' }).expect(200);
    const app = (await ctx.http.post(`/v1/jobs/${j.id}/applications`).set(auth(cand)).send({ message: 'Bonjour' }).expect(201)).body;
    // Org B's owner, with a valid org id of their own, targets org A's ids.
    expect((await ctx.http.get(`/v1/orgs/${orgB}/jobs/${j.id}/applications`).set(auth(ownerB)).expect(200)).body.items).toEqual([]); // scoped by org: no leak
    await ctx.http.post(`/v1/orgs/${orgB}/job-applications/${app.id}/status`).set(auth(ownerB)).send({ status: 'rejected' }).expect(404);
    await ctx.http.patch(`/v1/orgs/${orgB}/jobs/${j.id}`).set(auth(ownerB)).send({ title: 'Détourné' }).expect(404);
    await ctx.http.post(`/v1/orgs/${orgB}/jobs/${j.id}/close`).set(auth(ownerB)).expect(404);
    await ctx.http.post(`/v1/orgs/${orgB}/job-applications/${app.id}/interviews`).set(auth(ownerB)).send({ startsAt: new Date(Date.now() + 86_400_000 * 3).toISOString(), durationMin: 30 }).expect(404);
    const st = await ctx.http.get('/v1/me/job-applications').set(auth(cand)).expect(200);
    expect(st.body.items[0].status).toBe('submitted');
  });

  it('jobs: closed offers refuse applications; unknown ids are 404', async () => {
    const [owner, cand] = [await user(), await user()];
    const org = (await ctx.http.post('/v1/orgs').set(auth(owner)).send({ slug: `c-${Date.now().toString(36)}`, name: 'Entreprise', kind: 'other' }).expect(201)).body.id;
    const j = (await ctx.http.post(`/v1/orgs/${org}/jobs`).set(auth(owner)).send({ title: 'Chauffeur', description: 'Conduite', city: 'Goma', contractType: 'full_time' }).expect(201)).body;
    await ctx.http.put('/v1/me/job-profile').set(auth(cand)).send({ headline: 'Chauffeur', summary: 's', skills: ['Permis'], city: 'Goma', experience: 'x', education: 'y' }).expect(200);
    await ctx.http.post(`/v1/orgs/${org}/jobs/${j.id}/close`).set(auth(owner)).expect(200);
    const r = await ctx.http.post(`/v1/jobs/${j.id}/applications`).set(auth(cand)).send({ message: 'Tard' });
    expect([404, 409]).toContain(r.status);
    await ctx.http.post(`/v1/jobs/${randomUUID()}/applications`).set(auth(cand)).send({ message: 'x' }).expect(404);
    await ctx.http.post('/v1/me/job-applications/not-a-uuid/withdraw').set(auth(cand)).expect(404);
  });

  it('freelance: wrong party or foreign milestone cannot move a contract; milestone amounts must be positive', async () => {
    const [client, fl, other] = [await user(), await user(), await user()];
    const m = (await ctx.http.post('/v1/missions').set(auth(client)).send({ title: 'Logo', description: 'Identité', budgetMinor: 50_000, currency: 'USD' }).expect(201)).body;
    const p = (await ctx.http.post(`/v1/missions/${m.id}/proposals`).set(auth(fl)).send({ amountMinor: 40_000, deliveryDays: 7, message: 'ok' }).expect(201)).body;
    const acc = (b: Record<string, unknown>) => ctx.http.post(`/v1/proposals/${p.id}/accept`).set(auth(client)).send(b);
    await acc({ milestones: [{ title: 'A', amountMinor: 0 }, { title: 'B', amountMinor: 40_000 }] }).expect(400);
    await acc({ milestones: [{ title: 'A', amountMinor: -10_000 }, { title: 'B', amountMinor: 50_000 }] }).expect(400); // sums to the price, one negative
    const c = (await acc({}).expect(201)).body;
    const mid = c.milestones[0].id;
    const step = (u: TU, a: string, id = mid) => ctx.http.post(`/v1/freelance-contracts/${c.id}/milestones/${id}/${a}`).set(auth(u)).send({});
    expect([403, 404, 409]).toContain((await step(client, 'deliver')).status); // client cannot deliver
    expect([403, 404, 409]).toContain((await step(fl, 'approve')).status); // freelancer cannot approve
    await step(other, 'deliver').expect(404);
    await step(fl, 'deliver', randomUUID()).expect(404);
    expect((await ctx.http.get(`/v1/freelance-contracts/${c.id}`).set(auth(client)).expect(200)).body.milestones[0].status).toBe('pending');
  });
});

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

const mission = (extra: Record<string, unknown> = {}) => ({ title: 'Logo et charte graphique', description: 'Identité visuelle', budgetMinor: 50_000, currency: 'USD', ...extra });
const postMission = (u: TU, body: Record<string, unknown> = mission()) => ctx.http.post('/v1/missions').set(bearer(u.token)).send(body);
const propose = (u: TU, missionId: string, body: Record<string, unknown> = { amountMinor: 40_000, deliveryDays: 7, message: 'Je peux le faire' }) =>
  ctx.http.post(`/v1/missions/${missionId}/proposals`).set(bearer(u.token)).send(body);
const accept = (u: TU, proposalId: string, body: Record<string, unknown> = {}) => ctx.http.post(`/v1/proposals/${proposalId}/accept`).set(bearer(u.token)).send(body);
const ct = (u: TU, id: string) => ctx.http.get(`/v1/freelance-contracts/${id}`).set(bearer(u.token));
const step = (u: TU, contractId: string, mid: string, action: string, body: Record<string, unknown> = {}) =>
  ctx.http.post(`/v1/freelance-contracts/${contractId}/milestones/${mid}/${action}`).set(bearer(u.token)).send(body);
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

/** client posts, freelancer proposes, client accepts with two milestones. */
async function awarded() {
  const [client, freelancer] = [await user(), await user()];
  const m = (await postMission(client).expect(201)).body;
  const p = (await propose(freelancer, m.id).expect(201)).body;
  const c = (await accept(client, p.id, { milestones: [{ title: 'Maquettes', amountMinor: 15_000 }, { title: 'Livraison finale', amountMinor: 25_000 }] }).expect(201)).body;
  return { client, freelancer, m, p, c };
}

describe('freelance missions and proposals (lot 16b)', () => {
  it('needs a session; validates the mission; caps open missions', async () => {
    await ctx.http.get('/v1/missions').expect(401);
    const u = await user();
    await postMission(u, mission({ title: 'ab' })).expect(400);
    await postMission(u, mission({ budgetMinor: 0 })).expect(400);
    await postMission(u, mission({ currency: 'ZZZ' })).expect(400);
    await postMission(u, mission({ deadline: '2001-01-01' })).expect(400);
    const ok = await postMission(u, mission({ deadline: '2099-01-01' })).expect(201);
    expect(ok.body).toMatchObject({ status: 'open', mine: true, proposalCount: 0, deadline: '2099-01-01', budgetMinor: 50_000 });
    for (let i = 1; i < 10; i += 1) await postMission(u, mission({ title: `Mission ${i}` })).expect(201);
    expect((await postMission(u, mission({ title: 'Une de trop' })).expect(409)).body.error.details).toEqual({ reason: 'mission_limit', max: 10 });
  });

  it('lists open missions with filters and pages; hides blocked clients and closed missions', async () => {
    const [client, seeker] = [await user(), await user()];
    const a = (await postMission(client, mission({ title: 'Traduction 100%', budgetMinor: 10_000 })).expect(201)).body;
    const b = (await postMission(client, mission({ title: 'Site vitrine', budgetMinor: 90_000, currency: 'CDF' })).expect(201)).body;
    const list = (qs = '') => ctx.http.get(`/v1/missions${qs}`).set(bearer(seeker.token));
    expect(ids(await list())).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ids(await list('?q=%25'))).toEqual([a.id]);
    expect(ids(await list('?currency=CDF'))).toContain(b.id);
    expect(ids(await list('?currency=CDF'))).not.toContain(a.id);
    expect(ids(await list('?minBudgetMinor=50000'))).toContain(b.id);
    expect(ids(await list('?minBudgetMinor=50000'))).not.toContain(a.id);
    const p1 = await list('?limit=1').expect(200);
    expect(ids(await list(`?limit=1&cursor=${p1.body.nextCursor}`))).not.toEqual(ids(p1));
    await list('?cursor=x').expect(400);

    await ctx.http.put(`/v1/blocks/${seeker.id}`).set(bearer(client.token)).expect(204);
    expect(ids(await list())).not.toContain(a.id);
    await ctx.http.get(`/v1/missions/${a.id}`).set(bearer(seeker.token)).expect(404);
    await ctx.http.delete(`/v1/blocks/${seeker.id}`).set(bearer(client.token)).expect(204);

    await ctx.http.post(`/v1/missions/${a.id}/close`).set(bearer(client.token)).expect(200);
    await ctx.http.post(`/v1/missions/${a.id}/close`).set(bearer(client.token)).expect(200);
    expect(ids(await list())).not.toContain(a.id);
    await ctx.http.post(`/v1/missions/${b.id}/close`).set(bearer(seeker.token)).expect(404);
  });

  it('edits an open mission (client only, untouched fields stay)', async () => {
    const [client, other] = [await user(), await user()];
    const m = (await postMission(client).expect(201)).body;
    const patch = (u: TU, body: Record<string, unknown>) => ctx.http.patch(`/v1/missions/${m.id}`).set(bearer(u.token)).send(body);
    await patch(other, { title: 'Pirate' }).expect(404);
    const r = await patch(client, { title: 'Logo seulement', budgetMinor: 30_000 }).expect(200);
    expect(r.body).toMatchObject({ title: 'Logo seulement', description: 'Identité visuelle', budgetMinor: 30_000, currency: 'USD' });
    await patch(client, { budgetMinor: -1 }).expect(400);
  });

  it('proposals: not on your own mission, once, withdrawable and re-proposable, private to the client', async () => {
    const [client, f1, f2] = [await user(), await user(), await user()];
    const m = (await postMission(client).expect(201)).body;
    await propose(client, m.id).expect(403);
    await propose(f1, m.id, { amountMinor: 0, deliveryDays: 7 }).expect(400);
    await propose(f1, m.id, { amountMinor: 100, deliveryDays: 0 }).expect(400);
    const p1 = (await propose(f1, m.id).expect(201)).body;
    expect(p1).toMatchObject({ status: 'proposed', amountMinor: 40_000, currency: 'USD', missionTitle: 'Logo et charte graphique' });
    expect((await propose(f1, m.id).expect(409)).body.error.details.reason).toBe('already_proposed');
    await propose(f2, m.id, { amountMinor: 35_000, deliveryDays: 10 }).expect(201);

    const seen = await ctx.http.get(`/v1/missions/${m.id}/proposals`).set(bearer(client.token)).expect(200);
    expect(seen.body.items).toHaveLength(2);
    await ctx.http.get(`/v1/missions/${m.id}/proposals`).set(bearer(f1.token)).expect(404); // competitors never see each other
    expect((await ctx.http.get(`/v1/missions/${m.id}`).set(bearer(client.token)).expect(200)).body.proposalCount).toBe(2);
    expect((await ctx.http.get(`/v1/missions/${m.id}`).set(bearer(f1.token)).expect(200)).body).toMatchObject({ proposalCount: null, myProposalId: p1.id });

    await ctx.http.post(`/v1/proposals/${p1.id}/withdraw`).set(bearer(f1.token)).expect(200);
    await ctx.http.post(`/v1/proposals/${p1.id}/withdraw`).set(bearer(f1.token)).expect(200);
    await ctx.http.post(`/v1/proposals/${p1.id}/withdraw`).set(bearer(f2.token)).expect(404);
    expect((await ctx.http.get(`/v1/missions/${m.id}/proposals`).set(bearer(client.token))).body.items).toHaveLength(1);
    const again = await propose(f1, m.id, { amountMinor: 38_000, deliveryDays: 5 }).expect(201);
    expect(again.body).toMatchObject({ id: p1.id, status: 'proposed', amountMinor: 38_000 });
    expect(ids(await ctx.http.get('/v1/me/proposals').set(bearer(f1.token)).expect(200))).toEqual([p1.id]);
  });
});

describe('freelance contracts (lot 16b)', () => {
  it('accepting opens the contract with milestones that add up, rejects the others, awards the mission', async () => {
    const [client, f1, f2, stranger] = [await user(), await user(), await user(), await user()];
    const m = (await postMission(client).expect(201)).body;
    const p1 = (await propose(f1, m.id).expect(201)).body;
    const p2 = (await propose(f2, m.id, { amountMinor: 45_000, deliveryDays: 5 }).expect(201)).body;
    await accept(stranger, p1.id).expect(404);
    await accept(f1, p1.id).expect(404);
    await accept(client, p1.id, { milestones: [{ title: 'Tout', amountMinor: 1 }] }).expect(400); // does not add up
    const c = (await accept(client, p1.id).expect(201)).body;
    expect(c).toMatchObject({ status: 'active', paymentMode: 'external', amountMinor: 40_000, role: 'client', milestones: [{ title: 'Livraison', amountMinor: 40_000, status: 'pending' }] });

    expect((await accept(client, p2.id).expect(409)).body.error.details.reason).toBe('proposal_not_open');
    const mAfter = (await ctx.http.get(`/v1/missions/${m.id}`).set(bearer(client.token)).expect(200)).body;
    expect(mAfter).toMatchObject({ status: 'awarded', contractId: c.id });
    expect((await ctx.http.get('/v1/me/proposals').set(bearer(f2.token)).expect(200)).body.items[0].status).toBe('rejected');
    await propose(stranger, m.id).expect(404); // awarded: no longer visible to newcomers
    await ctx.http.post(`/v1/missions/${m.id}/close`).set(bearer(client.token)).expect(409);

    await ct(stranger, c.id).expect(404);
    await ct(f2, c.id).expect(404);
    expect((await ct(f1, c.id).expect(200)).body.role).toBe('freelancer');
    expect(ids(await ctx.http.get('/v1/me/freelance-contracts').set(bearer(client.token)).expect(200))).toEqual([c.id]);
  });

  it('runs the milestone cycle: deliver, revision, deliver, approve; the last approval completes; each side reviews once', async () => {
    const { client, freelancer, c } = await awarded();
    const [m1, m2] = c.milestones as { id: string }[];
    await step(client, c.id, m1!.id, 'deliver').expect(404); // only the freelancer delivers
    await step(freelancer, c.id, m1!.id, 'approve').expect(404); // only the client approves
    await step(client, c.id, m1!.id, 'approve').expect(409); // nothing delivered yet
    await step(freelancer, c.id, m1!.id, 'deliver', { note: 'Voici les maquettes' }).expect(200);
    await step(client, c.id, m1!.id, 'revision', { note: 'ab' }).expect(400); // a real note is required
    await step(client, c.id, m1!.id, 'revision', { note: 'Changez les couleurs' }).expect(200);
    const afterRev = (await ct(freelancer, c.id).expect(200)).body.milestones[0];
    expect(afterRev).toMatchObject({ status: 'revision', note: 'Changez les couleurs' });
    await step(freelancer, c.id, m1!.id, 'deliver', { note: 'Couleurs changées' }).expect(200);
    await step(client, c.id, m1!.id, 'approve').expect(200);
    await step(client, c.id, m1!.id, 'approve').expect(409); // already approved

    expect((await ct(client, c.id)).body.status).toBe('active');
    await ctx.http.post(`/v1/freelance-contracts/${c.id}/review`).set(bearer(client.token)).send({ rating: 5 }).expect(409); // not completed yet
    await step(freelancer, c.id, m2!.id, 'deliver').expect(200);
    const done = (await step(client, c.id, m2!.id, 'approve').expect(200)).body;
    expect(done.status).toBe('completed');

    const review = (u: TU, body: Record<string, unknown>) => ctx.http.post(`/v1/freelance-contracts/${c.id}/review`).set(bearer(u.token)).send(body);
    await review(client, { rating: 6 }).expect(400);
    const r1 = (await review(client, { rating: 5, body: 'Excellent' }).expect(201)).body;
    expect(r1.myReview).toEqual({ rating: 5, body: 'Excellent' });
    expect(r1.theirReview).toBeNull();
    expect((await review(client, { rating: 4 }).expect(409)).body.error.details.reason).toBe('already_reviewed');
    const r2 = (await review(freelancer, { rating: 4 }).expect(201)).body;
    expect(r2.theirReview).toEqual({ rating: 5, body: 'Excellent' });
    await step(freelancer, c.id, m1!.id, 'deliver').expect(409); // completed contract is closed
  });

  it('cancel works until something is approved (idempotent); afterwards only a dispute', async () => {
    const a = await awarded();
    await ctx.http.post(`/v1/freelance-contracts/${a.c.id}/cancel`).set(bearer(a.freelancer.token)).expect(200);
    const second = await ctx.http.post(`/v1/freelance-contracts/${a.c.id}/cancel`).set(bearer(a.client.token)).expect(200);
    expect(second.body.status).toBe('cancelled');
    await step(a.freelancer, a.c.id, a.c.milestones[0].id, 'deliver').expect(409);

    const b = await awarded();
    await step(b.freelancer, b.c.id, b.c.milestones[0].id, 'deliver').expect(200);
    await step(b.client, b.c.id, b.c.milestones[0].id, 'approve').expect(200);
    expect((await ctx.http.post(`/v1/freelance-contracts/${b.c.id}/cancel`).set(bearer(b.client.token)).expect(409)).body.error.details.reason).toBe('has_approved_milestones');
  });

  it('disputes freeze the contract until an admin resolves them; money never moves', async () => {
    const { client, freelancer, c } = await awarded();
    const admin = await user(['user', 'admin']);
    const dispute = (u: TU, body: Record<string, unknown>) => ctx.http.post(`/v1/freelance-contracts/${c.id}/dispute`).set(bearer(u.token)).send(body);
    await dispute(client, { reason: 'ab' }).expect(400);
    const opened = (await dispute(freelancer, { reason: 'Le client ne répond plus depuis une semaine' }).expect(201)).body;
    expect(opened.status).toBe('disputed');
    expect(opened.dispute).toMatchObject({ status: 'open', outcome: null });
    await dispute(client, { reason: 'Un second litige' }).expect(409);
    await step(freelancer, c.id, c.milestones[0].id, 'deliver').expect(409);
    await ctx.http.post(`/v1/freelance-contracts/${c.id}/cancel`).set(bearer(client.token)).expect(409);

    await ctx.http.get('/v1/admin/freelance/disputes').set(bearer(client.token)).expect(403);
    const listed = await ctx.http.get('/v1/admin/freelance/disputes?status=open').set(bearer(admin.token)).expect(200);
    const d = listed.body.items.find((x: { contractId: string }) => x.contractId === c.id);
    expect(d).toMatchObject({ status: 'open', missionTitle: 'Logo et charte graphique' });
    const resolve = (u: TU, body: Record<string, unknown>) => ctx.http.post(`/v1/admin/freelance/disputes/${d.id}/resolve`).set(bearer(u.token)).send(body);
    await resolve(client, { outcome: 'resume', resolution: 'ok ok' }).expect(403);
    await resolve(admin, { outcome: 'refund', resolution: 'non' }).expect(400); // no money outcome exists
    const done = (await resolve(admin, { outcome: 'resume', resolution: 'Reprise du travail, échéance repoussée' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'resolved', outcome: 'resume' });
    await resolve(admin, { outcome: 'cancel', resolution: 'Encore' }).expect(409);
    expect((await ct(client, c.id)).body.status).toBe('active');
    await step(freelancer, c.id, c.milestones[0].id, 'deliver').expect(200);

    const again = (await dispute(client, { reason: 'Livrable non conforme du tout' }).expect(201)).body;
    const d2 = (await ctx.http.get('/v1/admin/freelance/disputes?status=open').set(bearer(admin.token))).body.items.find((x: { contractId: string }) => x.contractId === c.id);
    await ctx.http.post(`/v1/admin/freelance/disputes/${d2.id}/resolve`).set(bearer(admin.token)).send({ outcome: 'cancel', resolution: 'Contrat annulé' }).expect(200);
    expect(again.status).toBe('disputed');
    expect((await ct(freelancer, c.id)).body).toMatchObject({ status: 'cancelled', dispute: { status: 'resolved', outcome: 'cancel' } });
    const ledger = await ctx.sql.query(`SELECT count(*)::int AS n FROM journal_entries WHERE initiated_by = $1`, [client.id]);
    expect(ledger.rows[0].n).toBe(0);
  });

  it('dispute resolution: admin only, 500-char decision, both parties notified generically, audit without the decision text', async () => {
    const { client, freelancer, c } = await awarded();
    const admin = await user(['user', 'admin']);
    const mod = await user(['user', 'moderator']);
    await ctx.http.post(`/v1/freelance-contracts/${c.id}/dispute`).set(bearer(client.token)).send({ reason: 'Travail non livré à temps' }).expect(201);
    await ctx.http.get('/v1/admin/freelance/disputes').set(bearer(mod.token)).expect(403);
    const d = (await ctx.http.get('/v1/admin/freelance/disputes?status=open').set(bearer(admin.token)).expect(200)).body.items.find((x: { contractId: string }) => x.contractId === c.id);
    expect(JSON.stringify(d)).not.toContain('"message"');
    const resolve = (resolution: string) => ctx.http.post(`/v1/admin/freelance/disputes/${d.id}/resolve`).set(bearer(admin.token)).send({ outcome: 'cancel', resolution });
    await resolve('x'.repeat(501)).expect(400);
    const before = async (u: TU) => Number((await ctx.sql.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [u.id])).rows[0].n);
    const [nc, nf] = [await before(client), await before(freelancer)];
    await resolve('Décision SECRETE-XYZ').expect(200);
    expect(await before(client)).toBe(nc + 1);
    expect(await before(freelancer)).toBe(nf + 1);
    const audit = await ctx.sql.query(`SELECT metadata::text AS md FROM audit_events WHERE action = 'freelance.dispute_resolved'`);
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toContain('SECRETE-XYZ');
  });

  it('notifies, audits without content, exports only the account\'s own data, and can be reported, hidden and switched off', async () => {
    const { client, freelancer, m, c } = await awarded();
    const mod = await user(['user', 'moderator']);
    const notified = async (u: TU) => Number((await ctx.sql.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND category = 'job'`, [u.id])).rows[0].n);
    expect(await notified(client)).toBe(1); // new proposal
    expect(await notified(freelancer)).toBe(1); // proposal accepted
    await step(freelancer, c.id, c.milestones[0].id, 'deliver', { note: 'Secret de livraison' }).expect(200);
    expect(await notified(client)).toBe(2);

    const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE subject_user_id = $1 AND action LIKE 'freelance.%' ORDER BY occurred_at`, [freelancer.id]);
    expect(audits.rows.map((r: { action: string }) => r.action)).toEqual(['freelance.proposal_sent', 'freelance.milestone_delivered']);
    expect(JSON.stringify(audits.rows)).not.toContain('Secret de livraison');
    expect(JSON.stringify(audits.rows)).not.toContain('Je peux le faire');

    const exp = (await ctx.http.get('/v1/me/export').set(bearer(freelancer.token)).expect(200)).body.freelance;
    expect(exp.missions).toEqual([]);
    expect(exp.proposals).toHaveLength(1);
    expect(exp.proposals[0]).toMatchObject({ message: 'Je peux le faire', status: 'accepted' });
    expect(exp.contracts).toHaveLength(1);
    expect(exp.contracts[0]).toMatchObject({ role: 'freelancer', amountMinor: 40_000, status: 'active' });

    const stranger = await user();
    await ctx.http.post('/v1/reports').set(bearer(stranger.token)).send({ targetType: 'mission', targetId: m.id, reason: 'spam' }).expect(404); // awarded: not visible to strangers
    const open = (await postMission(client, mission({ title: 'Mission signalable' })).expect(201)).body;
    await ctx.http.post('/v1/reports').set(bearer(stranger.token)).send({ targetType: 'mission', targetId: open.id, reason: 'spam' }).expect(201);
    const act = (action: string) => ctx.http.post('/v1/admin/moderation/actions').set(bearer(mod.token)).send({ targetType: 'mission', targetId: open.id, action });
    await act('hide').expect(200);
    await ctx.http.get(`/v1/missions/${open.id}`).set(bearer(stranger.token)).expect(404);
    await ctx.http.get(`/v1/missions/${open.id}`).set(bearer(client.token)).expect(200);
    await act('restore').expect(200);

    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'freelance'`);
    try {
      await ctx.http.get('/v1/missions').set(bearer(stranger.token)).expect(403);
      await ctx.http.get(`/v1/freelance-contracts/${c.id}`).set(bearer(client.token)).expect(403);
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'freelance'`);
    }
  });
});

describe('mission categories (lot 16e)', () => {
  it('defaults to autre, validates, filters the list and can be changed while open', async () => {
    const [client, seeker] = [await user(), await user()];
    const a = (await postMission(client, mission({ title: 'Logo' , category: 'design' })).expect(201)).body;
    const b = (await postMission(client, mission({ title: 'Sans catégorie' })).expect(201)).body;
    expect(a.category).toBe('design');
    expect(b.category).toBe('autre');
    await postMission(client, mission({ category: 'cuisine' })).expect(400);
    const list = (qs: string) => ctx.http.get(`/v1/missions${qs}`).set(bearer(seeker.token));
    expect(ids(await list('?category=design').expect(200))).toEqual([a.id]);
    const autre = ids(await list('?category=autre').expect(200));
    expect(autre).toContain(b.id);
    expect(autre).not.toContain(a.id);
    await list('?category=cuisine').expect(400);
    const upd = await ctx.http.patch(`/v1/missions/${b.id}`).set(bearer(client.token)).send({ category: 'traduction' }).expect(200);
    expect(upd.body.category).toBe('traduction');
    await ctx.http.post(`/v1/missions/${b.id}/close`).set(bearer(client.token)).expect(200);
    await ctx.http.patch(`/v1/missions/${b.id}`).set(bearer(client.token)).send({ category: 'design' }).expect(409);
  });
});

describe('public freelancer profiles (lot 16e)', () => {
  const profile = (extra: Record<string, unknown> = {}) => ({ enabled: true, title: 'Designer graphique', skills: ['Figma', 'logo', 'figma'], categories: ['design'], rateMinor: 2_500, rateCurrency: 'USD', bio: 'Dix ans d’expérience', ...extra });
  const save = (u: TU, body: Record<string, unknown>) => ctx.http.put('/v1/me/freelance-profile').set(bearer(u.token)).send(body);
  const search = (u: TU, qs = '') => ctx.http.get(`/v1/freelancers${qs}`).set(bearer(u.token));

  it('is off by default, opt-in, validated, searchable and removable; exposes no contact data', async () => {
    const [fl, seeker] = [await user(), await user()];
    const blank = (await ctx.http.get('/v1/me/freelance-profile').set(bearer(fl.token)).expect(200)).body;
    expect(blank).toMatchObject({ enabled: false, title: '', skills: [], updatedAt: null });
    await ctx.http.get('/v1/freelancers').expect(401);
    expect(ids2(await search(seeker, '?skill=figma').expect(200))).not.toContain(fl.id);

    await save(fl, profile({ title: 'ab' })).expect(400);
    await save(fl, profile({ skills: Array.from({ length: 16 }, (_, i) => `s${i}`) })).expect(400);
    await save(fl, profile({ bio: 'x'.repeat(1001) })).expect(400);
    await save(fl, profile({ rateCurrency: 'EUR' })).expect(400);
    await save(fl, profile({ rateCurrency: null })).expect(400);
    await save(fl, profile({ categories: ['cuisine'] })).expect(400);

    const saved = (await save(fl, profile()).expect(200)).body;
    expect(saved).toMatchObject({ enabled: true, skills: ['figma', 'logo'], rateMinor: 2_500, rateCurrency: 'USD' });
    const found = await search(seeker, '?skill=figma').expect(200);
    expect(ids2(found)).toContain(fl.id);
    const item = found.body.items.find((i: { user: { id: string } }) => i.user.id === fl.id);
    expect(Object.keys(item.user).sort()).toEqual(['displayName', 'handle', 'id']);
    expect(JSON.stringify(item)).not.toMatch(/email|phone/i);
    expect(ids2(await search(seeker, '?category=design').expect(200))).toContain(fl.id);
    expect(ids2(await search(seeker, '?category=marketing').expect(200))).not.toContain(fl.id);
    expect(ids2(await search(seeker, '?q=graphique').expect(200))).toContain(fl.id);
    expect(ids2(await search(seeker, '?skill=cobol').expect(200))).not.toContain(fl.id);
    await search(seeker, '?category=cuisine').expect(400);

    // Blocked either way: hidden.
    await ctx.http.put(`/v1/blocks/${fl.id}`).set(bearer(seeker.token)).expect(204);
    expect(ids2(await search(seeker, '?skill=figma').expect(200))).not.toContain(fl.id);
    await ctx.http.delete(`/v1/blocks/${fl.id}`).set(bearer(seeker.token)).expect(204);
    await ctx.http.put(`/v1/blocks/${seeker.id}`).set(bearer(fl.token)).expect(204);
    expect(ids2(await search(seeker, '?skill=figma').expect(200))).not.toContain(fl.id);
    await ctx.http.delete(`/v1/blocks/${seeker.id}`).set(bearer(fl.token)).expect(204);

    // Disabling hides it but keeps my data; audits carry no content.
    await save(fl, profile({ enabled: false })).expect(200);
    expect(ids2(await search(seeker, '?skill=figma').expect(200))).not.toContain(fl.id);
    expect((await ctx.http.get('/v1/me/freelance-profile').set(bearer(fl.token)).expect(200)).body).toMatchObject({ enabled: false, title: 'Designer graphique' });
    const audits = await ctx.sql.query<{ action: string; metadata: unknown }>(`SELECT action, metadata FROM audit_events WHERE actor_user_id = $1 AND action LIKE 'freelance.profile_%' ORDER BY occurred_at`, [fl.id]);
    expect(audits.rows.map((r) => r.action)).toEqual(['freelance.profile_saved', 'freelance.profile_disabled']);
    expect(JSON.stringify(audits.rows)).not.toContain('Designer');
  });

  it('pages with a cursor, appears in the account export, and is behind the flag', async () => {
    const [a, b, seeker] = [await user(), await user(), await user()];
    await save(a, profile({ skills: ['pagetest'] })).expect(200);
    await save(b, profile({ skills: ['pagetest'] })).expect(200);
    const p1 = await search(seeker, '?skill=pagetest&limit=1').expect(200);
    expect(p1.body.items).toHaveLength(1);
    const p2 = await search(seeker, `?skill=pagetest&limit=1&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    expect(new Set([p1.body.items[0].user.id, p2.body.items[0].user.id])).toEqual(new Set([a.id, b.id]));
    const exp = await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200);
    expect(exp.body.freelance.profile).toMatchObject({ enabled: true, title: 'Designer graphique', skills: ['pagetest'] });
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'freelance'`);
    try {
      await search(seeker).expect(403);
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'freelance'`);
    }
  });
});
const ids2 = (res: { body: { items: { user: { id: string } }[] } }) => res.body.items.map((i) => i.user.id);

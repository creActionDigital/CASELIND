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
async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}
let n = 0;
async function createOrg(owner: TU): Promise<string> {
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `rh-${Date.now().toString(36)}-${++n}`, name: 'Entreprise RH', kind: 'other' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}
async function addMember(orgId: string, owner: TU, who: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(owner.token)).send({ handle: who.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(who.token)).expect(200);
}

const job = (extra: Record<string, unknown> = {}) => ({ title: 'Comptable', description: 'Tenue de la comptabilité', city: 'Goma', contractType: 'full_time', ...extra });
const post = (orgId: string, u: TU, body: Record<string, unknown>) => ctx.http.post(`/v1/orgs/${orgId}/jobs`).set(bearer(u.token)).send(body);
const cv = { headline: 'Comptable junior', summary: 'Trois ans en cabinet', skills: ['Excel', 'SYSCOHADA', 'Excel'], city: 'Goma', experience: 'Cabinet X', education: 'Licence' };
const saveCv = (u: TU, body: Record<string, unknown> = cv) => ctx.http.put('/v1/me/job-profile').set(bearer(u.token)).send(body);
const apply = (u: TU, jobId: string, body: Record<string, unknown> = { message: 'Bonjour' }) => ctx.http.post(`/v1/jobs/${jobId}/applications`).set(bearer(u.token)).send(body);
const setStatus = (orgId: string, u: TU, appId: string, status: string) =>
  ctx.http.post(`/v1/orgs/${orgId}/job-applications/${appId}/status`).set(bearer(u.token)).send({ status });
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe('jobs (lot 16a)', () => {
  it('needs hr.manage to publish; a non-member sees nothing; the body is validated', async () => {
    const [owner, hr, sales, stranger] = [await user(), await user(), await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org, owner, hr, 'hr');
    await addMember(org, owner, sales, 'sales');
    await ctx.http.get('/v1/jobs').expect(401);
    await post(org, sales, job()).expect(403);
    await post(org, stranger, job()).expect(404);
    await post(org, owner, job({ title: 'ab' })).expect(400);
    await post(org, owner, job({ contractType: 'slave' })).expect(400);
    await post(org, owner, job({ salaryMinMinor: 100 })).expect(400); // salary without currency
    await post(org, owner, job({ salaryMinMinor: 200, salaryMaxMinor: 100, currency: 'USD' })).expect(400);
    const ok = await post(org, hr, job({ salaryMinMinor: 30_000, salaryMaxMinor: 50_000, currency: 'USD' })).expect(201);
    expect(ok.body).toMatchObject({ status: 'open', applied: false, salary: { minMinor: 30_000, maxMinor: 50_000, currency: 'USD' }, org: { id: org, name: 'Entreprise RH' } });
  });

  it('lists open offers with filters and pages; closing or hiding removes them; private orgs are not listed', async () => {
    const [owner, seeker] = [await user(), await user()];
    const org = await createOrg(owner);
    const a = (await post(org, owner, job({ title: 'Chauffeur livreur', city: 'Bukavu', contractType: 'contract' })).expect(201)).body;
    const b = (await post(org, owner, job({ title: 'Stagiaire marketing 100%', contractType: 'internship' })).expect(201)).body;
    const list = (qs = '') => ctx.http.get(`/v1/jobs${qs}`).set(bearer(seeker.token));
    expect(ids(await list())).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ids(await list('?city=bukavu'))).toEqual([a.id]);
    expect(ids(await list('?contractType=internship'))).toEqual([b.id]);
    expect(ids(await list('?q=%25'))).toEqual([b.id]);
    const p1 = await list('?limit=1').expect(200);
    const p2 = await list(`?limit=1&cursor=${p1.body.nextCursor}`).expect(200);
    expect(ids(p2)).not.toEqual(ids(p1));
    await list('?cursor=x').expect(400);

    await ctx.http.post(`/v1/orgs/${org}/jobs/${a.id}/close`).set(bearer(owner.token)).expect(200);
    await ctx.http.post(`/v1/orgs/${org}/jobs/${a.id}/close`).set(bearer(owner.token)).expect(200);
    expect(ids(await list())).not.toContain(a.id);
    await ctx.http.get(`/v1/jobs/${a.id}`).set(bearer(seeker.token)).expect(404);
    expect(ids(await ctx.http.get(`/v1/orgs/${org}/jobs`).set(bearer(owner.token)).expect(200))).toContain(a.id);

    await ctx.sql.query(`UPDATE organizations SET visibility = 'private' WHERE id = $1`, [org]);
    expect(ids(await list())).not.toContain(b.id);
    await ctx.http.get(`/v1/jobs/${b.id}`).set(bearer(seeker.token)).expect(404);
  });

  it('edits an offer keeping untouched fields, and checks the salary against the stored values', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const j = (await post(org, owner, job({ salaryMinMinor: 100, salaryMaxMinor: 200, currency: 'USD' })).expect(201)).body;
    const edit = (body: Record<string, unknown>) => ctx.http.patch(`/v1/orgs/${org}/jobs/${j.id}`).set(bearer(owner.token)).send(body);
    const r = await edit({ title: 'Comptable senior' }).expect(200);
    expect(r.body).toMatchObject({ title: 'Comptable senior', description: 'Tenue de la comptabilité', salary: { minMinor: 100, maxMinor: 200 } });
    await edit({ salaryMinMinor: 300 }).expect(400); // above the stored max
    await edit({ currency: null }).expect(400);
    await edit({ salaryMinMinor: null, salaryMaxMinor: null, currency: null }).expect(200);
  });

  it('keeps a private CV: create, replace, delete; skills are de-duplicated', async () => {
    const u = await user();
    expect((await ctx.http.get('/v1/me/job-profile').set(bearer(u.token)).expect(200)).body).toEqual({ profile: null });
    await saveCv(u, { headline: 'x' }).expect(400);
    const saved = await saveCv(u).expect(200);
    expect(saved.body).toMatchObject({ headline: 'Comptable junior', skills: ['Excel', 'SYSCOHADA'] });
    await saveCv(u, { ...cv, headline: 'Comptable confirmé' }).expect(200);
    expect((await ctx.http.get('/v1/me/job-profile').set(bearer(u.token)).expect(200)).body.profile.headline).toBe('Comptable confirmé');
    await ctx.http.delete('/v1/me/job-profile').set(bearer(u.token)).expect(204);
    await ctx.http.delete('/v1/me/job-profile').set(bearer(u.token)).expect(204);
    expect((await ctx.http.get('/v1/me/job-profile').set(bearer(u.token)).expect(200)).body).toEqual({ profile: null });
  });

  it('applies once with a CV snapshot, never to its own organisation, and recruiters see the snapshot not the live CV', async () => {
    const [owner, hr, seeker, other] = [await user(), await user(), await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org, owner, hr, 'hr');
    const j = (await post(org, owner, job()).expect(201)).body;

    expect((await apply(seeker, j.id).expect(409)).body.error.details.reason).toBe('profile_required');
    await saveCv(seeker).expect(200);
    await saveCv(owner).expect(200);
    await apply(owner, j.id).expect(403);
    await apply(seeker, '00000000-0000-4000-8000-000000000000').expect(404);
    const app = await apply(seeker, j.id, { message: 'Je suis motivé' }).expect(201);
    expect(app.body).toMatchObject({ status: 'submitted', message: 'Je suis motivé', job: { id: j.id, title: 'Comptable', orgName: 'Entreprise RH' } });
    expect((await apply(seeker, j.id).expect(409)).body.error.details.reason).toBe('already_applied');
    expect((await ctx.http.get(`/v1/jobs/${j.id}`).set(bearer(seeker.token)).expect(200)).body.applied).toBe(true);

    await saveCv(seeker, { ...cv, headline: 'Directeur financier' }).expect(200); // edited after applying
    const rec = await ctx.http.get(`/v1/orgs/${org}/jobs/${j.id}/applications`).set(bearer(hr.token)).expect(200);
    expect(rec.body.items).toHaveLength(1);
    expect(rec.body.items[0]).toMatchObject({ applicant: { id: seeker.id }, cv: { headline: 'Comptable junior' } });
    await ctx.http.get(`/v1/orgs/${org}/jobs/${j.id}/applications`).set(bearer(other.token)).expect(404);
    await ctx.http.get(`/v1/orgs/${org}/jobs/${j.id}/applications`).set(bearer(seeker.token)).expect(404);

    const mine = await ctx.http.get('/v1/me/job-applications').set(bearer(seeker.token)).expect(200);
    expect(mine.body.items.map((a: { id: string }) => a.id)).toEqual([app.body.id]);
    expect(mine.body.items[0]).not.toHaveProperty('cv'); // the candidate list carries no snapshot
    const notified = await ctx.sql.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND category = 'job'`, [hr.id]);
    expect(notified.rows[0].n).toBe(1);
  });

  it('moves along the allowed transitions only, notifies the candidate, and finals are final', async () => {
    const [owner, seeker] = [await user(), await user()];
    const org = await createOrg(owner);
    const j = (await post(org, owner, job()).expect(201)).body;
    await saveCv(seeker).expect(200);
    const app = (await apply(seeker, j.id).expect(201)).body;

    await setStatus(org, owner, app.id, 'hired').expect(409); // cannot skip the process
    await ctx.http.post(`/v1/orgs/${org}/job-applications/${app.id}/status`).set(bearer(owner.token)).send({ status: 'withdrawn' }).expect(400);
    for (const s of ['viewed', 'shortlisted', 'interview', 'offered', 'hired']) {
      const r = await setStatus(org, owner, app.id, s).expect(200);
      expect(r.body.status).toBe(s);
    }
    const invalid = await setStatus(org, owner, app.id, 'rejected').expect(409);
    expect(invalid.body.error.details).toMatchObject({ reason: 'invalid_transition', from: 'hired', to: 'rejected' });
    await ctx.http.post(`/v1/me/job-applications/${app.id}/withdraw`).set(bearer(seeker.token)).expect(409);
    const inbox = await ctx.sql.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND category = 'job'`, [seeker.id]);
    expect(inbox.rows[0].n).toBe(5);
    await setStatus(org, owner, '00000000-0000-4000-8000-000000000000', 'viewed').expect(404);
  });

  it('lets the candidate withdraw (idempotent) and blocks later recruiter moves', async () => {
    const [owner, seeker] = [await user(), await user()];
    const org = await createOrg(owner);
    const j = (await post(org, owner, job()).expect(201)).body;
    await saveCv(seeker).expect(200);
    const app = (await apply(seeker, j.id).expect(201)).body;
    const w = () => ctx.http.post(`/v1/me/job-applications/${app.id}/withdraw`).set(bearer(seeker.token));
    expect((await w().expect(200)).body.status).toBe('withdrawn');
    await w().expect(200);
    await setStatus(org, owner, app.id, 'viewed').expect(409);
    await ctx.http.post(`/v1/me/job-applications/${app.id}/withdraw`).set(bearer(owner.token)).expect(404);
  });

  it('can be reported and hidden by a moderator; the flag turns everything off', async () => {
    const [owner, seeker, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    const org = await createOrg(owner);
    const j = (await post(org, owner, job()).expect(201)).body;
    await ctx.http.post('/v1/reports').set(bearer(seeker.token)).send({ targetType: 'job', targetId: j.id, reason: 'spam' }).expect(201);
    const act = (action: string) => ctx.http.post('/v1/admin/moderation/actions').set(bearer(mod.token)).send({ targetType: 'job', targetId: j.id, action });
    await act('hide').expect(200);
    await ctx.http.get(`/v1/jobs/${j.id}`).set(bearer(seeker.token)).expect(404);
    await act('restore').expect(200);
    await ctx.http.get(`/v1/jobs/${j.id}`).set(bearer(seeker.token)).expect(200);

    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'jobs'`);
    try {
      await ctx.http.get('/v1/jobs').set(bearer(seeker.token)).expect(403);
      await post(org, owner, job()).expect(403);
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'jobs'`);
    }
  });

  it('audits without content, and exports the CV and the applications of the account only', async () => {
    const [owner, seeker, other] = [await user(), await user(), await user()];
    const org = await createOrg(owner);
    const j = (await post(org, owner, job()).expect(201)).body;
    await saveCv(seeker).expect(200);
    await saveCv(other).expect(200);
    await apply(seeker, j.id, { message: 'Message privé' }).expect(201);
    await apply(other, j.id).expect(201);
    const audits = await ctx.sql.query(`SELECT action, metadata::text AS m FROM audit_events WHERE subject_user_id = $1 AND action LIKE 'job.%'`, [seeker.id]);
    expect(audits.rows.map((r: { action: string }) => r.action).sort()).toEqual(['job.applied', 'job.profile_saved']);
    expect(JSON.stringify(audits.rows)).not.toContain('Message privé');
    expect(JSON.stringify(audits.rows)).not.toContain('Comptable junior');
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(seeker.token)).expect(200)).body;
    expect(exp.jobProfile).toMatchObject({ headline: 'Comptable junior' });
    expect(exp.jobApplications).toHaveLength(1);
    expect(exp.jobApplications[0]).toMatchObject({ message: 'Message privé', status: 'submitted', jobTitle: 'Comptable' });
  });
});

describe('job alerts (lot 16d)', () => {
  it('keeps up to 5 private alerts, notifies matching people on a new offer (not the organisation), exports and audits without criteria', async () => {
    const [owner, hr, seeker, other] = [await user(), await user(), await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org, owner, hr, 'hr');
    const alerts = '/v1/me/job-alerts';
    await ctx.http.post(alerts).set(bearer(seeker.token)).send({}).expect(400);
    const a = (await ctx.http.post(alerts).set(bearer(seeker.token)).send({ q: 'compta', city: 'goma' }).expect(201)).body;
    expect(a).toMatchObject({ q: 'compta', city: 'goma', contractType: null });
    await ctx.http.post(alerts).set(bearer(other.token)).send({ city: 'Bukavu' }).expect(201);
    await ctx.http.post(alerts).set(bearer(hr.token)).send({ contractType: 'full_time' }).expect(201); // a member of the organisation
    for (let i = 0; i < 4; i++) await ctx.http.post(alerts).set(bearer(seeker.token)).send({ contractType: 'internship' }).expect(201);
    await ctx.http.post(alerts).set(bearer(seeker.token)).send({ q: 'x' }).expect(409);
    expect((await ctx.http.get(alerts).set(bearer(other.token)).expect(200)).body.items).toHaveLength(1);

    await post(org, owner, job()).expect(201);
    const count = async (u: TU) => Number((await ctx.sql.query(`SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND title LIKE 'Nouvelle offre correspondant%'`, [u.id])).rows[0].n);
    expect(await count(seeker)).toBe(1);
    expect(await count(other)).toBe(0);
    expect(await count(hr)).toBe(0);
    const body = JSON.stringify((await ctx.sql.query('SELECT title, body FROM notifications WHERE user_id = $1', [seeker.id])).rows);
    expect(body).not.toContain('Tenue de la comptabilité');

    const audits = await ctx.sql.query(`SELECT metadata::text AS m FROM audit_events WHERE subject_user_id = $1 AND action = 'job.alert_created'`, [seeker.id]);
    expect(audits.rows.length).toBe(5);
    expect(JSON.stringify(audits.rows)).not.toContain('compta');
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(seeker.token)).expect(200)).body;
    expect(exp.jobAlerts).toHaveLength(5);

    await ctx.http.delete(`${alerts}/${a.id}`).set(bearer(other.token)).expect(204); // not theirs: no effect
    expect((await ctx.http.get(alerts).set(bearer(seeker.token)).expect(200)).body.items).toHaveLength(5);
    await ctx.http.delete(`${alerts}/${a.id}`).set(bearer(seeker.token)).expect(204);
    await ctx.http.delete(`${alerts}/${a.id}`).set(bearer(seeker.token)).expect(204);
    expect((await ctx.http.get(alerts).set(bearer(seeker.token)).expect(200)).body.items).toHaveLength(4);
  });
});

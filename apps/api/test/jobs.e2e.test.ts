import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';
import { TINY_PDF, TINY_PNG, uploadAsset } from './upload.js';

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
    expect((await ctx.http.get('/v1/me/job-profile').set(bearer(u.token)).expect(200)).body).toEqual({ profile: null, cvFile: null });
    await saveCv(u, { headline: 'x' }).expect(400);
    const saved = await saveCv(u).expect(200);
    expect(saved.body).toMatchObject({ headline: 'Comptable junior', skills: ['Excel', 'SYSCOHADA'] });
    await saveCv(u, { ...cv, headline: 'Comptable confirmé' }).expect(200);
    expect((await ctx.http.get('/v1/me/job-profile').set(bearer(u.token)).expect(200)).body.profile.headline).toBe('Comptable confirmé');
    await ctx.http.delete('/v1/me/job-profile').set(bearer(u.token)).expect(204);
    await ctx.http.delete('/v1/me/job-profile').set(bearer(u.token)).expect(204);
    expect((await ctx.http.get('/v1/me/job-profile').set(bearer(u.token)).expect(200)).body).toEqual({ profile: null, cvFile: null });
  });

  it('attaches a CV PDF: owner and organisations applied to only; the application keeps its own file (lot 19m)', async () => {
    const [owner, hr, seeker, other] = [await user(), await user(), await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org, owner, hr, 'hr');
    const j = (await post(org, owner, job()).expect(201)).body;
    const put = (u: TU, assetId: string | null) => ctx.http.put('/v1/me/job-profile/cv').set(bearer(u.token)).send({ assetId });
    const read = (u: TU, id: string) => ctx.http.get(`/v1/media/${id}/content`).set(bearer(u.token));
    const announce = (body: Record<string, unknown>) => ctx.http.post('/v1/media/uploads').set(bearer(seeker.token)).send(body);
    await announce({ purpose: 'cv', mime: 'image/png', sizeBytes: 100 }).expect(400);
    await announce({ purpose: 'cv', mime: 'application/pdf', sizeBytes: 5 * 1024 * 1024 + 1 }).expect(400);
    const a1 = await uploadAsset(ctx, seeker.token, 'cv', 'application/pdf', TINY_PDF);
    expect((await put(seeker, a1).expect(409)).body.error.details.reason).toBe('profile_required');
    await saveCv(seeker).expect(200);
    await put(seeker, await uploadAsset(ctx, other.token, 'cv', 'application/pdf', TINY_PDF)).expect(400); // not mine
    await put(seeker, await uploadAsset(ctx, seeker.token, 'listing', 'image/png', TINY_PNG)).expect(400); // wrong purpose
    const set = await put(seeker, a1).expect(200);
    expect(set.body.cvFile).toMatchObject({ id: a1, mime: 'application/pdf', contentUrl: `/v1/media/${a1}/content` });
    await read(seeker, a1).expect(200);
    await read(hr, a1).expect(404); // not applied yet
    await read(other, a1).expect(404);
    const app = (await apply(seeker, j.id).expect(201)).body;
    await read(hr, a1).expect(200);
    await read(other, a1).expect(404);
    const rec = await ctx.http.get(`/v1/orgs/${org}/jobs/${j.id}/applications`).set(bearer(hr.token)).expect(200);
    expect(rec.body.items[0].cvFile.id).toBe(a1);
    // Replacing keeps the old file for the application and shows the new one to the owner only.
    const a2 = await uploadAsset(ctx, seeker.token, 'cv', 'application/pdf', TINY_PDF);
    expect((await put(seeker, a2).expect(200)).body.cvFile.id).toBe(a2);
    await read(hr, a1).expect(200);
    await read(hr, a2).expect(404);
    // Removing deletes the unreferenced file; audited without content.
    await put(seeker, null).expect(200);
    await read(seeker, a2).expect(404);
    expect((await ctx.http.get('/v1/me/job-profile').set(bearer(seeker.token)).expect(200)).body.cvFile).toBeNull();
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action IN ('job.cv_file_set','job.cv_file_removed') AND actor_user_id = $1`, [seeker.id]);
    expect(audit.rows.length).toBeGreaterThanOrEqual(3);
    expect(audit.rows.every((r: { metadata: object }) => Object.keys(r.metadata).length === 0)).toBe(true);
    expect(app.id).toBeTruthy();
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

  it('does not notify someone who blocked the author or a member, or was blocked by one', async () => {
    const [owner, hr, a, b, c] = [await user(), await user(), await user(), await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org, owner, hr, 'hr');
    for (const u of [a, b, c]) await ctx.http.post('/v1/me/job-alerts').set(bearer(u.token)).send({ city: 'Goma' }).expect(201);
    await ctx.http.put(`/v1/blocks/${owner.id}`).set(bearer(a.token)).expect(204); // a blocked the author
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(hr.token)).expect(204); // a member blocked b
    await post(org, owner, job()).expect(201);
    const count = async (u: TU) => Number((await ctx.sql.query(`SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND title LIKE 'Nouvelle offre correspondant%'`, [u.id])).rows[0].n);
    expect([await count(a), await count(b), await count(c)]).toEqual([0, 0, 1]);
  });
});

describe('interview calendar (lot 16f)', () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  async function setup() {
    const [owner, hr, sales, cand, stranger] = [await user(), await user(), await user(), await user(), await user()];
    const org = await createOrg(owner);
    await addMember(org, owner, hr, 'hr');
    await addMember(org, owner, sales, 'sales');
    const j = (await post(org, owner, job()).expect(201)).body;
    await saveCv(cand).expect(200);
    const app = (await apply(cand, j.id).expect(201)).body;
    return { owner, hr, sales, cand, stranger, org, app };
  }
  const propose = (org: string, u: TU, appId: string, body: Record<string, unknown>) => ctx.http.post(`/v1/orgs/${org}/job-applications/${appId}/interviews`).set(bearer(u.token)).send(body);
  const mine = (u: TU, id: string, action: string, body: Record<string, unknown> = {}) => ctx.http.post(`/v1/me/job-interviews/${id}/${action}`).set(bearer(u.token)).send(body);
  const notes = async (u: TU, like: string) => Number((await ctx.sql.query(`SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND title LIKE $2`, [u.id, like])).rows[0].n);

  it('proposes, validates, limits to one live interview, and checks rights', async () => {
    const { owner, hr, sales, cand, stranger, org, app } = await setup();
    const ok = { startsAt: inHours(48), durationMin: 45, location: 'Bureau secret 12' };
    await propose(org, sales, app.id, ok).expect(403);
    await propose(org, stranger, app.id, ok).expect(404);
    await propose(org, hr, app.id, { ...ok, startsAt: inHours(-1) }).expect(400);
    await propose(org, hr, app.id, { ...ok, durationMin: 10 }).expect(400);
    await propose(org, hr, app.id, { ...ok, durationMin: 181 }).expect(400);
    await propose(org, hr, app.id, { ...ok, location: 'x'.repeat(201) }).expect(400);
    const r = await propose(org, hr, app.id, ok).expect(201);
    expect(r.body).toMatchObject({ status: 'proposed', durationMin: 45, location: 'Bureau secret 12', applicationId: app.id });
    await propose(org, owner, app.id, ok).expect(409); // one live interview
    expect(await notes(cand, 'Entretien proposé')).toBe(1);
    const nb = await ctx.sql.query(`SELECT body FROM notifications WHERE user_id = $1 AND title = 'Entretien proposé'`, [cand.id]);
    expect(JSON.stringify(nb.rows)).not.toContain('secret');
    const audits = await ctx.sql.query(`SELECT metadata::text AS m FROM audit_events WHERE action = 'job.interview_proposed' AND actor_user_id = $1`, [hr.id]);
    expect(JSON.stringify(audits.rows)).not.toContain('secret');
    expect((await ctx.http.get(`/v1/orgs/${org}/job-applications/${app.id}/interviews`).set(bearer(owner.token)).expect(200)).body.items).toHaveLength(1);
    await ctx.http.get(`/v1/orgs/${org}/job-applications/${app.id}/interviews`).set(bearer(stranger.token)).expect(404);
  });

  it('candidate confirms; only the two parties see it; export includes it; rights on cancel', async () => {
    const { owner, hr, cand, stranger, org, app } = await setup();
    const id = (await propose(org, hr, app.id, { startsAt: inHours(48), durationMin: 30, location: 'Salle A' }).expect(201)).body.id;
    expect((await ctx.http.get('/v1/me/job-interviews').set(bearer(cand.token)).expect(200)).body.items.map((i: { id: string }) => i.id)).toEqual([id]);
    expect((await ctx.http.get('/v1/me/job-interviews').set(bearer(stranger.token)).expect(200)).body.items).toHaveLength(0);
    await mine(stranger, id, 'confirm').expect(404);
    await ctx.http.post(`/v1/orgs/${org}/job-interviews/${id}/cancel`).set(bearer(stranger.token)).expect(404);
    expect((await mine(cand, id, 'confirm').expect(200)).body.status).toBe('confirmed');
    await mine(cand, id, 'confirm').expect(409);
    await mine(cand, id, 'decline').expect(409);
    expect(await notes(owner, 'Entretien confirmé')).toBe(1);
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(cand.token)).expect(200)).body;
    expect(exp.jobInterviews).toHaveLength(1);
    expect((await mine(cand, id, 'cancel').expect(200)).body.status).toBe('cancelled');
    expect(await notes(hr, 'Entretien annulé')).toBe(1);
    await ctx.http.post(`/v1/orgs/${org}/job-interviews/${id}/cancel`).set(bearer(hr.token)).expect(409); // already cancelled
    await propose(org, hr, app.id, { startsAt: inHours(72), durationMin: 30 }).expect(201); // a new one is allowed again
  });

  it('candidate declines with a reason; cancel is too late within 1 hour; recruiter cancels', async () => {
    const { hr, cand, org, app } = await setup();
    const a = (await propose(org, hr, app.id, { startsAt: inHours(24), durationMin: 60 }).expect(201)).body.id;
    const d = await mine(cand, a, 'decline', { reason: 'Indisponible ce jour' }).expect(200);
    expect(d.body).toMatchObject({ status: 'declined', reason: 'Indisponible ce jour' });
    await mine(cand, a, 'decline', { reason: 'x'.repeat(201) }).expect(400);
    const dn = await ctx.sql.query(`SELECT body FROM notifications WHERE title = 'Entretien refusé' AND user_id <> $1`, [cand.id]);
    expect(JSON.stringify(dn.rows)).not.toContain('Indisponible');
    const b = (await propose(org, hr, app.id, { startsAt: inHours(24), durationMin: 60 }).expect(201)).body.id;
    await mine(cand, b, 'cancel').expect(409); // still proposed: candidate cannot cancel
    await mine(cand, b, 'confirm').expect(200);
    await ctx.sql.query(`UPDATE job_interviews SET starts_at = now() + interval '30 minutes' WHERE id = $1`, [b]);
    const late = await mine(cand, b, 'cancel').expect(409);
    expect(JSON.stringify(late.body)).toContain('too_late');
    expect((await ctx.http.post(`/v1/orgs/${org}/job-interviews/${b}/cancel`).set(bearer(hr.token)).expect(200)).body.status).toBe('cancelled');
    expect(await notes(cand, 'Entretien annulé')).toBe(1);
    const c = (await propose(org, hr, app.id, { startsAt: inHours(24), durationMin: 60 }).expect(201)).body.id;
    await ctx.sql.query(`UPDATE job_interviews SET starts_at = now() - interval '1 hour' WHERE id = $1`, [c]);
    await mine(cand, c, 'confirm').expect(409); // already took place
    expect((await mine(cand, c, 'decline').expect(200)).body.status).toBe('declined'); // a stale one can still be declined
    const e = (await propose(org, hr, app.id, { startsAt: inHours(24), durationMin: 60 }).expect(201)).body.id;
    await mine(cand, e, 'confirm').expect(200);
    await ctx.sql.query(`UPDATE job_interviews SET starts_at = now() - interval '1 hour' WHERE id = $1`, [e]);
    expect((await mine(cand, e, 'cancel').expect(200)).body.status).toBe('cancelled'); // past: no 1 h rule, no stuck unique index
    await propose(org, hr, app.id, { startsAt: inHours(24), durationMin: 60 }).expect(201);
  });

  it('is removed with the application', async () => {
    const { hr, cand, org, app } = await setup();
    await propose(org, hr, app.id, { startsAt: inHours(24), durationMin: 60 }).expect(201);
    await ctx.sql.query('DELETE FROM job_applications WHERE id = $1', [app.id]);
    expect((await ctx.http.get('/v1/me/job-interviews').set(bearer(cand.token)).expect(200)).body.items).toHaveLength(0);
  });
});

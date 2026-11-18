import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';
import { TINY_PDF, TINY_PNG, uploadAsset } from './upload.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
  await setFlag('health', true);
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
const setFlag = (key: string, enabled: boolean) => ctx.sql.query('UPDATE feature_flags SET enabled = $1 WHERE key = $2', [enabled, key]);
const api = (method: 'get' | 'post' | 'put' | 'delete' | 'patch', u: TU, path: string, body?: Record<string, unknown>) => ctx.http[method](`/v1${path}`).set(bearer(u.token)).send(body ?? {});
const consenting = async () => {
  const u = await user();
  await api('put', u, '/me/health/consent', { version: '1' }).expect(200);
  return u;
};
const result = (extra: Record<string, unknown> = {}) => ({ kind: 'blood', title: 'Glycémie à jeun', summary: 'Glucose 0,92 g/L, valeur normale', resultDate: '2026-03-10', ...extra });
const future = (days = 3) => new Date(Date.now() + days * 86_400_000).toISOString();
const upload = (u: TU, purpose = 'health_result', mime = 'application/pdf', content: Buffer = TINY_PDF) => uploadAsset(ctx, u.token, purpose, mime, content);
const read = (u: TU, mediaId: string) => api('get', u, `/media/${mediaId}/content`);
const mediaCount = async (id: string) => (await ctx.sql.query('SELECT 1 FROM media_assets WHERE id = $1', [id])).rows.length;

async function approvedPro(): Promise<TU> {
  const [pro, admin] = [await user(), await user(['user', 'admin'])];
  await api('put', pro, '/me/health/professional', { kind: 'laboratory', specialty: 'Analyses', licenseNumber: 'LAB-12345', city: 'Goma', bio: '' }).expect(200);
  await api('post', admin, `/admin/health/professionals/${pro.id}/review`, { decision: 'approve' }).expect(204);
  return pro;
}
/** A confirmed appointment of `patient` with `pro`. */
async function confirmed(patient: TU, pro: TU): Promise<string> {
  const a = (await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: future(), reason: 'Bilan' }).expect(201)).body;
  await api('post', pro, `/health/appointments/${a.id}/confirm`).expect(200);
  return a.id as string;
}

describe('exam results (lot 18d)', () => {
  it('is behind the regulated flag and needs the health consent', async () => {
    const noConsent = await user();
    expect((await api('get', noConsent, '/me/health/results').expect(403)).body.error.details.reason).toBe('consent_required');
    expect((await api('post', noConsent, '/me/health/results', result()).expect(403)).body.error.details.reason).toBe('consent_required');
    const u = await consenting();
    await setFlag('health', false);
    try {
      expect((await api('get', u, '/me/health/results').expect(403)).body.error.code).toBe('feature_disabled');
      await api('post', u, '/me/health/results', result()).expect(403);
    } finally {
      await setFlag('health', true);
    }
    await api('get', u, '/me/health/results').expect(200);
    await api('delete', u, '/me/health/consent').expect(200); // withdrawing hides everything
    await api('get', u, '/me/health/results').expect(403);
  });

  it('stores the content sealed, with an optional file, validates input and keeps results private', async () => {
    const u = await consenting();
    const stranger = await consenting();
    const file = await upload(u);
    await api('post', u, '/me/health/results', result({ kind: 'xray' })).expect(400);
    await api('post', u, '/me/health/results', result({ resultDate: '2026-02-31' })).expect(400);
    await api('post', u, '/me/health/results', result({ resultDate: '2999-01-01' })).expect(400);
    await api('post', u, '/me/health/results', result({ title: ' ' })).expect(400);
    await api('post', u, '/me/health/results', result({ assetId: await upload(u, 'document') })).expect(400); // wrong purpose
    await api('post', u, '/me/health/results', result({ assetId: await upload(stranger) })).expect(400); // someone else's file
    const pendingId = (await ctx.http.post('/v1/media/uploads').set(bearer(u.token)).send({ purpose: 'health_result', mime: 'application/pdf', sizeBytes: 100 }).expect(201)).body.assetId;
    await api('post', u, '/me/health/results', result({ assetId: pendingId })).expect(400); // not uploaded yet

    const r = (await api('post', u, '/me/health/results', result({ assetId: file })).expect(201)).body;
    expect(r).toMatchObject({ kind: 'blood', title: 'Glycémie à jeun', summary: 'Glucose 0,92 g/L, valeur normale', resultDate: '2026-03-10', provider: null, file: { id: file, mime: 'application/pdf' } });
    await api('post', u, '/me/health/results', result({ assetId: file })).expect(400); // a file serves one result

    const raw = (await ctx.sql.query('SELECT kind, payload FROM health_results WHERE id = $1', [r.id])).rows[0] as { kind: string; payload: string };
    expect(raw.payload).toMatch(/^v1:/);
    for (const word of ['Glycémie', 'Glucose', 'normale']) expect(raw.payload).not.toContain(word);

    await read(u, file).expect(200);
    await read(stranger, file).expect(404);
    expect((await api('get', stranger, '/me/health/results').expect(200)).body.items).toEqual([]);
    await api('patch', stranger, `/me/health/results/${r.id}`, { title: 'x' }).expect(404);
    await api('delete', stranger, `/me/health/results/${r.id}`).expect(204);
    expect((await api('get', u, '/me/health/results').expect(200)).body.items).toHaveLength(1);

    const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE subject_user_id = $1 AND action = 'health.result_created'`, [u.id]);
    expect(audits.rows).toHaveLength(1);
    for (const word of ['Glycémie', 'Glucose']) expect(JSON.stringify(audits.rows)).not.toContain(word);
  });

  it('edits, filters, pages, replaces and removes the file, and deletes', async () => {
    const u = await consenting();
    const f1 = await upload(u);
    const a = (await api('post', u, '/me/health/results', result({ assetId: f1 })).expect(201)).body;
    const b = (await api('post', u, '/me/health/results', result({ kind: 'imaging', title: 'Échographie', resultDate: '2026-04-01' })).expect(201)).body;
    await api('post', u, '/me/health/results', result({ kind: 'urine', resultDate: '2026-01-01' })).expect(201);
    expect((await api('get', u, '/me/health/results').expect(200)).body.items.map((i: { id: string }) => i.id)[0]).toBe(b.id); // newest first
    expect((await api('get', u, '/me/health/results?kind=imaging').expect(200)).body.items).toHaveLength(1);
    const p1 = (await api('get', u, '/me/health/results?limit=2').expect(200)).body;
    expect(p1.items).toHaveLength(2);
    expect((await api('get', u, `/me/health/results?limit=2&cursor=${p1.nextCursor}`).expect(200)).body.items).toHaveLength(1);
    await api('get', u, '/me/health/results?cursor=x').expect(400);

    const edited = (await api('patch', u, `/me/health/results/${a.id}`, { title: 'Glycémie 2', kind: 'other' }).expect(200)).body;
    expect(edited).toMatchObject({ title: 'Glycémie 2', kind: 'other', summary: 'Glucose 0,92 g/L, valeur normale', file: { id: f1 } });
    await api('patch', u, `/me/health/results/${a.id}`, { resultDate: '2999-01-01' }).expect(400);

    const f2 = await upload(u, 'health_result', 'image/png', TINY_PNG);
    expect((await api('patch', u, `/me/health/results/${a.id}`, { assetId: f2 }).expect(200)).body.file).toMatchObject({ id: f2, mime: 'image/png' });
    expect(await mediaCount(f1)).toBe(0); // the replaced file is deleted
    expect((await api('patch', u, `/me/health/results/${a.id}`, { assetId: null }).expect(200)).body.file).toBeNull();
    expect(await mediaCount(f2)).toBe(0);

    const f3 = await upload(u);
    await api('patch', u, `/me/health/results/${b.id}`, { assetId: f3 }).expect(200);
    await api('delete', u, `/me/health/results/${b.id}`).expect(204);
    await api('delete', u, `/me/health/results/${b.id}`).expect(204); // idempotent
    expect(await mediaCount(f3)).toBe(0);
    await api('patch', u, `/me/health/results/${b.id}`, { title: 'x' }).expect(404);
    await api('patch', u, '/me/health/results/not-a-uuid', { title: 'x' }).expect(404);
  });

  it('caps the results per user', async () => {
    const u = await consenting();
    await ctx.sql.query(`INSERT INTO health_results (user_id, kind, payload, result_date) SELECT $1, 'other', 'x', '2026-01-01' FROM generate_series(1, 200)`, [u.id]);
    const full = await api('post', u, '/me/health/results', result()).expect(409);
    expect(full.body.error.details).toMatchObject({ reason: 'limit_reached', limit: 200 });
  });

  it('lets a professional read results and their file only through an active share that covers them', async () => {
    const [patient, pro, stranger] = [await consenting(), await approvedPro(), await user()];
    const file = await upload(patient);
    await api('post', patient, '/me/health/results', result({ assetId: file })).expect(201);
    const read_ = () => api('get', pro, `/health/patients/${patient.id}/results`);
    await read_().expect(404); // never shared
    await read(pro, file).expect(404);

    await api('post', patient, '/me/health/shares', { professionalId: pro.id, kinds: ['allergy', 'condition'], days: 2 }).expect(201);
    await read_().expect(404); // a share that does not cover results
    await read(pro, file).expect(404);

    const share = (await api('post', patient, '/me/health/shares', { professionalId: pro.id, kinds: ['results'], days: 2 }).expect(201)).body;
    expect(share.kinds).toEqual(['results']);
    const seen = (await read_().expect(200)).body;
    expect(seen).toMatchObject({ patient: { id: patient.id }, items: [{ title: 'Glycémie à jeun', file: { id: file } }] });
    await read(pro, file).expect(200);
    await read(stranger, file).expect(404);
    await api('get', stranger, `/health/patients/${patient.id}/results`).expect(404);
    await api('get', pro, `/health/patients/${stranger.id}/results`).expect(404);
    await api('get', pro, '/health/patients/not-a-uuid/results').expect(404);

    // Every read is logged for the patient and audited without content.
    expect((await api('get', patient, '/me/health/access-log').expect(200)).body.items[0]).toMatchObject({ accessor: { id: pro.id }, entriesCount: 1 });
    const audits = await ctx.sql.query(`SELECT metadata::text AS md FROM audit_events WHERE actor_user_id = $1 AND action = 'health.results_read'`, [pro.id]);
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows)).not.toContain('Glycémie');

    await ctx.sql.query(`UPDATE health_shares SET expires_at = now() - interval '1 minute' WHERE id = $1`, [share.id]);
    await read_().expect(404);
    await read(pro, file).expect(404);

    const again = (await api('post', patient, '/me/health/shares', { professionalId: pro.id, kinds: ['results'] }).expect(201)).body;
    await read_().expect(200);
    await api('delete', patient, `/me/health/shares/${again.id}`).expect(200);
    await read_().expect(404); // revoked
    await read(pro, file).expect(404);

    await api('post', patient, '/me/health/shares', { professionalId: pro.id, kinds: ['results'] }).expect(201);
    await api('delete', patient, '/me/health/consent').expect(200);
    await read_().expect(404); // the patient withdrew consent
    await api('put', patient, '/me/health/consent', { version: '1' }).expect(200);
    await ctx.sql.query(`UPDATE health_professionals SET status = 'suspended' WHERE user_id = $1`, [pro.id]);
    await read_().expect(404);
    await read(pro, file).expect(404);
  });

  it('lets a verified professional with an appointment add a result, owned by the patient', async () => {
    const [patient, pro, other, stranger] = [await consenting(), await approvedPro(), await approvedPro(), await user()];
    const body = (extra: Record<string, unknown> = {}) => result({ title: 'NFS laboratoire', ...extra });
    await api('post', pro, `/health/patients/${patient.id}/results`, body()).expect(404); // no appointment
    const appt = (await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: future(), reason: 'Bilan' }).expect(201)).body;
    await api('post', pro, `/health/patients/${patient.id}/results`, body()).expect(404); // only requested
    await api('post', pro, `/health/appointments/${appt.id}/confirm`).expect(200);
    await api('post', other, `/health/patients/${patient.id}/results`, body()).expect(404); // another professional
    await api('post', stranger, `/health/patients/${patient.id}/results`, body()).expect(404); // not a professional
    await api('post', pro, '/health/patients/not-a-uuid/results', body()).expect(404);
    await api('post', pro, `/health/patients/${patient.id}/results`, body({ assetId: await upload(patient) })).expect(400); // the patient's file is not the professional's

    const file = await upload(pro);
    const added = await api('post', pro, `/health/patients/${patient.id}/results`, body({ assetId: file })).expect(201);
    expect((await ctx.sql.query('SELECT owner_user_id FROM media_assets WHERE id = $1', [file])).rows[0].owner_user_id).toBe(patient.id);
    const mine = (await api('get', patient, '/me/health/results').expect(200)).body.items[0];
    expect(mine).toMatchObject({ id: added.body.id, title: 'NFS laboratoire', provider: { id: pro.id }, file: { id: file } });
    await read(patient, file).expect(200);
    await read(pro, file).expect(404); // no share: the professional cannot read it back
    await api('get', pro, `/health/patients/${patient.id}/results`).expect(404);
    await api('patch', pro, `/me/health/results/${added.body.id}`, { title: 'x' }).expect(403);
    expect((await ctx.sql.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND body = 'Un nouveau résultat est disponible.'`, [patient.id])).rows).toHaveLength(1);

    await api('put', patient, `/blocks/${pro.id}`).expect(204);
    await api('post', pro, `/health/patients/${patient.id}/results`, body()).expect(404); // blocked

    const noConsent = await user();
    await api('post', pro, `/health/patients/${noConsent.id}/results`, body()).expect(404);
  });

  it('is exported decrypted and erased with the health data, files included', async () => {
    const u = await consenting();
    const pro = await approvedPro();
    await confirmed(u, pro);
    const file = await upload(u);
    await api('post', u, '/me/health/results', result({ assetId: file })).expect(201);
    await api('post', pro, `/health/patients/${u.id}/results`, result({ title: 'Urines', kind: 'urine', resultDate: '2026-03-11' })).expect(201);

    const exp = (await ctx.http.get('/v1/me/export').set(bearer(u.token)).expect(200)).body.health;
    expect(exp.results).toEqual([
      { kind: 'blood', resultDate: '2026-03-10', title: 'Glycémie à jeun', summary: 'Glucose 0,92 g/L, valeur normale', provider: null, hasFile: true },
      { kind: 'urine', resultDate: '2026-03-11', title: 'Urines', summary: 'Glucose 0,92 g/L, valeur normale', provider: expect.any(String), hasFile: false },
    ]);
    expect(JSON.stringify(exp)).not.toContain(file);

    await api('delete', u, '/me/health/data').expect(204);
    expect((await ctx.sql.query('SELECT 1 FROM health_results WHERE user_id = $1', [u.id])).rows).toHaveLength(0);
    expect(await mediaCount(file)).toBe(0);
  });

  it('is purged, files included, with the deleted account', async () => {
    const u = await consenting();
    const pro = await approvedPro();
    await confirmed(u, pro);
    const own = await upload(u);
    const byPro = await upload(pro);
    await api('post', u, '/me/health/results', result({ assetId: own })).expect(201);
    await api('post', pro, `/health/patients/${u.id}/results`, result({ assetId: byPro })).expect(201);
    await ctx.http.post('/v1/me/deletion-request').set(bearer(u.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [u.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect((await ctx.sql.query('SELECT 1 FROM health_results WHERE user_id = $1', [u.id])).rows).toHaveLength(0);
    expect(await mediaCount(own)).toBe(0);
    expect(await mediaCount(byPro)).toBe(0);
  });
});
